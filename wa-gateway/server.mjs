// canivete wa-gateway — WhatsApp via Baileys (WebSocket puro, sem browser).
// HTTP localhost :19424, mesmo token do canivete. Pareamento por CÓDIGO (sem QR).
// Uso: node server.mjs  (porta via WA_PORT)
import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } from "@whiskeysockets/baileys";
const pkg = { default: makeWASocket };

const PORT = Number(process.env.WA_PORT) || 19424;
const TOKEN = (process.env.CANIVETE_TOKEN || "").trim() || (() => { try { return readFileSync(`${process.env.HOME || "/root"}/.config/canivete/token.txt`, "utf8").trim(); } catch { return ""; } })();

let sock = null;
let connState = "off"; // off|qr|pairing|connecting|open
let lastQR = null;
const INBOX_CAP = 500; // anel em memória (era 5000; laptop 3.6GB — todo MB conta)
const INBOX_PERSIST = 500; // espelho em inbox.json (era 2000)
let inbox = []; // anel persistente (sobrevive a restart; busca local rápida)
try { inbox = JSON.parse(readFileSync("./inbox.json", "utf8") || "[]").slice(-INBOX_PERSIST); } catch {}
// Baileys loga em INFO (pino) p/ stdout → systemd anexa em wa-gateway.log sem rotação.
// Stub silencioso zera o spam no nascedouro (sem dep nova; Baileys só usa .child()+métodos).
const silentLogger = { level: "silent", trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {}, child() { return silentLogger; } };
let inboxSaveT = null;
const saveInbox = () => {
  clearTimeout(inboxSaveT);
  inboxSaveT = setTimeout(() => { try { writeFileSync("./inbox.json", JSON.stringify(inbox.slice(-INBOX_PERSIST))); } catch {} }, 2000);
};
const capInbox = () => { if (inbox.length > INBOX_CAP) inbox.splice(0, inbox.length - INBOX_CAP); };

function authed() { return sock && connState === "open"; }

async function connect() {
  const { state, saveCreds } = await useMultiFileAuthState("./auth");
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
  sock = makeWASocket({
    auth: state, version, printQRInTerminal: false,
    browser: ["Canivete", "Chrome", "1.0"], // preset original que pareou OK (Desktop derruba o login nesta conta)
    logger: silentLogger, // sem pino INFO → wa-gateway.log para de crescer (546KB hoje, sem rotação no systemd)
    syncFullHistory: false, // era true: pulava o sync FULL (dezenas de MB bufferizados no Baileys); on-demand via /wa/read continua
    getMessage: async () => undefined, // pushMsg nunca guardou raw: o scan [...inbox].reverse().find() sempre retornou undefined — removido o O(n) por lookup
  });
  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", (u) => {
    if (u.qr) {
      lastQR = u.qr;
      connState = "qr";
      import("qrcode").then(({ default: QR }) => {
        QR.toFile("/home/tork/Downloads/wa-qr.png", u.qr, { width: 400 }, () => {});
      }).catch(() => {});
    }
    if (u.connection === "connecting") { if (connState !== "pairing") connState = "connecting"; }
    if (u.connection === "open") { connState = "open"; lastQR = null; }
    if (u.connection === "close") {
      const code = u.lastDisconnect?.error?.output?.statusCode;
      connState = "off";
      if (code === DisconnectReason.loggedOut) { connState = "logged-out"; return; }
      setTimeout(connect, 5000); // reconecta sozinho
    }
  });
  const pushMsg = (m, type) => {
    if (m.key?.remoteJid === "status@broadcast") return; // stories: ninguém lê via /wa/read (só grupos/números); era ~1/3 do inbox
    const text = (m.message?.conversation || m.message?.extendedTextMessage?.text || m.message?.imageMessage?.caption || "").slice(0, 500);
    inbox.push({ jid: m.key?.remoteJid, msgId: m.key?.id, fromMe: !!m.key?.fromMe, sender: m.key?.participant || "", at: new Date((Number(m.messageTimestamp) || 0) * 1000).toISOString(), text, type });
    capInbox();
  };
  sock.ev.on("messages.upsert", ({ messages, type }) => {
    for (const m of messages || []) pushMsg(m, type);
    saveInbox();
  });
  // HISTÓRICO: chega aqui (doc history-sync) — persistir p/ /wa/read + getMessage
  sock.ev.on("messaging-history.set", ({ chats, contacts, messages, syncType }) => {
    for (const m of messages || []) pushMsg(m, `history:${syncType || "?"}`);
    saveInbox();
    inbox.push({ sys: true, at: new Date().toISOString(), text: `history-set: ${syncType} chats=${(chats || []).length} msgs=${(messages || []).length}` });
    capInbox();
  });
  sock.ev.on("messaging-history.status", (s) => { inbox.push({ sys: true, at: new Date().toISOString(), text: `history-sync: ${JSON.stringify(s).slice(0, 200)}` }); capInbox(); }); // era push sem teto (vazamento lento)
}

const norm = (s) => String(s || "").toLowerCase();
async function resolveJid(nameOrJid) {
  const q = String(nameOrJid || "");
  if (/@(s\.whatsapp\.net|g\.us|lid)$/.test(q)) return q;
  if (/^\d{8,16}$/.test(q.replace(/\D/g, ""))) return q.replace(/\D/g, "") + "@s.whatsapp.net";
  const groups = await sock.groupFetchAllParticipating().catch(() => ({}));
  const hit = Object.entries(groups).find(([jid, g]) => norm(g.subject).includes(norm(q)));
  if (hit) return hit[0];
  throw new Error(`chat "${q}" não achado nos grupos; use JID ou número`);
}

function textOf(m) {
  const mm = m.message || {};
  return (mm.conversation || mm.extendedTextMessage?.text || mm.imageMessage?.caption || mm.videoMessage?.caption || mm.documentMessage?.caption || "").slice(0, 500);
}

createServer(async (req, res) => {
  try {
    const u = new URL(req.url || "/", "http://127.0.0.1");
    const tok = req.headers["x-token"] || u.searchParams.get("token");
    const J = (o, code = 200) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
    if (u.pathname === "/health" && req.method === "GET") return J({ ok: true, wa: connState });
    if (!TOKEN || tok !== TOKEN) return J({ error: "bad token" }, 401);
    let body = {};
    if (req.method === "POST") {
      const chunks = [];
      await new Promise((ok2, fail) => { req.on("data", (c) => ch.length < 2e6 && ch.push(c)); req.on("end", ok2); req.on("error", fail); const ch = chunks; });
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return J({ error: "bad json" }, 400); }
    }
    if (u.pathname === "/wa/pair" && req.method === "POST") {
      if (authed()) return J({ ok: true, already: true });
      const phone = String(body.phone || "").replace(/\D/g, "");
      if (phone.length < 10) return J({ ok: false, error: "phone E.164 sem + (ex: 5591999999999)" }, 400);
      connState = "pairing";
      try {
        const code = await sock.requestPairingCode(phone);
        return J({ ok: true, code, how: "No WhatsApp: Aparelhos conectados > Conectar aparelho > Conectar com número, digite o código" });
      } catch (e) { connState = "off"; return J({ ok: false, error: String(e.message || e).slice(0, 300) }); }
    }
    if (u.pathname === "/wa/qr" && req.method === "GET") {
      if (!lastQR) return J({ ok: false, error: "sem QR no momento (conectado ou aguardando)", state: connState });
      return J({ ok: true, qr: lastQR, file: "/home/tork/Downloads/wa-qr.png" });
    }
    if (u.pathname === "/wa/invite" && req.method === "POST") {
      if (!authed()) return J({ ok: false, error: "desconectado", state: connState }, 409);
      let body2 = {};
      try { body2 = JSON.parse(body); } catch {}
      const q = body2.jid || body2.name || "";
      let jid = q;
      if (!/@g\.us$/.test(q)) {
        const groups = await sock.groupFetchAllParticipating().catch(() => ({}));
        const hit = Object.entries(groups).find(([j, g]) => norm(g.subject).includes(norm(q)));
        if (!hit) return J({ ok: false, error: `grupo "${q}" não achado` }, 404);
        jid = hit[0];
      }
      try {
        const code = await sock.groupInviteCode(jid);
        return J({ ok: true, jid, url: `https://chat.whatsapp.com/${code}` });
      } catch (e) { return J({ ok: false, error: String(e.message || e).slice(0, 200) }); }
    }
    if (u.pathname === "/wa/chats" && req.method === "GET") {
      if (!authed()) return J({ ok: false, error: "desconectado (pair primeiro)", state: connState }, 409);
      const groups = await sock.groupFetchAllParticipating();
      return J({ ok: true, groups: Object.entries(groups).map(([jid, g]) => ({ jid, name: g.subject, participants: (g.participants || []).length })) });
    }
    if (u.pathname === "/wa/read" && req.method === "POST") {
      if (!authed()) return J({ ok: false, error: "desconectado", state: connState }, 409);
      const jid = await resolveJid(body.jid || body.to || body.name).catch((e) => null);
      if (!jid) return J({ ok: false, error: `chat "${body.name || body.jid || body.to}" não achado` }, 404);
      const limit = Math.min(Number(body.limit) || 20, 50);
      let msgs = inbox.filter((m) => m.jid === jid && m.text).slice(-limit);
      if (!msgs.length) {
        // on-demand: pede ao celular e aguarda o history-set chegar (doc history-sync)
        try {
          const seed = [...inbox].reverse().find((m) => m.jid === jid && m.msgId);
          const key = seed ? { remoteJid: jid, fromMe: seed.fromMe, id: seed.msgId } : { remoteJid: jid, fromMe: false, id: "0000000000000000" };
          await sock.fetchMessageHistory(50, key, Date.now());
          for (let i = 0; i < 45 && !inbox.some((m) => m.jid === jid && m.text); i++) await new Promise((r) => setTimeout(r, 2000));
          msgs = inbox.filter((m) => m.jid === jid && m.text).slice(-limit);
        } catch (e) { return J({ ok: true, jid, messages: [], via: "on-demand-falhou", error: String(e.message || e).slice(0, 150) }); }
      }
      return J({ ok: true, jid, messages: msgs.map((m) => ({ at: m.at, fromMe: m.fromMe, sender: m.sender, text: m.text })) });
    }
    if (u.pathname === "/wa/send" && req.method === "POST") {
      if (!authed()) return J({ ok: false, error: "desconectado", state: connState }, 409);
      const text = String(body.text || "").slice(0, 2000);
      if (!text.trim()) return J({ ok: false, error: "text vazio" }, 400);
      const jid = await resolveJid(body.to || body.jid || body.name).catch(() => null);
      if (!jid) return J({ ok: false, error: "destino não achado (use nome do grupo, JID ou número)" }, 404);
      const sent = await sock.sendMessage(jid, { text });
      return J({ ok: true, id: sent?.key?.id, to: jid });
    }
    return J({ error: "rota? /health /wa/pair /wa/chats /wa/read /wa/send" }, 404);
  } catch (e) { try { res.writeHead(500); res.end("erro"); } catch {} }
}).listen(PORT, "127.0.0.1", () => {
  process.stderr.write(`[wa-gateway] em http://127.0.0.1:${PORT}\n`);
  connect();
});
