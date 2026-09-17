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
const UB_TIMEOUT_DEFAULT = Number(process.env.CANIVETE_UB_TIMEOUT) || 60000;
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

const ubQueue = [], ubWaiters = [], ubPending = new Map();
let ubSeq = 0, ubLastPoll = 0, ubExtInfo = null, ubHttp = false;

function ubFlush() {
  while (ubWaiters.length && ubQueue.length) {
    const w = ubWaiters.shift();
    clearTimeout(w.t);
    try { w.res.writeHead(200, { "content-type": "application/json" }); w.res.end(JSON.stringify(ubQueue.shift())); } catch (e) { process.stderr.write(`[canivete] ubFlush falhou (${e?.message || e})\n`); }
  }
}

function ubEnsure() {
  if (ubHttp) return;
  ubHttp = true;
  const ubHttpSrv = createServer(async (req, res) => {
    try {
      const u = new URL(req.url || "/", "http://127.0.0.1");
      if (u.pathname === "/health") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, queue: ubQueue.length })); return; }
      const token = u.searchParams.get("token") || req.headers["x-token"];
      const good = ubToken();
      if (!good || token !== good) { process.stderr.write(`[native-mcp] ubrowser 401 ${u.pathname} token=${String(token || "").slice(0, 8)}...\n`); res.writeHead(401); res.end("bad token"); return; }
      if (req.method === "GET" && u.pathname === "/poll") {
        ubLastPoll = Date.now();
        if (ubQueue.length) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(ubQueue.shift())); return; }
        const t = setTimeout(() => { const i = ubWaiters.findIndex((w) => w.res === res); if (i >= 0) ubWaiters.splice(i, 1); try { res.writeHead(204); res.end(); } catch (e) { process.stderr.write(`[canivete] ub poll 204 falhou (${e?.message || e})\n`); } }, 25000);
        ubWaiters.push({ res, t });
        try { req.on("close", () => { const i = ubWaiters.findIndex((w) => w.res === res); if (i >= 0) { ubWaiters.splice(i, 1); clearTimeout(t); } }); } catch (e) { process.stderr.write(`[canivete] ub poll close-hook falhou (${e?.message || e})\n`); } // cliente caiu antes dos 25s: libera o waiter (era leak até o timeout)
        return;
      }
      if (req.method === "POST" && (u.pathname === "/hello" || u.pathname === "/result" || u.pathname === "/exec")) {
        let body = "";
        await new Promise((ok, fail) => { const ch = []; let n = 0; req.on("data", (c) => { n += c.length; if (n > 20 * 1024 * 1024) fail(new Error("body > 20MB")); else ch.push(c); }); req.on("end", () => { body = Buffer.concat(ch).toString("utf8"); ok(); }); req.on("error", fail); });
        if (u.pathname === "/hello") { try { ubExtInfo = JSON.parse(body).info || null; } catch (e) { process.stderr.write(`[canivete] ub /hello json inválido (${e?.message || e})\n`); } ubLastPoll = Date.now(); }
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
          const map = { status: null, diag: "tab.diag", tabs: "tabs.list", read: "tab.read", snapshot: "tab.snapshot", scan: "tab.scan", shot: "tab.shot", goto: "tab.goto", back: "tab.back", forward: "tab.forward", reload: "tab.reload", click: "tab.click", fill: "tab.fill", press: "tab.press", scroll: "tab.scroll", wait: "tab.wait", evaluate: "tab.evaluate", cursor: "tab.cursor", new: "tab.new", select: "tab.select", highlight: "tab.highlight", waittext: "tab.waittext", type: "tab.type", count: "tab.count", attr: "tab.attr", html: "tab.html", flow: "tab.flow" };
          // fallthrough: qualquer tab.* futuro encaminha cru (a extensão valida e responde)
          const bridged = map[p.cmd] || (String(p.cmd || "").startsWith("tab.") ? p.cmd : null);
          if (p.cmd === "status") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, data: { connected: ubConnected(), lastPollAgoMs: ubLastPoll ? Date.now() - ubLastPoll : -1, queued: ubQueue.length, ext: ubExtInfo } })); return; }
          if (!bridged && p.cmd !== "wait") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: false, error: "cmd: status|diag|tabs|read|snapshot|scan|shot|goto|back|forward|reload|click|fill|press|scroll|wait|evaluate|cursor|select|highlight|waittext|type|new|flow (fechar abas e roubar foco: PROIBIDO pelo dono)" })); return; }
          if (p.cmd === "wait") { await new Promise((r) => setTimeout(r, Math.min(Number(a.ms) || 2000, 15000))); res.writeHead(200, { "content-type": "application/json" }); res.end('{"ok":true,"data":{"waited":true}}'); return; }
          const r2 = await ubSend(bridged, { ...a }, Math.min(Number(p.timeoutMs) || UB_TIMEOUT_DEFAULT, 120000));
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

const ubConnected = () => Date.now() - ubLastPoll < 45000;
const UB_OFF = "EXTENSÃO OFFLINE — dono: abra o Chrome (janela NORMAL, mesmo perfil, sem anônimo) com a extensão UBrowser ATIVA no popup, e peça de novo.";

function ubSend(cmd, args = {}, timeoutMs = UB_TIMEOUT_DEFAULT) {
  ubEnsure();
  return new Promise((resolve) => {
    if (!ubConnected()) { resolve({ __offline: true }); return; }
    const id = `u${Date.now().toString(36)}${(ubSeq++).toString(36)}`;
    const timer = setTimeout(() => { ubPending.delete(id); resolve({ __timeout: true }); }, timeoutMs);
    ubPending.set(id, { resolve, timer });
    ubQueue.push({ id, cmd, args });
    if (ubQueue.length > 50) ubQueue.splice(0, ubQueue.length - 50);
    ubFlush();
  });
}

import { riskOf as ubRisk } from "./risk.mjs";

export { ubEnsure, ubSend, ubConnected, UB_OFF, ubRisk, UB_PORT };
export function ubStats() { return { queued: ubQueue.length, ext: ubExtInfo, port: UB_PORT, lastPollAgoMs: ubLastPoll ? Date.now() - ubLastPoll : -1 }; }
