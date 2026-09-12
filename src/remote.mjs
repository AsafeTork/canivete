// canivete — modo remoto (Streamable HTTP) para qualquer CLI.
// Uso: node src/server.mjs --http 19423
// Auth: header X-Token, ?token= ou Authorization: Bearer (mesmo token da extensão).
// Por que remoto: o host reconecta por chamada — trocar CÓDIGO nunca exige restart do opencode.
// (Trocar CONFIG exige 1 restart: opencode lê config só no boot.)
import { createServer } from "node:http";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { TOOLS } from "./lib/ctx.mjs";
import "./lib/fs.mjs";
import "./lib/web.mjs";
import "./lib/apis.mjs";
import "./lib/tasks.mjs";
import "./lib/devengine.mjs";
import "./lib/tools-browser.mjs";
import "./lib/tools-owner.mjs";

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
  const srv = createServer(async (req, res) => {
    try {
      const u = new URL(req.url || "/", "http://127.0.0.1");
      if (u.pathname === "/health" && req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, tools: TOOLS.size }));
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
        req.on("data", (c) => { n += c.length; if (n > 2 * 1024 * 1024) fail(new Error("body > 2MB")); else ch.push(c); }); // era sem teto (POST gigante = OOM)
        req.on("end", () => { body = Buffer.concat(ch).toString("utf8"); ok(); });
        req.on("error", fail);
      });
      let msg;
      try { msg = JSON.parse(body); } catch { res.writeHead(400); res.end("bad json"); return; }
      const batch = Array.isArray(msg) ? msg : [msg];
      const out = [];
      for (const m of batch) {
        if (!m || m.method?.startsWith("notifications/") || m.id === undefined || m.id === null) continue;
        if (m.method === "initialize") {
          out.push({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: m.params?.protocolVersion || "2024-11-05", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "canivete", version: "1.0.0" } } });
        } else if (m.method === "ping") {
          out.push({ jsonrpc: "2.0", id: m.id, result: {} });
        } else if (m.method === "tools/list") {
          out.push({ jsonrpc: "2.0", id: m.id, result: { tools: [...TOOLS.values()].map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) } });
        } else if (m.method === "tools/call") {
          const { name: tn, arguments: args } = m.params || {};
          const tool = TOOLS.get(tn);
          if (!tool) { out.push({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: `unknown tool: ${tn}` }], isError: true } }); continue; }
          try { out.push({ jsonrpc: "2.0", id: m.id, result: await tool.run(args || {}) }); }
          catch (e) { out.push({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: `tool error: ${e?.message || e}` }], isError: true } }); }
        } else {
          out.push({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: `unknown method: ${m.method}` } });
        }
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(Array.isArray(msg) ? out : out[0] || {}));
    } catch (e) {
      try { res.writeHead(500); res.end("internal"); } catch {}
    }
  });
  await new Promise((res, rej) => {
    srv.on("error", rej);
    srv.listen(port, "127.0.0.1", res);
  });
  process.stderr.write(`[canivete] remoto em http://127.0.0.1:${port}/mcp (${TOOLS.size} tools)\n`);
  return srv;
}
