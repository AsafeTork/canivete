// Public MCP surface: a small set of task-shaped tools over the existing executors.
// Legacy definitions stay callable for compatibility but are hidden from tools/list.
import { TOOLS, reg, out } from "../lib/ctx.mjs";

const clone = (value) => JSON.parse(JSON.stringify(value ?? {}));
const LEGACY_TO_PUBLIC = Object.create(null);

function remapResult(value) {
  if (typeof value === "string") {
    return value.replace(/\bcv_[a-z0-9_]+\b/g, (name) => LEGACY_TO_PUBLIC[name] || name);
  }
  if (Array.isArray(value)) return value.map(remapResult);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "tool" && typeof item === "string") out[key] = LEGACY_TO_PUBLIC[item] || item;
    else out[key] = remapResult(item);
  }
  return out;
}

function setPublic(name, value) {
  const t = TOOLS.get(name);
  if (t) t.public = value;
}

function variantsFor(actionField, variants) {
  return {
    oneOf: variants.map(({ action, source, rename = {}, omit = [] }) => {
      const tool = TOOLS.get(source);
      if (!tool) return null;
      const schema = clone(tool.inputSchema);
      const properties = { ...(schema.properties || {}) };
      for (const key of omit) delete properties[key];
      for (const [from, to] of Object.entries(rename)) {
        if (Object.hasOwn(properties, from)) {
          properties[to] = properties[from];
          delete properties[from];
        }
      }
      properties[actionField] = { type: "string", const: action, description: `${actionField}=${action}` };
      const required = (schema.required || []).map((key) => rename[key] || key).filter((key) => !omit.includes(key));
      required.push(actionField);
      return { type: "object", properties, required, additionalProperties: false };
    }).filter(Boolean),
  };
}

function addComposite({ name, description, actionField = "action", variants, mapArgs = {}, onRun }) {
  const available = variants.filter((v) => TOOLS.has(v.source));
  if (!available.length) return;
  const runners = new Map(available.map((v) => [v.source, TOOLS.get(v.source)?._run]));
  for (const v of available) {
    setPublic(v.source, false);
    LEGACY_TO_PUBLIC[v.source] = name;
  }
  const schema = variantsFor(actionField, available);
  reg(name, {
    description,
    inputSchema: schema,
    run: async (args = {}) => {
      const action = String(args[actionField] || "");
      const variant = available.find((v) => v.action === action);
      if (!variant) return out(`ação inválida em ${name}: ${action || "(vazia)"}. Escolha: ${available.map((v) => v.action).join(" | ")}.`, true);
      const branch = schema.oneOf.find((v) => v.properties?.[actionField]?.const === action);
      const missing = (branch?.required || []).filter((key) => key !== actionField && args[key] === undefined);
      if (missing.length) return out(`${name} action=${action}: faltam ${missing.join(", ")}.`, true);
      if (!TOOLS.has(variant.source)) return out(`${name}: action=${action} está desligada nas preferências do Canivete.`, true);
      const runner = runners.get(variant.source);
      if (!runner) return out(`${name}: executor indisponível para action=${action}.`, true);
      const callArgs = { ...args };
      delete callArgs[actionField];
      for (const [from, to] of Object.entries(variant.rename || {})) {
        if (Object.hasOwn(callArgs, to)) { callArgs[from] = callArgs[to]; delete callArgs[to]; }
      }
      for (const key of variant.omit || []) delete callArgs[key];
      const mapped = mapArgs[variant.source];
      const result = onRun
        ? await onRun({ variant, args: callArgs, runner })
        : await runner(mapped ? mapped(callArgs) : callArgs);
      return remapResult(result);
    },
  });
}

function addAlias({ name, source, description, inputSchema }) {
  const original = TOOLS.get(source);
  if (!original) return;
  setPublic(source, false);
  LEGACY_TO_PUBLIC[source] = name;
  reg(name, {
    description: description || original.description,
    inputSchema: inputSchema || original.inputSchema,
    run: async (args) => TOOLS.has(source)
      ? remapResult(await original._run(args || {}))
      : out(`${name} está desligada nas preferências do Canivete.`, true),
  });
}

function markHidden(names, publicName) {
  for (const name of names) {
    if (!TOOLS.has(name)) continue;
    setPublic(name, false);
    LEGACY_TO_PUBLIC[name] = publicName;
  }
}

export function installToolConsolidation() {
  addComposite({
    name: "cv_file_read",
    description: "Lê um arquivo, lista uma árvore ou encontra arquivos/trechos. Escolha action; para alterar conteúdo use cv_file_write; para comandos use cv_bash.",
    variants: [
      { action: "read", source: "cv_read", rename: { filePath: "path" } },
      { action: "tree", source: "cv_list" },
      { action: "search_files", source: "cv_glob" },
      { action: "search_text", source: "cv_grep" },
    ],
  });
  addComposite({
    name: "cv_file_write",
    description: "Cria ou troca o conteúdo de um arquivo. Escolha action=write para criar/sobrescrever ou action=replace para uma troca textual. Para patch de código use cv_code_edit.",
    variants: [
      { action: "write", source: "cv_write", rename: { filePath: "path" } },
      { action: "replace", source: "cv_edit", rename: { filePath: "path" } },
    ],
  });

  addComposite({
    name: "cv_lookup",
    description: "Consulta uma fonte pública. Escolha source; os campos necessários mudam conforme a fonte (câmbio, CEP, CNPJ, IP, clima, GitHub ou npm).",
    actionField: "source",
    variants: [
      { action: "currency", source: "cv_currency" },
      { action: "cep", source: "cv_cep" },
      { action: "cnpj", source: "cv_cnpj" },
      { action: "ipinfo", source: "cv_ipinfo" },
      { action: "weather", source: "cv_weather" },
      { action: "github", source: "cv_github" },
      { action: "npm", source: "cv_npm" },
    ],
  });

  addComposite({
    name: "cv_browser_read",
    description: "Abre uma página no Chrome headless e lê seu conteúdo. detail=summary retorna texto e links; detail=full extrai tabelas, formulários, listas e metadados. Use snapshot para achar controles e cv_browser_act para agir.",
    actionField: "detail",
    variants: [
      { action: "summary", source: "cv_browser_navigate", omit: ["extract"] },
      { action: "full", source: "cv_browser_extract" },
    ],
  });
  addComposite({
    name: "cv_browser_capture",
    description: "Captura a página headless como imagem/PDF ou mede contraste. Escolha action; screencast com sequência de ações continua em cv_browser_screencast.",
    actionField: "action",
    variants: [
      { action: "screenshot", source: "cv_browser_screenshot" },
      { action: "pdf", source: "cv_browser_pdf" },
      { action: "contrast", source: "cv_browser_contrast" },
    ],
  });

  addComposite({
    name: "cv_owner_inspect",
    description: "Entenda a página autenticada em uma chamada: overview compacto, leitura, controles, guias ou imagem. Para agir/chat use cv_owner_act; alertas ficam em cv_owner_alerts.",
    variants: [
      { action: "status", source: "cv_ubrowser_status" },
      { action: "tabs", source: "cv_ubrowser_tabs" },
      { action: "read", source: "cv_ubrowser_read" },
      { action: "snapshot", source: "cv_ubrowser_snapshot" },
      { action: "overview", source: "cv_ubrowser_overview" },
      { action: "screenshot", source: "cv_ubrowser_shot" },
    ],
  });
  addAlias({ name: "cv_owner_act", source: "cv_ubrowser_act", description: "Opera qualquer guia do Chrome autenticado; goto troca o site na mesma guia. Guias novas entram no grupo Canivete. Companion oferece chat, passo a passo e marcações na página; flow mostra progresso. CDP está disponível quando necessário." });
  addAlias({ name: "cv_owner_alerts", source: "cv_ubrowser_alerts", description: "Lê e consome alertas pendentes da sessão Chrome do dono." });

  addComposite({
    name: "cv_android_inspect",
    description: "Consulta o Android conectado: estado, hierarquia da tela ou captura. Escolha action. Para parear use cv_android_connect; para tocar ou digitar use cv_android_act.",
    variants: [
      { action: "status", source: "cv_adb_status" },
      { action: "extract", source: "cv_adb_extract" },
      { action: "screen", source: "cv_adb_screen" },
    ],
  });
  addAlias({ name: "cv_android_connect", source: "cv_adb_connect", description: "Pareia/conecta ADB e salva o perfil Wi-Fi do Android." });
  addAlias({ name: "cv_android_act", source: "cv_adb_act", description: "Age no Android conectado: toque, texto, teclas e operações de app. Uninstall/clear exigem confirmação." });

  addComposite({
    name: "cv_codespace_status",
    description: "Consulta contas e Codespaces ou confere o resultado de um login. Escolha action=list ou action=login_status.",
    variants: [
      { action: "list", source: "cv_codespace_list" },
      { action: "login_status", source: "cv_codespace_login_status" },
    ],
  });
  addComposite({
    name: "cv_codespace_lifecycle",
    description: "Cria, para ou apaga um Codespace. Escolha action; delete exige confirmação. Para comandos use cv_codespace_exec.",
    variants: [
      { action: "create", source: "cv_codespace_create" },
      { action: "stop", source: "cv_codespace_stop" },
      { action: "delete", source: "cv_codespace_delete" },
    ],
  });

  addComposite({
    name: "cv_code_inspect",
    description: "Entende o código do projeto: arquitetura, causa provável ou impacto de uma mudança. Escolha action.",
    variants: [
      { action: "architecture", source: "cv_get_architecture_summary" },
      { action: "issue", source: "cv_investigate_issue" },
      { action: "impact", source: "cv_analyze_change_impact" },
    ],
  });
  addComposite({
    name: "cv_code_edit",
    description: "Altera código. Escolha action=diff para unified diff ou action=semantic para patch AST validado.",
    variants: [
      { action: "diff", source: "cv_apply_patch" },
      { action: "semantic", source: "cv_apply_semantic_patch" },
    ],
  });
  addComposite({
    name: "cv_code_verify",
    description: "Verifica o projeto ou uma UI. Escolha action=tests para executar testes direcionados ou action=ui para inspecionar estado HTTP.",
    variants: [
      { action: "tests", source: "cv_execute_targeted_tests" },
      { action: "ui", source: "cv_inspect_ui_state" },
    ],
  });

  // The two discovery tools cover the same live catalogue: query searches, no query lists.
  for (const name of ["cv_tools_info", "cv_find_tools"]) markHidden([name], "cv_help");
  reg("cv_help", {
    description: "Ajuda do Canivete. Sem query lista capacidades por categoria; com query encontra a tool certa. detail=true mostra parâmetros e schema.",
    inputSchema: { type: "object", properties: {
      query: { type: "string", description: "Palavras do que você quer fazer; opcional para listar categorias." },
      limit: { type: "integer", minimum: 1, maximum: 20, default: 8 },
      detail: { type: "boolean", default: false },
    }, required: [] },
    run: async ({ query, limit, detail } = {}) => {
      const source = TOOLS.get(query ? "cv_find_tools" : "cv_tools_info");
      return remapResult(await source._run(query ? { query, limit, detail } : { detail }));
    },
  });

  for (const name of ["cv_question", "cv_plan"]) setPublic(name, false);

  // Optional parallel task tools are also consolidated, without changing their executor.
  addAlias({ name: "cv_task_start", source: "cv_task", description: "Inicia uma tarefa de subagente. Use cv_task_progress para acompanhar, cv_task_mailbox para mensagens e cv_task_delete para remover." });
  addComposite({
    name: "cv_task_progress",
    description: "Acompanha subagentes: modelos, status, espera, geração parcial e notificações. Escolha action.",
    variants: [
      { action: "models", source: "cv_list_models" },
      { action: "status", source: "cv_task_status" },
      { action: "wait", source: "cv_task_wait" },
      { action: "tail", source: "cv_task_tail" },
      { action: "notifications", source: "cv_task_notifications" },
    ],
  });
  addComposite({
    name: "cv_task_mailbox",
    description: "Troca mensagens com subagentes: envia, lê e espreita a mailbox. Escolha action; recv esvazia a caixa.",
    variants: [
      { action: "send", source: "cv_task_send" },
      { action: "recv", source: "cv_task_recv" },
      { action: "peek", source: "cv_task_peek" },
    ],
  });
  if (TOOLS.has("cv_task_delete")) {
    const d = TOOLS.get("cv_task_delete");
    d.public = true;
  }
}

export { LEGACY_TO_PUBLIC };
