// canivete core/taxonomy — UMA definição de grupos (zero deps).
// Antes: tabelas copiadas em server.mjs n_tools_info vs n_find_tools (drift).
// has() filtra tools não registradas (ex: família n_task* desligada).
export const TOOL_GROUPS = [
  { title: "Filesystem + execução", hint: "ler/listar/criar/editar/patch/shell/glob/grep", names: ["n_read", "n_list", "n_write", "n_edit", "n_apply_patch", "n_bash", "n_glob", "n_grep"] },
  { title: "Web + APIs públicas sem chave", hint: "fetch enxuto, search 7 backends, currency/cep/cnpj/ip/weather/github/npm", names: ["n_webfetch", "n_websearch", "n_currency", "n_cep", "n_cnpj", "n_ipinfo", "n_weather", "n_github", "n_npm"] },
  { title: "Browser headless", hint: "CDP zero-deps: navegar com JS, snapshot, agir, screenshot, pdf", names: ["n_browser_navigate", "n_browser_snapshot", "n_browser_act", "n_browser_screenshot", "n_browser_pdf"] },
  { title: "Navegador LOGADO do dono", hint: "via extensão local: status, abas, ler, snapshot, agir, print", names: ["n_ubrowser_status", "n_ubrowser_tabs", "n_ubrowser_read", "n_ubrowser_snapshot", "n_ubrowser_act", "n_ubrowser_shot"] },
  { title: "Orquestração", hint: "todos in-memory (+ família n_task* só com CANIVETE_TASK_ENABLE=1)", names: ["n_task", "n_task_wait", "n_task_status", "n_task_send", "n_task_recv", "n_task_peek", "n_task_tail", "n_task_notifications", "n_task_delete", "n_list_models", "n_todowrite", "n_todo"], dynamicTitle: true },
  { title: "DevEngine AI-Native", hint: "arquitetura sem varrer, investigar causa (12→1), impacto, patch AST, testes afetados, bg proc, UI state, DAG", names: ["n_get_architecture_summary", "n_investigate_issue", "n_analyze_change_impact", "n_apply_semantic_patch", "n_execute_targeted_tests", "n_manage_background_process", "n_inspect_ui_state", "n_orchestrate_task"] },
  { title: "Meta", hint: "catálogo, pergunta humana, skill, plan, report, contexto", names: ["n_tools_info", "n_question", "n_skill", "n_plan", "n_report", "n_ctx_status"] },
  { title: "WhatsApp dedicado", hint: "state|chats|open|read|send no Chrome logado", names: ["n_whatsapp"] },
];

export function orchestrationTitle(has, hasTask) {
  if (!has) return hasTask ? "Orquestração paralela monitorada" : "Todos (subagentes desativados)";
  return hasTask ? "Orquestração paralela monitorada" : "Todos (subagentes desativados)";
}

export function groupOf(name, groups = TOOL_GROUPS) {
  return groups.find((gr) => gr.names.includes(name))?.title ?? "Outras";
}

export function firstSentence(d = "") {
  const c = String(d ?? "").replace(/\s+/g, " ").trim();
  return (c.match(/^(.*?[.!?])(?=\s|$)/)?.[1] ?? c).trim();
}
