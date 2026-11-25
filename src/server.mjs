#!/usr/bin/env node
// canivete — MCP universal (qualquer CLI via stdio): fs+exec, web, apis, tasks, devengine, browsers.
// Modo remoto (sem restart do host p/ trocar código): node src/server.mjs --http 19423
import { createInterface } from "node:readline";
import { join } from "node:path";
import { TOOLS, reg, out, sendToHost, CTX, CTX_BUDGET, visibleTools, toolCount } from "./lib/ctx.mjs";
import { TOOL_GROUPS, groupOf as groupOfCore, firstSentence as firstSentenceCore } from "./core/taxonomy.mjs";
import { installToolConsolidation } from "./core/tool-consolidation.mjs";
import { buildToolsList, dispatchStdio, MCP_AGENT_SESSION_ID } from "./core/rpc.mjs";
import { startAutoUpdate } from "./lib/autoupdate.mjs";
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
import "./lib/tools-media.mjs";
import "./lib/tools-adb.mjs";
import "./lib/feedback.mjs";
import "./lib/elemreports.mjs";

reg("cv_tools_info", {
  description: "Lista as tools do Canivete por categoria. Use detail=true para incluir resumo e parâmetros; cv_find_tools traz a descrição integral de uma tool.",
  inputSchema: { type: "object", properties: { detail: { type: "boolean", default: false, description: "Inclui resumo e nomes dos parâmetros de todas as tools; saída maior" } }, required: [] },
  run: ({ detail = false } = {}) => {
    const first = firstSentenceCore;
    const g = (names) => names.map((n) => { const t = TOOLS.get(n); return t ? `${t.name} — ${first(t.description)}` : n; }).join("\n");
    const taskOn = TOOLS.has("cv_task_start");
    const groups = TOOL_GROUPS.map((gr) => ({
      ...gr,
      title: gr.dynamicTitle ? (taskOn ? "Orquestração paralela monitorada" : "Tarefas e contexto") : gr.title,
      names: gr.names.filter((n) => TOOLS.get(n)?.public !== false),
    })).filter((gr) => gr.names.length > 0);
    const listed = new Set(groups.flatMap((gr) => gr.names));
    const extras = visibleTools().map((tool) => tool.name).filter((n) => !listed.has(n));
    const lines = [
      `== CANIVETE (src/server.mjs, 1.0.0, ${toolCount()} tools — MCP universal, qualquer CLI) ==`,
      taskOn ? "Runner atual: CANIVETE_RUNNER=opencode (ou genérico via CANIVETE_RUN_TEMPLATE)." : "Subagentes desativados (RAM) — reative com CANIVETE_TASK_ENABLE=1.",
      "",
      ...groups.flatMap((gr) => [`-- ${gr.title} (${gr.names.length}) --`, detail ? g(gr.names) : gr.names.join(" "), ""]),
    ];
    if (extras.length > 0) lines.push(`-- Outras (${extras.length}) --`, detail ? g(extras) : extras.join(" "), "");
    lines.push(`detalhe: cv_help {query:"termo",detail:true}`);
    return out(lines.join("\n").trimEnd());
  },
});

reg("cv_ctx_status", {
  description: "A LLM manipula o próprio contexto: mostra gasto da sessão (calls, chars, ~tokens por tool) vs orçamento CANIVETE_CTX_BUDGET. Quando usar: antes de dumps grandes; se estourar, prefira destilados/compact/max menores.",
  inputSchema: { type: "object", properties: {}, required: [] },
  run: () => {
    const top = [...CTX.byTool.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([n, c]) => `${n}:${c}`).join(" ");
    const pct = Math.round((100 * CTX.chars) / CTX_BUDGET);
    return out(`CTX calls=${CTX.calls} chars=${CTX.chars} (~${Math.round(CTX.chars / 4)} tokens) orçamento=${CTX_BUDGET} uso=${pct}% top=[${top || "-"}]${pct >= 90 ? " | ACIMA DE 90%: use mode distill/compact/max menores" : ""}`);
  },
});

reg("cv_find_tools", {
  description: "Busca tools por nome ou descrição. Use detail=true para ver instrução integral e schema de uma tool.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Keyword(s) para buscar em nome+descrição (case-insensitive)." },
      limit: { type: "integer", minimum: 1, maximum: 20, default: 8, description: "Máx. de resultados (default 8, max 20)." },
      detail: { type: "boolean", default: false, description: "Inclui descrição completa e inputSchema dos resultados; refine query para limitar o custo" },
    },
    required: ["query"],
  },
  run: (args = {}) => {
    const query = String(args.query ?? "").trim().toLowerCase();
    if (!query) return out("cv_find_tools: query vazia — informe keyword(s) para buscar em nome+descrição.");
    const limit = Math.min(Math.max(Number(args.limit) || 8, 1), 20);
    const terms = query.split(/\s+/).filter(Boolean);
    const groups = TOOL_GROUPS.map((gr) =>
      gr.title === "Orquestração"
        ? { title: TOOLS.has("cv_task") ? "Orquestração paralela monitorada" : "Todos (subagentes desativados)", names: ["cv_task", "cv_task_wait", "cv_task_status", "cv_task_send", "cv_task_recv", "cv_task_peek", "cv_task_tail", "cv_task_notifications", "cv_task_delete", "cv_list_models", "cv_todowrite", "cv_todo"].filter((n) => TOOLS.has(n)) }
        : gr
    );
    const groupOf = (n) => groupOfCore(n, groups);
    const firstSentence = firstSentenceCore;
    const scored = [];
    for (const t of visibleTools()) {
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
    if (hits.length === 0) return out(`cv_find_tools: 0 resultados para "${args.query}". Tente outra keyword ou cv_tools_info.`);
    const lines = hits.map(({ tool: t }) => args.detail
      ? `${t.name} [${groupOf(t.name)}] — ${t.description}\ninputSchema: ${JSON.stringify(t.inputSchema)}`
      : `${t.name} [${groupOf(t.name)}] — ${firstSentence(t.description)}`);
    return out(`${hits.length} resultado(s) para "${args.query}":\n${lines.join("\n")}`);
  },
});

// Reduz o catálogo público; os executores antigos continuam disponíveis como aliases de compatibilidade.
installToolConsolidation();

// Static catalogue mode for docs/scripts: boot registrations, print public tools, then exit.
if (process.argv.includes("--catalog")) {
  process.stdout.write(JSON.stringify(buildToolsList(TOOLS, { sorted: true, annotations: false })) + "\n");
  process.exit(0);
}

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
  startAutoUpdate(); // internet é a única dependência: fetch origin/main → fast-forward → restart
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
    if (proxyMode) {
      process.stderr.write(`[canivete] daemon já ativo na :${MCP_HTTP_PORT} (${_j.tools} tools) — stdio em modo proxy (multi-CLI: nenhuma porta re-bindada)\n`);
      // Catálogo mudou no daemon? Avisa o cliente (codex/claude) para reler tools/list.
      // O daemon também manda a notificação na próxima resposta; aqui é o cinto.
      let lastHash = _j.toolsHash || null;
      const watch = setInterval(async () => {
        try {
          const c = new AbortController();
          const t = setTimeout(() => c.abort(), 3000);
          const h = await fetch(`http://127.0.0.1:${MCP_HTTP_PORT}/health`, { signal: c.signal });
          clearTimeout(t);
          const j = await h.json();
          if (j.toolsHash && lastHash && j.toolsHash !== lastHash) {
            lastHash = j.toolsHash;
            sendToHost({ jsonrpc: "2.0", method: "notifications/tools/list_changed", params: {} });
          } else if (j.toolsHash) lastHash = j.toolsHash;
        } catch {}
      }, 5000);
      watch.unref();
    }
  } catch {}
}
async function proxyMcp(msg) {
  const { getToken } = await import("./remote.mjs");
  const isArray = Array.isArray(msg);
  const ids = (isArray ? msg : [msg]).map((m) => (m && typeof m === "object" && "id" in m ? m.id : undefined));
  const temId = ids.some((i) => i !== undefined);
  try {
    const r = await fetch(`http://127.0.0.1:${MCP_HTTP_PORT}/mcp`, { method: "POST", headers: { "content-type": "application/json", "x-token": getToken(), "x-canivete-agent-session": MCP_AGENT_SESSION_ID }, body: JSON.stringify(msg) });
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
  const resp = await dispatchStdio(msg, TOOLS, sendToHost, MCP_AGENT_SESSION_ID);
  if (resp) sendToHost(resp);
});
