// canivete — modo remoto (Streamable HTTP) para qualquer CLI.
// Uso: node src/server.mjs --http 19423
// Auth: header X-Token, ?token= ou Authorization: Bearer (mesmo token da extensão).
// Rotação do token: troque CANIVETE_TOKEN (ou o arquivo em CANIVETE_TOKEN_FILE) e reinicie o servidor — clientes passam a usar o novo token na próxima chamada.
// Por que remoto: o host reconecta por chamada — trocar CÓDIGO nunca exige restart do opencode.
// (Trocar CONFIG exige 1 restart: opencode lê config só no boot.)
import { createServer } from "node:http";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { TOOLS, toolCount } from "./lib/ctx.mjs";
import { dispatchHttpItem } from "./core/rpc.mjs";
import { toolsHashOf } from "./core/tool-version.mjs";
import { autoUpdateStatus } from "./lib/autoupdate.mjs";
import "./lib/fs.mjs";
import "./lib/web.mjs";
import "./lib/apis.mjs";
import "./lib/tasks.mjs";
import "./lib/devengine.mjs";
import "./lib/tools-browser.mjs";
import "./lib/tools-owner.mjs";

// Limite do corpo POST via env CANIVETE_MAX_BODY em bytes (default 2MB mantido).
const MAX_BODY = Number(process.env.CANIVETE_MAX_BODY) || 2 * 1024 * 1024;

export function getToken() {
  if (process.env.CANIVETE_TOKEN) return process.env.CANIVETE_TOKEN.trim();
  const p = process.env.CANIVETE_TOKEN_FILE || `${process.env.HOME || "/root"}/.config/canivete/token.txt`;
  try {
    const t = (readFileSync(p, "utf8") || "").trim();
    if (t) return t;
  } catch {}
  try {
    const t = randomBytes(24).toString("hex");
    mkdirSync(p.split("/").slice(0, -1).join("/"), { recursive: true });
    writeFileSync(p, t, { mode: 0o600 });
    process.stderr.write(`[canivete] token gerado em ${p} — cole na extensão\n`);
    return t;
  } catch (e) {
    process.stderr.write(`[canivete] sem token: ${e.message}\n`);
    return "";
  }
}

export async function serveHttp(port, token) {
  // Clientes stdio (codex/claude) são proxies: cada chamada vira POST /mcp. Eles não
  // têm canal push, então a Mudança do catálogo viaja junto da PRÓXIMA resposta HTTP
  // como notificação JSON-RPC extra — o proxy repassa cada item para o stdout.
  const notifiedHash = new Map();
  const srv = createServer(async (req, res) => {
    try {
      const u = new URL(req.url || "/", "http://127.0.0.1");
      if (u.pathname === "/health" && req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, tools: toolCount(), toolsHash: toolsHashOf(TOOLS), autoUpdate: autoUpdateStatus() }));
        return;
      }
      if (u.pathname !== "/mcp") { res.writeHead(404); res.end("not found"); return; }
      const tok = req.headers["x-token"] || u.searchParams.get("token") || String(req.headers["authorization"] || "").replace(/^Bearer /i, "");
      if (!token || tok !== token) {
        process.stderr.write(`[canivete] 401 ${req.method} ${u.pathname} hdrs=${Object.keys(req.headers).join(",")}\n`);
        res.writeHead(401, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "bad token" })); return;
      }
      if (req.method !== "POST") { res.writeHead(405); res.end("POST only"); return; }
      let body = "";
      await new Promise((ok, fail) => {
        const ch = [];
        let n = 0;
        req.on("data", (c) => { n += c.length; if (n > MAX_BODY) fail(new Error(`body > ${MAX_BODY} bytes`)); else ch.push(c); }); // teto via CANIVETE_MAX_BODY (default 2MB; POST gigante = OOM)
        req.on("end", () => { body = Buffer.concat(ch).toString("utf8"); ok(); });
        req.on("error", fail);
      });
      let msg;
      try { msg = JSON.parse(body); } catch { res.writeHead(400); res.end("bad json"); return; }
      const batch = Array.isArray(msg) ? msg : [msg];
      const init = batch.some((item) => item?.method === "initialize");
      const agentSessionId = String(req.headers["x-canivete-agent-session"] || req.headers["mcp-session-id"] || (init ? `http:${randomUUID()}` : `http-legacy:${req.headers["user-agent"] || req.socket.remoteAddress || "anonymous"}`)).slice(0, 120);
      if (init) res.setHeader("Mcp-Session-Id", agentSessionId);
      const out = [];
      // Dispatch compartilhado (ver core/rpc.mjs) — mesma semântica do stdio,
      // formato remoto (ordem de registro, descrição em 120 chars, sem annotations).
      for (const m of batch) {
        const r = await dispatchHttpItem(m, TOOLS, agentSessionId);
        if (r) out.push(r);
      }
      // Notifica só proxies stdio. Opencode usa HTTP direto e não aceita resposta
      // em batch para um request único — seu cliente descobre o catálogo por chamada.
      if (agentSessionId.startsWith("stdio:")) {
        const hash = toolsHashOf(TOOLS);
        const prev = notifiedHash.get(agentSessionId);
        if (prev !== hash) {
          notifiedHash.set(agentSessionId, hash);
          // Também no primeiro pedido da sessão: o Codex pode ter iniciado com o
          // catálogo antigo em cache antes de o daemon ser reiniciado.
          out.push({ jsonrpc: "2.0", method: "notifications/tools/list_changed", params: {} });
        }
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(Array.isArray(msg) || out.length > 1 ? out : out[0] || {}));
    } catch (e) {
      try { res.writeHead(500); res.end("internal"); } catch {}
    }
  });
  await new Promise((res, rej) => {
    srv.on("error", rej);
    srv.listen(port, "127.0.0.1", res);
  });
  process.stderr.write(`[canivete] remoto em http://127.0.0.1:${port}/mcp (${toolCount()} tools)\n`);
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stderr.write(`[canivete] ${signal}: encerrando após concluir chamadas ativas\n`);
    const forceTimer = setTimeout(() => {
      process.stderr.write("[canivete] timeout de encerramento; forçando saída\n");
      process.exit(1);
    }, 60000);
    forceTimer.unref();
    srv.close((error) => {
      clearTimeout(forceTimer);
      if (error) process.stderr.write(`[canivete] erro no encerramento HTTP: ${error.message}\n`);
      process.exit(error ? 1 : 0);
    });
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
  return srv;
}
