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
    const g = (names) => names.map((n) => { const t = TOOLS.get(n); return t ? `${t.name} — ${t.description}` : n; }).join("\n");
    return out([
      `== CANIVETE (src/server.mjs, 1.0.0, ${TOOLS.size} tools — MCP universal, qualquer CLI) ==`,
      "Runner atual: CANIVETE_RUNNER=opencode (ou genérico via CANIVETE_RUN_TEMPLATE).",
      "",
      "-- Filesystem + execução (8): ler/listar/criar/editar/patch/shell/glob/grep --",
      g(["n_read", "n_list", "n_write", "n_edit", "n_apply_patch", "n_bash", "n_glob", "n_grep"]),
      "",
      "-- Web + APIs públicas sem chave (9): fetch enxuto, search 7 backends, currency/cep/cnpj/ip/weather/github/npm --",
      g(["n_webfetch", "n_websearch", "n_currency", "n_cep", "n_cnpj", "n_ipinfo", "n_weather", "n_github", "n_npm"]),
      "",
      "-- Browser headless (5, CDP zero-deps): navegar com JS, snapshot, agir, screenshot, pdf --",
      g(["n_browser_navigate", "n_browser_snapshot", "n_browser_act", "n_browser_screenshot", "n_browser_pdf"]),
      "",
      "-- Navegador LOGADO do dono (6, via extensão local): status, abas, ler, snapshot, agir, print --",
      g(["n_ubrowser_status", "n_ubrowser_tabs", "n_ubrowser_read", "n_ubrowser_snapshot", "n_ubrowser_act", "n_ubrowser_shot"]),
      "",
      "-- Orquestração paralela monitorada (8): spawn sync/async, wait any/all, status com modelo+mailbox, send/recv não-bloqueante, delete, models, todos --",
      g(["n_task", "n_task_wait", "n_task_status", "n_task_send", "n_task_recv", "n_task_notifications", "n_task_delete", "n_list_models", "n_todowrite"]),
      "  (também: n_todo)",
      "",
      "-- DevEngine AI-Native (8): arquitetura sem varrer, investigar causa (12→1), impacto, patch AST, testes afetados, bg proc, UI state, DAG --",
      g(["n_get_architecture_summary", "n_investigate_issue", "n_analyze_change_impact", "n_apply_semantic_patch", "n_execute_targeted_tests", "n_manage_background_process", "n_inspect_ui_state", "n_orchestrate_task"]),
      "",
      "-- Meta (6): catálogo, pergunta humana, skill, plan, report, contexto --",
      g(["n_tools_info", "n_question", "n_skill", "n_plan", "n_report", "n_ctx_status"]),
      "",
      "-- WhatsApp dedicado (1): state|chats|open|read|send no Chrome logado --",
      g(["n_whatsapp"]),
    ].join("\n"));
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
        tools: [...TOOLS.values()].map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
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
