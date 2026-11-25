// Public task-oriented groups. Legacy executors are hidden from tools/list.
export const TOOL_GROUPS = [
  { title: "Arquivos e comandos", hint: "Ler, encontrar e alterar arquivos; cv_bash para comandos", names: ["cv_file_read", "cv_file_write", "cv_bash"] },
  { title: "Web e consultas", hint: "Buscar páginas, ler URLs e consultar dados públicos", names: ["cv_websearch", "cv_webfetch", "cv_lookup"] },
  { title: "Browser headless", hint: "Ler, localizar controles, agir e capturar páginas públicas", names: ["cv_browser_read", "cv_browser_snapshot", "cv_browser_act", "cv_browser_capture", "cv_browser_screencast"] },
  { title: "Chrome logado do dono", hint: "Inspecionar a sessão; agir e ler alertas ficam separados", names: ["cv_owner_inspect", "cv_owner_act", "cv_owner_alerts"] },
  { title: "Android", hint: "Inspecionar, conectar e agir no aparelho", names: ["cv_android_inspect", "cv_android_connect", "cv_android_act"] },
  { title: "Codespaces", hint: "Consultar, controlar ciclo de vida, autenticar e executar comandos", names: ["cv_codespace_status", "cv_codespace_lifecycle", "cv_codespace_login", "cv_codespace_exec"] },
  { title: "Desenvolvimento", hint: "Entender o código, editar, verificar e controlar processos", names: ["cv_code_inspect", "cv_code_edit", "cv_code_verify", "cv_manage_background_process", "cv_orchestrate_task"] },
  { title: "Orquestração", hint: "Lista de tarefas e subagentes, quando habilitados", names: ["cv_todo", "cv_todowrite", "cv_task_start", "cv_task_progress", "cv_task_mailbox", "cv_task_delete"], dynamicTitle: true },
  { title: "Meta", hint: "Ajuda, contexto, skills e feedback", names: ["cv_help", "cv_ctx_status", "cv_skill", "cv_report"] },
  { title: "Reports de elemento", hint: "Listar e resolver marcações feitas na página", names: ["cv_elemreports_list", "cv_elemreports_resolve"] },
  { title: "Mídia local", hint: "Análise de áudio local via ffprobe/ffmpeg", names: ["cv_audio_analyze"] },
];

export function orchestrationTitle(has, hasTask) {
  if (!has) return "Todos (subagentes desativados)";
  return hasTask ? "Orquestração paralela monitorada" : "Todos (subagentes desativados)";
}

export function groupOf(name, groups = TOOL_GROUPS) {
  return groups.find((gr) => gr.names.includes(name))?.title ?? "Outras";
}

export function firstSentence(d = "") {
  const c = String(d ?? "").replace(/\s+/g, " ").trim();
  return (c.match(/^(.*?[.!?])(?=\s|$)/)?.[1] ?? c).trim();
}
