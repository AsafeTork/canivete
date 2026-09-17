#!/usr/bin/env node
// canivete — MCP universal (qualquer CLI via stdio): fs+exec, web, apis, tasks, devengine, browsers.
// Modo remoto (sem restart do host p/ trocar código): node src/server.mjs --http 19423
import { createInterface } from "node:readline";
import { join } from "node:path";
import { TOOLS, reg, out, sendToHost, CTX, CTX_BUDGET } from "./lib/ctx.mjs";
import { sweepTask, safeTaskIds, readJson, TASKS_DIR } from "./lib/tasks.mjs";
import { ubEnsure } from "./lib/ubridge.mjs";
import "./lib/fs.mjs";
import "./lib/web.mjs";
import "./lib/apis.mjs";
import "./lib/tasks.mjs";
import "./lib/devengine.mjs";
import "./lib/tools-browser.mjs";
import "./lib/tools-owner.mjs";
import "./lib/tools-whatsapp.mjs";
import "./lib/feedback.mjs";

reg("n_tools_info", {
  description: "Catálogo agrupado do canivete: filesystem+exec, web/APIs sem chave, orquestração, DevEngine, browsers e meta. Use para descobrir o que o MCP faz e qual tool chamar.",
  inputSchema: { type: "object", properties: {}, required: [] },
  run: () => {
    const first = (d = "") => (String(d).match(/^[^.!?]+[.!?]?/)?.[0] ?? String(d)).trim();
    const g = (names) => names.map((n) => { const t = TOOLS.get(n); return t ? `${t.name} — ${first(t.description)}` : n; }).join("\n");
    const groups = [
      { title: "Filesystem + execução", hint: "ler/listar/criar/editar/patch/shell/glob/grep", names: ["n_read", "n_list", "n_write", "n_edit", "n_apply_patch", "n_bash", "n_glob", "n_grep"] },
      { title: "Web + APIs públicas sem chave", hint: "fetch enxuto, search 7 backends, currency/cep/cnpj/ip/weather/github/npm", names: ["n_webfetch", "n_websearch", "n_currency", "n_cep", "n_cnpj", "n_ipinfo", "n_weather", "n_github", "n_npm"] },
      { title: "Browser headless", hint: "CDP zero-deps: navegar com JS, snapshot, agir, screenshot, pdf", names: ["n_browser_navigate", "n_browser_snapshot", "n_browser_act", "n_browser_screenshot", "n_browser_pdf"] },
      { title: "Navegador LOGADO do dono", hint: "via extensão local: status, abas, ler, snapshot, agir, print", names: ["n_ubrowser_status", "n_ubrowser_tabs", "n_ubrowser_read", "n_ubrowser_snapshot", "n_ubrowser_act", "n_ubrowser_shot"] },
      { title: "Orquestração paralela monitorada", hint: "spawn sync/async, wait any/all, status com modelo+mailbox, send/recv/peek/tail não-bloqueante, delete, models, todos", names: ["n_task", "n_task_wait", "n_task_status", "n_task_send", "n_task_recv", "n_task_peek", "n_task_tail", "n_task_notifications", "n_task_delete", "n_list_models", "n_todowrite", "n_todo"] },
      { title: "DevEngine AI-Native", hint: "arquitetura sem varrer, investigar causa (12→1), impacto, patch AST, testes afetados, bg proc, UI state, DAG", names: ["n_get_architecture_summary", "n_investigate_issue", "n_analyze_change_impact", "n_apply_semantic_patch", "n_execute_targeted_tests", "n_manage_background_process", "n_inspect_ui_state", "n_orchestrate_task"] },
      { title: "Meta", hint: "catálogo, pergunta humana, skill, plan, report, contexto", names: ["n_tools_info", "n_question", "n_skill", "n_plan", "n_report", "n_ctx_status"] },
      { title: "WhatsApp dedicado", hint: "state|chats|open|read|send no Chrome logado", names: ["n_whatsapp"] },
    ];
    const listed = new Set(groups.flatMap((gr) => gr.names));
    const extras = [...TOOLS.keys()].filter((n) => !listed.has(n));
    const lines = [
      `== CANIVETE (src/server.mjs, 1.0.0, ${TOOLS.size} tools — MCP universal, qualquer CLI) ==`,
      "Runner atual: CANIVETE_RUNNER=opencode (ou genérico via CANIVETE_RUN_TEMPLATE).",
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
    const groups = [
      { title: "Filesystem + execução", names: ["n_read", "n_list", "n_write", "n_edit", "n_apply_patch", "n_bash", "n_glob", "n_grep"] },
      { title: "Web + APIs públicas sem chave", names: ["n_webfetch", "n_websearch", "n_currency", "n_cep", "n_cnpj", "n_ipinfo", "n_weather", "n_github", "n_npm"] },
      { title: "Browser headless", names: ["n_browser_navigate", "n_browser_snapshot", "n_browser_act", "n_browser_screenshot", "n_browser_pdf"] },
      { title: "Navegador LOGADO do dono", names: ["n_ubrowser_status", "n_ubrowser_tabs", "n_ubrowser_read", "n_ubrowser_snapshot", "n_ubrowser_act", "n_ubrowser_shot"] },
      { title: "Orquestração paralela monitorada", names: ["n_task", "n_task_wait", "n_task_status", "n_task_send", "n_task_recv", "n_task_peek", "n_task_tail", "n_task_notifications", "n_task_delete", "n_list_models", "n_todowrite", "n_todo"] },
      { title: "DevEngine AI-Native", names: ["n_get_architecture_summary", "n_investigate_issue", "n_analyze_change_impact", "n_apply_semantic_patch", "n_execute_targeted_tests", "n_manage_background_process", "n_inspect_ui_state", "n_orchestrate_task"] },
      { title: "Meta", names: ["n_tools_info", "n_find_tools", "n_question", "n_skill", "n_plan", "n_report", "n_ctx_status"] },
      { title: "WhatsApp dedicado", names: ["n_whatsapp"] },
    ];
    const groupOf = (n) => groups.find((gr) => gr.names.includes(n))?.title ?? "Outras";
    const firstSentence = (d = "") => (String(d).match(/^[^.!?]+[.!?]?/)?.[0] ?? String(d)).trim();
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

// Annotations de risco p/ tools/list — padrão MCP Mar/2025 (readOnlyHint/destructiveHint/idempotentHint).
// Heurística por nome (determinística, sem I/O): read/list/glob/grep/search/fetch/status/tabs/snapshot → readOnly;
// write/edit/patch/bash/delete/send/act/fill/type → destructive; resto → idempotent.
// Nota: se o host/protocolo não aceitar campo extra `annotations`, trocar por `_annotations` (mesmo objeto) —
// campo com prefixo `_` é ignorado por hosts estritos sem quebrar o loop stdio. Ordem alfabética p/ prompt-cache.
const READ_ONLY_RE = /read|list|glob|grep|search|fetch|status|tabs|snapshot/i;
const DESTRUCTIVE_RE = /write|edit|patch|bash|delete|send|fill|type/i;
const DESTRUCTIVE_ACT_RE = /(^|_)act(_|$)/i; // evita falso-positivo em *impact (ex: n_analyze_change_impact)
const annotationsFor = (name = "") => {
  if (DESTRUCTIVE_RE.test(name) || DESTRUCTIVE_ACT_RE.test(name))
    return { readOnlyHint: false, destructiveHint: true, idempotentHint: false };
  if (READ_ONLY_RE.test(name)) return { readOnlyHint: true, destructiveHint: false, idempotentHint: true };
  return { readOnlyHint: false, destructiveHint: false, idempotentHint: true };
};

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
  if (msg.method?.startsWith("notifications/")) return;
  if (msg.id === undefined || msg.id === null) return;
  if (msg.method === "initialize") {
    sendToHost({
      id: msg.id,
      result: {
        protocolVersion: msg.params?.protocolVersion || "2024-11-05",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "canivete", version: "1.0.0" },
      },
    });
    return;
  }
  if (msg.method === "ping") {
    sendToHost({ id: msg.id, result: {} });
    return;
  }
  if (msg.method === "tools/list") {
    sendToHost({
      id: msg.id,
      result: {
        tools: [...TOOLS.values()]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
            annotations: annotationsFor(t.name),
          })),
      },
    });
    return;
  }
  if (msg.method === "tools/call") {
    const { name, arguments: args } = msg.params || {};
    const tool = TOOLS.get(name);
    if (!tool) {
      sendToHost({ id: msg.id, result: { content: [{ type: "text", text: `unknown tool: ${name}` }], isError: true } });
      return;
    }
    try {
      const result = await tool.run(args || {});
      sendToHost({ id: msg.id, result });
    } catch (e) {
      sendToHost({ id: msg.id, result: { content: [{ type: "text", text: `tool error: ${e?.message || e}` }], isError: true } });
    }
    return;
  }

});
