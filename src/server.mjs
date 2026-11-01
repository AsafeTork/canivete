#!/usr/bin/env node
// canivete — MCP universal (qualquer CLI via stdio): fs+exec, web, apis, tasks, devengine, browsers.
// Modo remoto (sem restart do host p/ trocar código): node src/server.mjs --http 19423
import { createInterface } from "node:readline";
import { join } from "node:path";
import { TOOLS, reg, out, sendToHost, CTX, CTX_BUDGET } from "./lib/ctx.mjs";
import { TOOL_GROUPS, groupOf as groupOfCore, firstSentence as firstSentenceCore } from "./core/taxonomy.mjs";
import { buildToolsList, dispatchStdio } from "./core/rpc.mjs";
import { sweepTask, safeTaskIds, readJson, TASKS_DIR } from "./lib/tasks.mjs";
import { ubEnsure } from "./lib/ubridge.mjs";
import "./lib/fs.mjs";
import "./lib/web.mjs";
import "./lib/apis.mjs";
import "./lib/tasks.mjs";
import "./lib/devengine.mjs";
import "./lib/tools-browser.mjs";
import "./lib/tools-codespace.mjs";
import "./lib/tools-owner.mjs";
import "./lib/tools-whatsapp.mjs";
import "./lib/feedback.mjs";
import "./lib/elemreports.mjs";

reg("n_tools_info", {
  description: "Catálogo agrupado do canivete: filesystem+exec, web/APIs sem chave, orquestração, DevEngine, browsers e meta. Use para descobrir o que o MCP faz e qual tool chamar.",
  inputSchema: { type: "object", properties: {}, required: [] },
  run: () => {
    const first = firstSentenceCore;
    const g = (names) => names.map((n) => { const t = TOOLS.get(n); return t ? `${t.name} — ${first(t.description)}` : n; }).join("\n");
    const taskOn = TOOLS.has("n_task");
    const orchNames = ["n_task", "n_task_wait", "n_task_status", "n_task_send", "n_task_recv", "n_task_peek", "n_task_tail", "n_task_notifications", "n_task_delete", "n_list_models", "n_todowrite", "n_todo"].filter((n) => TOOLS.has(n));
    const groups = TOOL_GROUPS.map((gr) =>
      gr.title === "Orquestração"
        ? { title: taskOn ? "Orquestração paralela monitorada" : "Todos (subagentes desativados)", hint: taskOn ? "spawn sync/async, wait any/all, status com modelo+mailbox, send/recv/peek/tail não-bloqueante, delete, models, todos" : "todos in-memory; subagentes voltam com CANIVETE_TASK_ENABLE=1", names: orchNames }
        : gr
    );
    const listed = new Set(groups.flatMap((gr) => gr.names));
    const extras = [...TOOLS.keys()].filter((n) => !listed.has(n));
    const lines = [
      `== CANIVETE (src/server.mjs, 1.0.0, ${TOOLS.size} tools — MCP universal, qualquer CLI) ==`,
      taskOn ? "Runner atual: CANIVETE_RUNNER=opencode (ou genérico via CANIVETE_RUN_TEMPLATE)." : "Subagentes desativados (RAM) — reative com CANIVETE_TASK_ENABLE=1.",
      "",
      ...groups.flatMap((gr) => [`-- ${gr.title} (${gr.names.length}): ${gr.hint} --`, g(gr.names), ""]),
    ];
    if (extras.length > 0) lines.push(`-- Outras (${extras.length}): não agrupadas (novas sem grupo) --`, g(extras), "");
    lines.push(`detalhe: n_find_tools "<query>"`);
    return out(lines.join("\n").trimEnd());
  },
});

reg("n_ctx_status", {
  description: "A LLM manipula o próprio contexto: mostra gasto da sessão (calls, chars, ~tokens por tool) vs orçamento CANIVETE_CTX_BUDGET. Quando usar: antes de dumps grandes; se estourar, prefira destilados/compact/max menores.",
  inputSchema: { type: "object", properties: {}, required: [] },
  run: () => {
    const top = [...CTX.byTool.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([n, c]) => `${n}:${c}`).join(" ");
    const pct = Math.round((100 * CTX.chars) / CTX_BUDGET);
    return out(`CTX calls=${CTX.calls} chars=${CTX.chars} (~${Math.round(CTX.chars / 4)} tokens) orçamento=${CTX_BUDGET} uso=${pct}% top=[${top || "-"}]${pct >= 90 ? " | ACIMA DE 90%: use mode distill/compact/max menores" : ""}`);
  },
});

reg("n_find_tools", {
  description: "Busca local de tools por keyword (tool-search enxuto). Use para descobrir qual tool chamar sem ler o catálogo completo.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Keyword(s) para buscar em nome+descrição (case-insensitive)." },
      limit: { type: "integer", minimum: 1, maximum: 20, default: 8, description: "Máx. de resultados (default 8, max 20)." },
    },
    required: ["query"],
  },
  run: (args = {}) => {
    const query = String(args.query ?? "").trim().toLowerCase();
    if (!query) return out("n_find_tools: query vazia — informe keyword(s) para buscar em nome+descrição.");
    const limit = Math.min(Math.max(Number(args.limit) || 8, 1), 20);
    const terms = query.split(/\s+/).filter(Boolean);
    const groups = TOOL_GROUPS.map((gr) =>
      gr.title === "Orquestração"
        ? { title: TOOLS.has("n_task") ? "Orquestração paralela monitorada" : "Todos (subagentes desativados)", names: ["n_task", "n_task_wait", "n_task_status", "n_task_send", "n_task_recv", "n_task_peek", "n_task_tail", "n_task_notifications", "n_task_delete", "n_list_models", "n_todowrite", "n_todo"].filter((n) => TOOLS.has(n)) }
        : gr
    );
    const groupOf = (n) => groupOfCore(n, groups);
    const firstSentence = firstSentenceCore;
    const scored = [];
    for (const t of TOOLS.values()) {
      const name = t.name.toLowerCase();
      const desc = String(t.description ?? "").toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (name.includes(term)) score += 2;
        else if (desc.includes(term)) score += 1;
      }
      if (score > 0) scored.push({ tool: t, score });
    }
    scored.sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name));
    const hits = scored.slice(0, limit);
    if (hits.length === 0) return out(`n_find_tools: 0 resultados para "${args.query}". Tente outra keyword ou n_tools_info.`);
    const lines = hits.map(({ tool: t }) => `${t.name} [${groupOf(t.name)}] — ${firstSentence(t.description)}`);
    return out(`${hits.length} resultado(s) para "${args.query}":\n${lines.join("\n")}`);
  },
});

await Promise.allSettled(
  safeTaskIds().map(async (id) => {
    try {
      await sweepTask(readJson(join(TASKS_DIR, `${id}.json`), null));
    } catch {}
  })
);

// Modo remoto (sem restart do host p/ trocar código): node src/server.mjs --http 19423
// (depois deste ponto só roda o loop stdio; o remoto já registrou tudo acima)
const httpIdx = process.argv.indexOf("--http");
if (httpIdx >= 0) {
  const port = Number(process.argv[httpIdx + 1]) || 19423;
  const { serveHttp, getToken } = await import("./remote.mjs");
  await serveHttp(port, getToken());
  await new Promise(() => {});
}

// Modo PROXY (multi-CLI): daemon canivete (serve.mjs) já ativo na :CANIVETE_MCP_HTTP_PORT (19423)
// → este stdio NÃO re-bind ponte/painel/headless (era a briga entre CLIs: opencode remoto ok,
// codex stdio quebrava em EADDRINUSE — ou vice-versa quando só um rodava). Cada linha JSON-RPC
// vira POST /mcp no daemon e a resposta volta pro CLI: mesmas tools, UMA pilha de serviços.
const MCP_HTTP_PORT = Number(process.env.CANIVETE_MCP_HTTP_PORT) || 19423;
let proxyMode = false;
if (httpIdx < 0) {
  try {
    const _c = new AbortController();
    const _t = setTimeout(() => _c.abort(), 1200);
    const _h = await fetch(`http://127.0.0.1:${MCP_HTTP_PORT}/health`, { signal: _c.signal });
    clearTimeout(_t);
    const _j = await _h.json().catch(() => null);
    proxyMode = !!(_j && _j.ok === true);
    if (proxyMode) process.stderr.write(`[canivete] daemon já ativo na :${MCP_HTTP_PORT} (${_j.tools} tools) — stdio em modo proxy (multi-CLI: nenhuma porta re-bindada)\n`);
  } catch {}
}
async function proxyMcp(msg) {
  const { getToken } = await import("./remote.mjs");
  const isArray = Array.isArray(msg);
  const ids = (isArray ? msg : [msg]).map((m) => (m && typeof m === "object" && "id" in m ? m.id : undefined));
  const temId = ids.some((i) => i !== undefined);
  try {
    const r = await fetch(`http://127.0.0.1:${MCP_HTTP_PORT}/mcp`, { method: "POST", headers: { "content-type": "application/json", "x-token": getToken() }, body: JSON.stringify(msg) });
    const j = await r.json().catch(() => null);
    if (!temId) return; // notification: daemon não devolve resposta
    const vazio = !j || (Array.isArray(j) ? j.length === 0 : Object.keys(j).length === 0);
    if (!r.ok || vazio) return sendToHost({ jsonrpc: "2.0", id: ids.find((i) => i !== undefined), error: { code: -32603, message: `daemon MCP (:${MCP_HTTP_PORT}) HTTP ${r.status}${vazio ? " sem corpo" : ""} — confira o token (~/.config/canivete/token.txt) e a saúde do serviço canivete` } });
    if (isArray && Array.isArray(j)) { for (const item of j) sendToHost(item); return; }
    sendToHost(Array.isArray(j) ? j[0] : j);
  } catch (e) {
    if (temId) sendToHost({ jsonrpc: "2.0", id: ids.find((i) => i !== undefined), error: { code: -32603, message: `daemon MCP (:${MCP_HTTP_PORT}) inacessível (${String(e?.cause?.code || e?.message || e).slice(0, 80)}) — serviço canivete caiu? 'systemctl --user restart canivete' (ou pare o daemon p/ este stdio assumir as portas)` } });
  }
}

// Annotations de risco p/ tools/list — ver core/rpc.mjs:annotationsFor (fonte única).
// Heurística por nome (determinística, sem I/O): read/list/glob/grep/search/fetch/status/tabs/snapshot → readOnly;
// write/edit/patch/bash/delete/send/act/fill/type → destructive; resto → idempotent.

// Self-check de startup (warn-and-continue: nunca aborta o boot — só console.error).
try {
  try {
    const _ver = String(process.versions?.node ?? "");
    const _major = Number(_ver.split(".")[0]);
    if (!Number.isFinite(_major) || _major < 22) {
      console.error(
        `[canivete boot] Node ${_ver || "?"} < 22 exigido (package.json engines >=22). ` +
          `Ação: atualize (ex: 'nvm install 22 && nvm use 22'). Seguindo com warn-and-continue.`
      );
    }
  } catch {}
  try {
    const { readFile: _rfModels } = await import("node:fs/promises");
    const { dirname: _dirname, join: _joinCk } = await import("node:path");
    const { fileURLToPath: _f2p } = await import("node:url");
    const _root = _dirname(_dirname(_f2p(import.meta.url)));
    const _modelsPath = _joinCk(_root, "config/models.json");
    try {
      JSON.parse(await _rfModels(_modelsPath, "utf8"));
    } catch (e) {
      console.error(
        `[canivete boot] config/models.json ilegível em ${_modelsPath} (${e?.message ?? e}). ` +
          `Ação: confira se existe e é JSON válido (ex: 'cat config/models.json'). Seguindo com warn-and-continue.`
      );
    }
  } catch {}
  try {
    if (httpIdx >= 0) {
      const _port = Number(process.argv[httpIdx + 1]) || 19423;
      const { createServer: _mkProbe } = await import("node:net");
      const _occupied = await new Promise((resolve) => {
        const _probe = _mkProbe();
        _probe.once("error", (e) => resolve(e?.code === "EADDRINUSE"));
        _probe.once("listening", () => _probe.close(() => resolve(false)));
        _probe.listen(_port, "127.0.0.1");
      });
      if (_occupied) {
        let _who = "processo desconhecido";
        try {
          const { readFile: _rfProc, readdir: _rdProc, readlink: _rlProc } = await import("node:fs/promises");
          const _hex = _port.toString(16).toUpperCase().padStart(4, "0");
          const _inodes = new Set();
          for (const _f of ["/proc/net/tcp", "/proc/net/tcp6"]) {
            try {
              const _txt = await _rfProc(_f, "utf8");
              for (const _ln of _txt.split("\n").slice(1)) {
                const _parts = _ln.trim().split(/\s+/);
                if (_parts.length < 10) continue;
                if ((_parts[1] || "").toUpperCase().endsWith(":" + _hex)) {
                  if (_parts[9]) _inodes.add(`socket:[${_parts[9]}]`);
                }
              }
            } catch {}
          }
          if (_inodes.size > 0) {
            const _pids = (await _rdProc("/proc")).filter((n) => /^\d+$/.test(n)).slice(0, 400);
            for (const _pid of _pids) {
              let _fds;
              try { _fds = await _rdProc(`/proc/${_pid}/fd`); } catch { continue; }
              let _found = false;
              for (const _fd of _fds) {
                let _link;
                try { _link = await _rlProc(`/proc/${_pid}/fd/${_fd}`); } catch { continue; }
                if (_inodes.has(_link)) {
                  let _cmd = "";
                  try { _cmd = (await _rfProc(`/proc/${_pid}/cmdline`, "utf8")).replace(/\0/g, " ").trim().slice(0, 120); } catch {}
                  _who = `pid ${_pid}${_cmd ? ` (${_cmd})` : ""}`;
                  _found = true;
                  break;
                }
              }
              if (_found) break;
            }
            if (_who === "processo desconhecido") _who = `inode(s) ${[..._inodes].join(",")} (sem permissão p/ /proc/*/fd — rode 'ss -ltnp | grep :${_port}')`;
          } else {
            _who = `nada em /proc p/ :${_port} (confira com 'ss -ltnp | grep :${_port}' ou 'lsof -i :${_port}')`;
          }
        } catch {}
        console.error(
          `[canivete boot] porta --http ${_port} ocupada por ${_who}. ` +
            `Ação: use outra porta ('node src/server.mjs --http <livre>') ou libere ('kill <pid>' / 'fuser -k ${_port}/tcp'). Seguindo com warn-and-continue.`
        );
      }
    }
  } catch {}
} catch {}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on("line", async (raw) => {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  if (proxyMode) return proxyMcp(msg);
  // Dispatch compartilhado (ver core/rpc.mjs) — mesma semântica do modo remoto.
  const resp = await dispatchStdio(msg, TOOLS, sendToHost);
  if (resp) sendToHost(resp);
});
