// canivete — ponte do navegador LOGADO do dono (extensão local, long-poll localhost + token)
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

const UB_PORT = Number(process.env.CANIVETE_BRIDGE_PORT || process.env.UBROWSER_PORT) || 19422;
const UB_TOKEN_FILE = process.env.CANIVETE_TOKEN_FILE || join(homedir(), ".config/canivete/token.txt");
const UB_MAXPAY = Number(process.env.CANIVETE_UB_MAXPAY) || 500 * 1024;
const UB_CHUNK = Number(process.env.CANIVETE_UB_CHUNK) || 400 * 1024;
// Timeout de transporte ÚNICO do ubrowser: default 60s, piso 1s, teto 300s (env respeitado).
// tools-owner usa p/ mensagem fiel ("timeout Xs"); ubSend clampa qualquer caller por aqui.
export const UB_TIMEOUT_MS = Math.min(Math.max(Number(process.env.CANIVETE_UB_TIMEOUT) || 60000, 1000), 300000);
const UB_WARNPAY = 100 * 1024;
// cache em memória: era readFileSync a cada request (hot-path HTTP) — agora lê 1x
let ubTokenCache = (process.env.CANIVETE_TOKEN || "").trim() || null;
const ubToken = () => {
  if (ubTokenCache) return ubTokenCache;
  if (process.env.CANIVETE_TOKEN) { ubTokenCache = process.env.CANIVETE_TOKEN.trim(); return ubTokenCache; }
  try {
    const t = (readFileSync(UB_TOKEN_FILE, "utf8") || "").trim();
    if (t) { ubTokenCache = t; return t; }
  } catch (e) { process.stderr.write(`[canivete] token read falhou (${e?.message || e})\n`); }
  // auto-gera na primeira execução (E4: sem token manual)
  try {
    const t = randomBytes(24).toString("hex");
    mkdirSync(dirname(UB_TOKEN_FILE), { recursive: true });
    writeFileSync(UB_TOKEN_FILE, t, { mode: 0o600 });
    process.stderr.write(`[canivete] token gerado em ${UB_TOKEN_FILE} — cole na extensão\n`);
    ubTokenCache = t;
    return t;
  } catch (e) {
    process.stderr.write(`[canivete] sem token (${e.message}) — extensão não conecta\n`);
    return "";
  }
};

const ubExtensions = new Map(); // clientId -> { lastPoll, info }
let ubLastPoll = 0;
let ubExtInfo = null;
const ubQueue = [], ubWaiters = [], ubPending = new Map();
let ubSeq = 0, ubHttp = false;
// TTL da fila: cada msg carrega exp (= ida do caller, ms). Expirada = caller já desistiu —
// executar atrasado faria efeito fantasma (clique tardio na aba errada) e a resposta
// voltaria p/ ninguém. Prune em push/poll/flush; contador p/ diagnóstico (ubStats).
let ubExpired = 0;
function ubPrune() {
  const now = Date.now();
  for (let i = ubQueue.length - 1; i >= 0; i--) {
    const q = ubQueue[i];
    if (q.exp && q.exp <= now) { ubQueue.splice(i, 1); ubExpired++; }
  }
}
function ubNextIdx(extId) {
  const now = Date.now();
  return ubQueue.findIndex((q) => (!q.exp || q.exp > now) && (q.target === null || q.target === extId));
}
// alertas proativos do mon-hook (/ubpush): erros de console/rede empurrados pela extensão.
// Ring global (cap 30) + contador não-lidos; `console` marca lido; hint nas respostas.
const ubAlerts = [];
let ubAlertsUnread = 0;
function ubAlertsPush(tabId, title, url, entries) {
  try {
    for (const e of (Array.isArray(entries) ? entries : []).slice(0, 3)) {
      ubAlerts.push({ at: new Date().toISOString(), tabId, title: String(title || "").slice(0, 80), url: String(url || "").slice(0, 120), kind: e.kind, level: e.level, text: String(e.text || e.url || "").slice(0, 220), status: e.status ?? null });
    }
    while (ubAlerts.length > 30) ubAlerts.shift();
    ubAlertsUnread++;
  } catch {}
}
function ubAlertsPending() { return ubAlertsUnread; }
function ubAlertsRead() { const n = ubAlertsUnread; ubAlertsUnread = 0; return n; }
function ubAlertsHint() {
  return ubAlertsUnread > 0 ? ` 📬 ${ubAlertsUnread} alerta(s) novo(s) do console — leia com n_ubrowser_act {action:"console", filter:"errors"}` : "";
}

function ubFlush() {
  ubPrune();
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (let wi = 0; wi < ubWaiters.length; wi++) {
      const w = ubWaiters[wi];
      const qi = ubNextIdx(w.extId);
      if (qi >= 0) {
        ubWaiters.splice(wi, 1);
        const q = ubQueue.splice(qi, 1)[0];
        clearTimeout(w.t);
        try { w.res.writeHead(200, { "content-type": "application/json" }); w.res.end(JSON.stringify(q)); } catch (e) { process.stderr.write(`[canivete] ubFlush falhou (${e?.message || e})\n`); }
        progressed = true;
        break;
      }
    }
  }
}

function ubEnsure() {
  if (ubHttp) return;
  ubHttp = true;
  const ubHttpSrv = createServer(async (req, res) => {
    try {
      const u = new URL(req.url || "/", "http://127.0.0.1");
      if (u.pathname === "/health") { const now = Date.now(); let nconn = 0; for (const [, e] of ubExtensions) if (now - e.lastPoll < 45000) nconn++; res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, queue: ubQueue.length, connected: nconn })); return; }
      const token = u.searchParams.get("token") || req.headers["x-token"];
      const good = ubToken();
      if (!good || token !== good) { process.stderr.write(`[native-mcp] ubrowser 401 ${u.pathname} token=${String(token || "").slice(0, 8)}...\n`); res.writeHead(401); res.end("bad token"); return; }
      if (req.method === "GET" && u.pathname === "/poll") {
        const extId = u.searchParams.get("ext") || "anon";
        const ext = ubExtensions.get(extId) || { lastPoll: 0, info: null };
        ext.lastPoll = Date.now();
        ubExtensions.set(extId, ext);
        ubLastPoll = Date.now();
        ubPrune(); // sem isto, msg expirada entregue a um poll tardio = efeito fantasma no Chrome
        const qi = ubNextIdx(extId);
        if (qi >= 0) { const q = ubQueue.splice(qi, 1)[0]; res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(q)); return; }
        const t = setTimeout(() => { const i = ubWaiters.findIndex((w) => w.res === res); if (i >= 0) ubWaiters.splice(i, 1); try { res.writeHead(204); res.end(); } catch (e) { process.stderr.write(`[canivete] ub poll 204 falhou (${e?.message || e})\n`); } }, 25000);
        ubWaiters.push({ res, t, extId });
        try { req.on("close", () => { const i = ubWaiters.findIndex((w) => w.res === res); if (i >= 0) { ubWaiters.splice(i, 1); clearTimeout(t); } }); } catch (e) { process.stderr.write(`[canivete] ub poll close-hook falhou (${e?.message || e})\n`); }
        return;
      }
      if (req.method === "POST" && (u.pathname === "/hello" || u.pathname === "/result" || u.pathname === "/exec" || u.pathname === "/ubpush")) {
        let body = "";
        await new Promise((ok, fail) => { const ch = []; let n = 0; req.on("data", (c) => { n += c.length; if (n > 20 * 1024 * 1024) fail(new Error("body > 20MB")); else ch.push(c); }); req.on("end", () => { body = Buffer.concat(ch).toString("utf8"); ok(); }); req.on("error", fail); });
        if (u.pathname === "/ubpush") {
          // push proativo de erro (mon-hook → content → background): buffer + avisa host.
          let p = {};
          try { p = JSON.parse(body); } catch {}
          ubAlertsPush(p.tabId, p.title, p.url, p.entries);
          try {
            process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/message", params: { level: "warning", logger: "canivete", data: `📬 console: erro novo em ${String(p.title || p.url || "aba").slice(0, 60)} — leia com n_ubrowser_act {action:"console", filter:"errors"}` } }) + "\n");
          } catch {}
          res.writeHead(200, { "content-type": "application/json" }); res.end('{"ok":true}');
          return;
        }
        if (u.pathname === "/hello") {
          let hi = null;
          try { hi = JSON.parse(body).info || null; } catch (e) { process.stderr.write(`[canivete] ub /hello json inválido (${e?.message || e})\n`); }
          if (hi && hi.probe) { res.writeHead(200, { "content-type": "application/json" }); res.end('{"ok":true,"probe":true}'); return; }
          const clientId = (hi && hi.clientId) || `anon-${Date.now().toString(36)}`;
          const ext = ubExtensions.get(clientId) || { lastPoll: Date.now(), info: null };
          ext.info = hi;
          ext.lastPoll = Date.now();
          ubExtensions.set(clientId, ext);
          if (ubExtensions.size > 50) { // cap: clientId trocado/anon por boot não cresce forever
            let oldest = null;
            for (const [oid, oe] of ubExtensions) if (!oldest || oe.lastPoll < ubExtensions.get(oldest).lastPoll) oldest = oid;
            if (oldest && oldest !== clientId) ubExtensions.delete(oldest);
          }
          ubLastPoll = Date.now();
          ubExtInfo = hi;
        }
        else if (u.pathname === "/result") { let p = {}; try { p = JSON.parse(body); } catch (e) { process.stderr.write(`[canivete] ub /result json inválido (${e?.message || e})\n`); } const payBytes = Buffer.byteLength(body || "", "utf8"); if (payBytes > UB_WARNPAY) process.stderr.write(`[canivete] ub /result grande (${payBytes}B id=${p?.id || "?"})\n`); const q = ubPending.get(p.id); if (q) { ubPending.delete(p.id); clearTimeout(q.timer); if (payBytes > UB_MAXPAY) { const s = body || ""; const chunks = []; for (let i = 0; i < s.length; i += UB_CHUNK) chunks.push(s.slice(i, i + UB_CHUNK)); q.resolve({ id: p.id, ok: true, chunks, chunked: true, bytes: payBytes, note: "resposta fatiada em chunks; use max/compact/offset p/ refinar" }); } else q.resolve(p); } }
        else {
          // /exec: drive local (localhost+token) sem MCP stdio — mesma trava anti-destrutiva
          let p = {};
          try { p = JSON.parse(body); } catch { res.writeHead(400, { "content-type": "application/json" }); res.end('{"ok":false,"error":"bad json"}'); return; }
          const a = p.args || {};
          if (ubRisk({ action: p.cmd, ...a }) === "high" && !(a.confirm && String(a.confirm).trim().length >= 4)) {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: `BLOQUEADO (alto risco). Só com pedido EXPLÍCITO + confirm. Ação: ${p.cmd}` }));
            return;
          }
          const map = { status: null, diag: "tab.diag", tabs: "tabs.list", read: "tab.read", snapshot: "tab.snapshot", scan: "tab.scan", shot: "tab.shot", goto: "tab.goto", back: "tab.back", forward: "tab.forward", reload: "tab.reload", click: "tab.click", fill: "tab.fill", press: "tab.press", scroll: "tab.scroll", wait: "tab.wait", evaluate: "tab.evaluate", cursor: "tab.cursor", new: "tab.new", close: "tab.close", select: "tab.select", highlight: "tab.highlight", waittext: "tab.waittext", type: "tab.type", count: "tab.count", attr: "tab.attr", html: "tab.html", flow: "tab.flow" };
          // fallthrough: qualquer tab.* futuro encaminha cru (a extensão valida e responde)
          const bridged = map[p.cmd] || (String(p.cmd || "").startsWith("tab.") ? p.cmd : null);
          if (p.cmd === "status") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, data: { connected: ubConnected(), lastPollAgoMs: ubLastPoll ? Date.now() - ubLastPoll : -1, queued: ubQueue.length, ext: ubExtInfo } })); return; }
          if (!bridged && p.cmd !== "wait") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: false, error: "cmd: status|diag|tabs|read|snapshot|scan|shot|goto|back|forward|reload|click|fill|press|scroll|wait|evaluate|cursor|select|highlight|waittext|type|new|close|flow (close só aba about:blank do agente; roubar foco: PROIBIDO pelo dono)" })); return; }
          if (p.cmd === "wait") { await new Promise((r) => setTimeout(r, Math.min(Number(a.waitMs ?? a.ms) || 2000, 15000))); res.writeHead(200, { "content-type": "application/json" }); res.end('{"ok":true,"data":{"waited":true}}'); return; }
          const r2 = await ubSend(bridged, { ...a }, Math.min(Number(p.timeoutMs) || UB_TIMEOUT_MS, 120000));
          if (r2.__offline || r2.__timeout) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: false, error: r2.__offline ? "EXTENSAO_OFFLINE" : "TIMEOUT_EXTENSAO" })); return; }
          res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: !!r2.ok, data: r2.data, error: r2.error, ...(r2.chunks ? { chunks: r2.chunks, chunked: true, bytes: r2.bytes, note: r2.note } : {}) }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" }); res.end('{"ok":true}');
        return;
      }
      res.writeHead(404); res.end("not found");
    } catch (e) { try { res.writeHead(500); res.end(String(e.message)); } catch (e2) { process.stderr.write(`[canivete] ub 500 falhou (${e2?.message || e2}) causa: ${e?.message || e}\n`); } }
  }).listen(UB_PORT, "127.0.0.1", () => process.stderr.write(`[native-mcp] ubrowser bridge em http://127.0.0.1:${UB_PORT}\n`));
  ubHttpSrv.on("error", (e) => { ubHttp = false; process.stderr.write(`[native-mcp] ubrowser porta ${UB_PORT} ocupada (${e.code}) — tentando de novo no primeiro uso\n`); });
}

ubToken(); // warm: lê/gera 1x no startup (fora do hot-path HTTP)
try { ubEnsure(); } catch (e) { process.stderr.write(`[native-mcp] ubrowser adiado: ${e.message}\n`); }

const ubConnected = () => {
  const now = Date.now();
  if (ubExtensions.size > 0) {
    for (const [, e] of ubExtensions) if (now - e.lastPoll < 45000) return true;
    return false;
  }
  return ubLastPoll ? (now - ubLastPoll < 45000) : false;
};
const UB_OFF = "EXTENSÃO OFFLINE — dono: abra o Chrome (janela NORMAL, mesmo perfil, sem anônimo) com a extensão UBrowser ATIVA no popup, e peça de novo.";

function ubSend(cmd, args = {}, timeoutMs = UB_TIMEOUT_MS, target = null) {
  ubEnsure();
  return new Promise((resolve) => {
    if (!ubConnected()) { resolve({ __offline: true }); return; }
    const to = Math.min(Math.max(Number(timeoutMs) || UB_TIMEOUT_MS, 1000), 300000);
    const id = `u${Date.now().toString(36)}${(ubSeq++).toString(36)}`;
    const timer = setTimeout(() => { ubPending.delete(id); resolve({ __timeout: true }); }, to);
    ubPending.set(id, { resolve, timer });
    ubQueue.push({ id, cmd, args, target, exp: Date.now() + to });
    ubPrune();
    if (ubQueue.length > 50) ubQueue.splice(0, ubQueue.length - 50);
    ubFlush();
  });
}

export function ubResolveProfile(profile) {
  if (!profile) return null;
  const p = String(profile).toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const [id, e] of ubExtensions) {
    if (id.toLowerCase() === String(profile).toLowerCase()) return id;
    const info = e.info || {};
    const haystack = [id, info.ua || "", ...(Array.isArray(info.tabUrls) ? info.tabUrls : []), info.profileLabel || ""].join(" ").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (p && haystack.includes(p)) return id;
  }
  return null;
}

export function ubListExtensions() {
  ubPrune(); // leitura auto-saneadora: stats/erros nunca contam msg expirada como pendente
  const now = Date.now();
  return [...ubExtensions.entries()].map(([id, e]) => {
    let queued = 0;
    for (const q of ubQueue) if (q.target === null || q.target === id) queued++;
    const info = e.info;
    return {
      id,
      lastPollAgoMs: now - e.lastPoll,
      connected: now - e.lastPoll < 45000,
      ...(info && info.profileLabel ? { profileLabel: String(info.profileLabel).slice(0, 60) } : {}),
      queued, // msgs na fila dirigidas a este cliente (ou broadcast) — 0 na fila vazia
      info,
    };
  });
}

import { riskOf as ubRisk } from "./risk.mjs";

export { ubEnsure, ubSend, ubConnected, UB_OFF, ubRisk, UB_PORT, ubAlertsPush, ubAlertsPending, ubAlertsRead, ubAlertsHint };
export function ubStats() {
  // reutiliza ubListExtensions (fonte única): id/idade/connected/profileLabel/queued/info por cliente
  const extensions = ubListExtensions();
  return {
    queued: ubQueue.length, // fila pendente agora
    pending: ubPending.size, // idas-voltas aguardando /result (timeout/resposta pendente)
    expiredDropped: ubExpired, // acumulado: msgs descartadas por TTL (caller desistiu antes do poll)
    extensions,
    ext: ubExtInfo,
    port: UB_PORT,
    lastPollAgoMs: ubLastPoll ? Date.now() - ubLastPoll : -1,
  };
}
