// canivete — tools do navegador LOGADO do dono (ubrowser_*)
import { reg, devOut, trimOut } from "./ctx.mjs";
import { ubEnsure, ubSend, ubConnected, UB_OFF, ubRisk, UB_PORT, ubStats } from "./ubridge.mjs";

reg("n_ubrowser_status", {
  description: "Status da ponte com o Chrome LOGADO do dono (extensão local). Quando usar: antes de qualquer ação no navegador do dono. Se offline: janela NORMAL, mesmo perfil, sem anônimo, popup ATIVO.",
  inputSchema: { type: "object", properties: {}, required: [] },
  run: async () => {
    ubEnsure();
    const c = ubConnected();
    return devOut({ status: c ? "success" : "error", summary: c ? "UBrowser pronto (extensão conectada)" : UB_OFF, data: { connected: c, ...ubStats() }, telemetry: { execution_time_ms: 0 } });
  },
});

reg("n_ubrowser_tabs", {
  description: "Abas do Chrome do dono (id, janela, anônima?, título, url). Diagnostica janela/perfil errado.",
  inputSchema: { type: "object", properties: {}, required: [] },
  run: async () => {
    const t0 = Date.now();
    const r = await ubSend("tabs.list", {});
    if (r.__offline || r.__timeout) return devOut({ status: "error", summary: r.__offline ? UB_OFF : "timeout 60s aguardando extensão", data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    if (!r.ok) return devOut({ status: "error", summary: `extensão: ${r.error}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    const tabs = r.data.tabs || r.data || [];
    const wins = r.data.windows || [];
    return devOut({ summary: `${tabs.length} aba(s) em ${wins.length || "?"} janela(s)`, data: { tabs, windows: wins }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "n_ubrowser_read", reason: "Ler aba ativa" }] });
  },
});

reg("n_ubrowser_read", {
  description: "Lê aba do dono COM login. Destilado markdown/desduplicado por padrão (mode=distill, ~4000 chars); mode=raw devolve texto integral + links (maxChars default 2500, maxLinks 15). {tabId?/tab?} = aba ativa.",
  inputSchema: { type: "object", properties: { tabId: { type: "number" }, tab: { type: "string", description: "trecho do título/URL (resolve p/ tabId; IDs mudam)" }, maxChars: { type: "number", default: 2500 }, maxLinks: { type: "number", default: 15 }, mode: { type: "string", enum: ["distill", "raw"], default: "distill", description: "distill=destilado enxuto (default); raw=texto integral opt-out" } }, required: [] },
  run: async ({ tabId, mode, maxChars, maxLinks }) => {
    const t0 = Date.now();
    const r = await ubSend("tab.read", { tabId, mode: mode || "distill", maxChars, maxLinks });
    if (r.__offline || r.__timeout) return devOut({ status: "error", summary: r.__offline ? UB_OFF : "timeout 60s", data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    if (!r.ok) return devOut({ status: "error", summary: `extensão: ${r.error}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    const body = r.data.markdown || r.data.text || "";
    return devOut({ summary: `${r.data.title} — ${r.data.url}${r.data.markdown ? ` (destilado ${r.data.stats ? r.data.stats.chars + " chars" : ""})` : ""}`, data: { ...r.data, text: trimOut(body, 6000) }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "n_ubrowser_snapshot", reason: "Mapear cliques" }] });
  },
});

reg("n_ubrowser_snapshot", {
  description: "Elementos clicáveis da aba do dono (ref/tag/texto/selector + x/y). Padrão 50 (cap 120); offset p/ paginar até o fim.",
  inputSchema: { type: "object", properties: { tabId: { type: "number" }, tab: { type: "string", description: "trecho do título/URL (resolve p/ tabId; IDs mudam)" }, max: { type: "number", default: 50 }, offset: { type: "number", default: 0, description: "pula N primeiros (paginação)" } }, required: [] },
  run: async ({ tabId, tab, max, offset }) => {
    const t0 = Date.now();
    const r = await ubSend("tab.snapshot", { tabId, tab, max, offset });
    if (r.__offline || r.__timeout) return devOut({ status: "error", summary: r.__offline ? UB_OFF : "timeout 60s", data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    if (!r.ok) return devOut({ status: "error", summary: `extensão: ${r.error}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    return devOut({ summary: `${(r.data || []).length} elemento(s)`, data: { elements: r.data || [] }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "n_ubrowser_act", reason: "Agir com selector" }] });
  },
});

reg("n_ubrowser_act", {
  description: "AUTOMAÇÃO no Chrome LOGADO do dono (autorização total quando ele pedir; NUNCA destrutivo/idiota sem pedido explícito; alto risco exige confirm; FECHAR ABAS e ROUBAR FOCO são PROIBIDOS em hipótese alguma). goto/back/forward/reload/click/fill/type/select/press/scroll/highlight/waittext/wait/evaluate/cursor/new/scan (scan p/ listas virtualizadas: rola e coleta antes do snapshot). Funciona em aba DE FUNDO (tabId) sem estar olhando. Cursor INDEPENDENTE (overlay roxo). Ex: {action:\"new\", url:\"https://...\"} {action:\"cursor\", x:300, y:200, click:true}.",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["goto", "back", "forward", "reload", "click", "fill", "type", "select", "press", "scroll", "highlight", "waittext", "wait", "evaluate", "cursor", "new", "scan"] },
      tabId: { type: "number" }, tab: { type: "string", description: "trecho do título/URL (resolve p/ tabId; IDs mudam)" }, url: { type: "string" }, selector: { type: "string" }, text: { type: "string" },
      value: { type: "string", description: "valor p/ select (match por texto ou value da option)" },
      timeoutMs: { type: "number", description: "teto p/ waittext (default 8000, máx 20000)" },
      key: { type: "string" }, js: { type: "string" }, ms: { type: "number" },
      x: { type: "number", description: "viewport X p/ cursor" }, y: { type: "number", description: "viewport Y p/ cursor" },
      click: { type: "boolean", description: "cursor clica ao chegar" },
      direction: { type: "string", enum: ["up", "down", "top", "bottom"] },
      submit: { type: "boolean" }, waitMs: { type: "number" },
      pages: { type: "number", default: 4, description: "páginas de rolagem p/ scan (listas virtualizadas)" }, container: { type: "string", description: "selector do container virtualizado (opcional)" },
      confirm: { type: "string", description: "Frase do dono p/ alto risco" },
    },
    required: ["action"],
  },
  run: async (a) => {
    const t0 = Date.now();
    const risk = ubRisk(a);
    if (risk === "high" && !(a.confirm && a.confirm.trim().length >= 4))
      return devOut({ status: "error", summary: `BLOQUEADO (alto risco: pagamento/senha/excluir/apagar). Só com pedido EXPLÍCITO + confirm="<frase do dono>". Ação: ${a.action} ${a.selector || a.url || ""}`, data: { action: a.action, risk }, telemetry: { execution_time_ms: Date.now() - t0 } });
    if (a.action === "wait") { await new Promise((r) => setTimeout(r, Math.min(Number(a.ms) || 2000, 15000))); return devOut({ summary: "wait ok", data: { action: "wait" }, telemetry: { execution_time_ms: Date.now() - t0 } }); }
    const map = { goto: "tab.goto", back: "tab.back", forward: "tab.forward", reload: "tab.reload", click: "tab.click", fill: "tab.fill", type: "tab.type", select: "tab.select", press: "tab.press", scroll: "tab.scroll", highlight: "tab.highlight", waittext: "tab.waittext", evaluate: "tab.evaluate", cursor: "tab.cursor", new: "tab.new", scan: "tab.scan" };
    const r = await ubSend(map[a.action], { ...a });
    if (r.__offline || r.__timeout) return devOut({ status: "error", summary: r.__offline ? UB_OFF : "timeout 60s", data: { action: a.action }, telemetry: { execution_time_ms: Date.now() - t0 } });
    if (!r.ok) return devOut({ status: "error", summary: `extensão: ${r.error}`, data: { action: a.action }, telemetry: { execution_time_ms: Date.now() - t0 } });
    const d = r.data || {};
    return devOut({ summary: `[${a.action} risk=${risk}] ok${d.title ? " — " + d.title : ""}`, data: { action: a.action, risk, ...d, text: d.text ? trimOut(d.text, 3000) : d.value ?? "" }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "n_ubrowser_shot", reason: "Confirmar visualmente" }] });
  },
});

reg("n_ubrowser_shot", {
  description: "Print da aba VISÍVEL do dono (imagem + arquivo). Fundo = sem print (use read). Nunca troca de aba.",
  inputSchema: { type: "object", properties: { tabId: { type: "number" }, tab: { type: "string", description: "trecho do título/URL (resolve p/ tabId; IDs mudam)" } }, required: [] },
  run: async ({ tabId, tab }) => {
    const t0 = Date.now();
    const r = await ubSend("tab.shot", { tabId, tab });
    if (r.__offline || r.__timeout) return devOut({ status: "error", summary: r.__offline ? UB_OFF : "timeout 60s", data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    if (!r.ok) return devOut({ status: "error", summary: `extensão: ${r.error}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    const b64 = String(r.data.dataUrl || "").split(",")[1] || "";
    if (!b64) return devOut({ status: "error", summary: "screenshot vazio", data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    return { content: [{ type: "text", text: `Screenshot ${r.data.tab?.title || ""} — ${r.data.tab?.url || ""}` }, { type: "image", data: b64.length > 1500000 ? b64.slice(0, 1500000) : b64, mimeType: "image/png" }] };
  },
});

