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
  description: "Lê aba do dono COM login (título+texto+links). Enxuto por padrão (2500 chars, 15 links). {tabId?} = aba ativa.",
  inputSchema: { type: "object", properties: { tabId: { type: "number" }, maxChars: { type: "number", default: 2500 }, maxLinks: { type: "number", default: 15 } }, required: [] },
  run: async ({ tabId }) => {
    const t0 = Date.now();
    const r = await ubSend("tab.read", { tabId });
    if (r.__offline || r.__timeout) return devOut({ status: "error", summary: r.__offline ? UB_OFF : "timeout 60s", data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    if (!r.ok) return devOut({ status: "error", summary: `extensão: ${r.error}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    return devOut({ summary: `${r.data.title} — ${r.data.url}`, data: { ...r.data, text: trimOut(r.data.text || "", 6000) }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "n_ubrowser_snapshot", reason: "Mapear cliques" }] });
  },
});

reg("n_ubrowser_snapshot", {
  description: "Elementos clicáveis da aba do dono (ref/tag/texto/selector + x/y). Padrão 50 (cap 120).",
  inputSchema: { type: "object", properties: { tabId: { type: "number" }, max: { type: "number", default: 50 } }, required: [] },
  run: async ({ tabId }) => {
    const t0 = Date.now();
    const r = await ubSend("tab.snapshot", { tabId });
    if (r.__offline || r.__timeout) return devOut({ status: "error", summary: r.__offline ? UB_OFF : "timeout 60s", data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    if (!r.ok) return devOut({ status: "error", summary: `extensão: ${r.error}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    return devOut({ summary: `${(r.data || []).length} elemento(s)`, data: { elements: r.data || [] }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "n_ubrowser_act", reason: "Agir com selector" }] });
  },
});

reg("n_ubrowser_act", {
  description: "AUTOMAÇÃO no Chrome LOGADO do dono (autorização total quando ele pedir; NUNCA destrutivo/idiota sem pedido explícito; alto risco exige confirm; FECHAR ABAS e ROUBAR FOCO são PROIBIDOS em hipótese alguma). goto/back/forward/reload/click/fill/press/scroll/wait/evaluate/cursor/new. Funciona em aba DE FUNDO (tabId) sem estar olhando. Cursor INDEPENDENTE (overlay roxo). Ex: {action:\"new\", url:\"https://...\"} {action:\"cursor\", x:300, y:200, click:true}.",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["goto", "back", "forward", "reload", "click", "fill", "press", "scroll", "wait", "evaluate", "cursor", "new"] },
      tabId: { type: "number" }, url: { type: "string" }, selector: { type: "string" }, text: { type: "string" },
      key: { type: "string" }, js: { type: "string" }, ms: { type: "number" },
      x: { type: "number", description: "viewport X p/ cursor" }, y: { type: "number", description: "viewport Y p/ cursor" },
      click: { type: "boolean", description: "cursor clica ao chegar" },
      direction: { type: "string", enum: ["up", "down", "top", "bottom"] },
      submit: { type: "boolean" }, waitMs: { type: "number" },
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
    const map = { goto: "tab.goto", back: "tab.back", forward: "tab.forward", reload: "tab.reload", click: "tab.click", fill: "tab.fill", press: "tab.press", scroll: "tab.scroll", evaluate: "tab.evaluate", cursor: "tab.cursor", new: "tab.new" };
    const r = await ubSend(map[a.action], { ...a });
    if (r.__offline || r.__timeout) return devOut({ status: "error", summary: r.__offline ? UB_OFF : "timeout 60s", data: { action: a.action }, telemetry: { execution_time_ms: Date.now() - t0 } });
    if (!r.ok) return devOut({ status: "error", summary: `extensão: ${r.error}`, data: { action: a.action }, telemetry: { execution_time_ms: Date.now() - t0 } });
    const d = r.data || {};
    return devOut({ summary: `[${a.action} risk=${risk}] ok${d.title ? " — " + d.title : ""}`, data: { action: a.action, risk, ...d, text: d.text ? trimOut(d.text, 3000) : d.value ?? "" }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "n_ubrowser_shot", reason: "Confirmar visualmente" }] });
  },
});

reg("n_ubrowser_shot", {
  description: "Print da aba VISÍVEL do dono (imagem + arquivo). Fundo = sem print (use read). Nunca troca de aba.",
  inputSchema: { type: "object", properties: { tabId: { type: "number" } }, required: [] },
  run: async ({ tabId }) => {
    const t0 = Date.now();
    const r = await ubSend("tab.shot", { tabId });
    if (r.__offline || r.__timeout) return devOut({ status: "error", summary: r.__offline ? UB_OFF : "timeout 60s", data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    if (!r.ok) return devOut({ status: "error", summary: `extensão: ${r.error}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    const b64 = String(r.data.dataUrl || "").split(",")[1] || "";
    if (!b64) return devOut({ status: "error", summary: "screenshot vazio", data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    return { content: [{ type: "text", text: `Screenshot ${r.data.tab?.title || ""} — ${r.data.tab?.url || ""}` }, { type: "image", data: b64.length > 1500000 ? b64.slice(0, 1500000) : b64, mimeType: "image/png" }] };
  },
});

