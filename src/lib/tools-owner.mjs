// canivete — tools do navegador LOGADO do dono (ubrowser_*)
import { reg, devOut, trimOut } from "./ctx.mjs";
import { ubEnsure, ubSend, ubConnected, UB_OFF, ubRisk, UB_PORT, ubStats } from "./ubridge.mjs";
// recovery sem mudar protocolo: só texto de erro acionável (janela NORMAL, popup, token) + fallback headless
const UB_REC = "Recovery dono: 1) Chrome janela NORMAL mesmo perfil (sem anonimo) 2) popup extensao UBrowser ATIVO 3) token ~/.config/canivete/token.txt igual na extensao 4) rode n_ubrowser_status p/ confirmar";
const UB_FB = "Sem login? fallback headless: n_browser_navigate / n_browser_screenshot";
const UB_OFF_FULL = `${UB_OFF} | ${UB_REC} | ${UB_FB}`;
const UB_TIMEOUT = "timeout 60s — extensao nao respondeu: tente de novo ou cheque n_ubrowser_status";

reg("n_ubrowser_status", {
  description: "Status da ponte com o Chrome LOGADO do dono (extensão local). Quando usar: antes de qualquer ação no navegador do dono. Se offline: janela NORMAL, mesmo perfil, popup ATIVO.\nFluxo: status→tabs→read(distill)|snapshot(compact)→act→shot\nLista virtualizada? act scan pages:6 antes do snapshot\nFundo? read/snapshot (shot só aba VISÍVEL).",
  inputSchema: { type: "object", properties: {}, required: [] },
  run: async () => {
    ubEnsure();
    const c = ubConnected();
    return devOut({ status: c ? "success" : "error", summary: c ? "UBrowser pronto (extensão conectada)" : "EXTENSÃO OFFLINE — dono: abra o Chrome (janela NORMAL, mesmo perfil, popup ATIVO)", data: { connected: c, ...ubStats() }, telemetry: { execution_time_ms: 0 } });
  },
});

reg("n_ubrowser_tabs", {
  description: "Abas do Chrome do dono (id, janela, anônima?, título, url). Diagnostica janela/perfil errado.",
  inputSchema: { type: "object", properties: {}, required: [] },
  run: async () => {
    const t0 = Date.now();
    const r = await ubSend("tabs.list", {});
    if (r.__offline || r.__timeout) return devOut({ status: "error", summary: r.__offline ? UB_OFF_FULL : `${UB_TIMEOUT} | ${UB_FB}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    if (!r.ok) return devOut({ status: "error", summary: `extensão: ${r.error} | ${UB_FB}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    const tabs = r.data.tabs || r.data || [];
    const wins = r.data.windows || [];
    const slim = (Array.isArray(tabs) ? tabs : []).map((t) => ({ id: t.id, window: t.windowId ?? t.window ?? t.win, title: t.title, url: t.url }));
    return devOut({ summary: `${slim.length} aba(s) em ${wins.length || "?"} janela(s)`, data: { tabs: slim }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "n_ubrowser_read", reason: "Ler aba ativa" }] });
  },
});

reg("n_ubrowser_read", {
  description: "Lê aba do dono COM login. Destilado markdown/desduplicado por padrão (mode=distill, ~4000 chars); mode=raw devolve texto integral + links (maxChars default 2500, maxLinks 15). {tabId?/tab?} = aba ativa.",
  inputSchema: { type: "object", properties: { tabId: { type: "number" }, tab: { type: "string", description: "trecho do título/URL (resolve p/ tabId; IDs mudam)" }, maxChars: { type: "number", default: 2500 }, maxLinks: { type: "number", default: 15 }, mode: { type: "string", enum: ["distill", "raw"], default: "distill", description: "distill=destilado enxuto (default); raw=texto integral opt-out" } }, required: [] },
  run: async ({ tabId, mode, maxChars, maxLinks }) => {
    const t0 = Date.now();
    const r = await ubSend("tab.read", { tabId, mode: mode || "distill", maxChars, maxLinks });
    if (r.__offline || r.__timeout) return devOut({ status: "error", summary: r.__offline ? UB_OFF_FULL : `${UB_TIMEOUT} | ${UB_FB}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    if (!r.ok) return devOut({ status: "error", summary: `extensão: ${r.error} | ${UB_FB}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    const body = r.data.markdown || r.data.text || "";
    const allLinks = r.data.links || [];
    const links = allLinks.slice(0, 15);
    const omitted = allLinks.length > links.length ? allLinks.length - links.length : 0;
    const omitNote = omitted ? ` (+${omitted} links omitidos)` : "";
    return devOut({ summary: `${r.data.title} — ${r.data.url}${r.data.markdown ? ` (destilado ${r.data.stats ? r.data.stats.chars + " chars" : ""})` : ""}${omitNote}`, data: { title: r.data.title, url: r.data.url, text: trimOut(body, 6000), links, linksOmitted: omitted, stats: r.data.stats }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "n_ubrowser_snapshot", reason: "Mapear cliques" }] });
  },
});

// UB_SNAP_PURE_START — lógica pura do n_ubrowser_snapshot (rank/junk/auto-compact-por-campos). Sem I/O: testável via node -e sem extensão.
// Rank: viewport → nome → papel (editáveis por último, como antes). Junk: sem nome descartado com `omitted`. Auto-compact: corta CAMPOS por nível, nunca elementos.
const UB_SNAP_ROLE_SCORE = { button: 3, link: 3, textbox: 3, combobox: 3, checkbox: 3, radio: 3, switch: 3, slider: 3, searchbox: 3, spinbutton: 2, menuitem: 2, menuitemcheckbox: 2, menuitemradio: 2, tab: 2, option: 1, listitem: 1, row: 1, heading: 0, img: -2, generic: -2, "": -2 };
const UB_SNAP_KEEP_NAMELESS = new Set(["button", "link", "textbox", "combobox", "checkbox", "radio", "switch", "slider", "searchbox", "spinbutton", "menuitem", "menuitemcheckbox", "menuitemradio", "tab", "option"]);
const UB_SNAP_BYTE_BUDGET = 12000; // ~3k tokens: acima disso corta CAMPOS (nunca elementos — contagem intacta)
function ubSnapIsEditable(el) {
  if (!el) return false;
  if (el.tag === "input" || el.tag === "textarea") return true;
  if (el.contentEditable === "true" || el.contentEditable === true) return true;
  try { return Array.isArray(el.attributes) && el.attributes.some((x) => x && x.name === "contenteditable"); } catch { return false; }
}
function ubSnapLabel(el) { return String(el?.name ?? "").trim() || String(el?.text ?? "").trim(); }
function ubSnapRole(el) { return String(el?.role ?? "").trim().toLowerCase(); }
function ubSnapHasBox(el) { return (Number(el?.w) || 0) > 0 && (Number(el?.h) || 0) > 0; }
function ubSnapInViewport(el) {
  if (!ubSnapHasBox(el)) return false;
  const x = Number(el.x) || 0, y = Number(el.y) || 0, w = Number(el.w) || 0, h = Number(el.h) || 0;
  return x > -w && y > -h && x < 4000 && y < 4000;
}
function ubSnapIsJunk(el) {
  if (!el || typeof el !== "object") return true;
  if (ubSnapLabel(el)) return false; // com nome/texto nunca é junk
  if (String(el.type || "").toLowerCase() === "hidden") return true; // input hidden
  if (!ubSnapHasBox(el)) return true; // invisível e sem nome
  if (!UB_SNAP_KEEP_NAMELESS.has(ubSnapRole(el))) return true; // genérico/heading/img sem nome
  return false; // botão/link/campo visível sem nome: mantém (acionável via selector)
}
function ubSnapScore(el) {
  let s = 0;
  if (ubSnapInViewport(el)) s += (Number(el?.y) || 0) >= 0 ? 2 : 1; // viewport primeiro
  else s -= 3;
  s += ubSnapLabel(el) ? 2 : -2; // com nome primeiro
  s += UB_SNAP_ROLE_SCORE[ubSnapRole(el)] ?? 0; // papel: ação > leitura > genérico
  if (ubSnapIsEditable(el)) s -= 5; // editáveis por último (comportamento histórico)
  if (String(el?.state || "").includes("disabled")) s -= 2;
  return s;
}
function ubSnapRank(els) {
  return [...els]
    .map((el, i) => ({ el, i, s: ubSnapScore(el) }))
    .sort((a, b) => (b.s - a.s) || ((a.el?.y || 0) - (b.el?.y || 0)) || ((a.el?.x || 0) - (b.el?.x || 0)) || (a.i - b.i))
    .map((r) => r.el);
}
function ubSnapBytes(els) { try { return JSON.stringify(els).length; } catch { return 0; } }
// auto-compact-por-campos: N1 path/state/level/type → N2 x/y/w/h (layout; cursor re-mede via selector) → N3 name/text 60→40 → N4 shape compact+selector (ação intacta). Contagem SEMPRE intacta.
function ubSnapAutoCompactFields(els, budget = UB_SNAP_BYTE_BUDGET) {
  const bytes0 = ubSnapBytes(els);
  if (bytes0 <= budget) return { elements: els, autoCompact: false, dropped: [], bytes: bytes0 };
  const drop = (o, ks) => { const c = { ...o }; for (const k of ks) delete c[k]; return c; };
  let out = els.map((el) => drop(el, ["path", "state", "level", "type"]));
  let dropped = ["path", "state", "level", "type"];
  if (ubSnapBytes(out) <= budget) return { elements: out, autoCompact: true, dropped, bytes: ubSnapBytes(out) };
  out = out.map((el) => drop(el, ["x", "y", "w", "h"]));
  dropped = [...dropped, "x", "y", "w", "h"];
  if (ubSnapBytes(out) <= budget) return { elements: out, autoCompact: true, dropped, bytes: ubSnapBytes(out) };
  out = out.map((el) => ({ ...el, ...(el.name ? { name: String(el.name).slice(0, 40) } : {}), ...(el.text ? { text: String(el.text).slice(0, 40) } : {}) }));
  dropped = [...dropped, "text>40", "name>40"];
  if (ubSnapBytes(out) <= budget) return { elements: out, autoCompact: true, dropped, bytes: ubSnapBytes(out) };
  out = out.map(({ ref, tag, text, role, name, selector }) => ({ ref, tag, text, role, ...(name ? { name } : {}), ...(selector ? { selector } : {}) }));
  dropped = [...dropped, "shape=compact+selector"];
  return { elements: out, autoCompact: true, dropped, bytes: ubSnapBytes(out) };
}
// UB_SNAP_PURE_END

reg("n_ubrowser_snapshot", {
  description: "Elementos clicáveis da aba do dono (ref/tag/texto/selector). compact=true: só ref|tag|texto|role sem x/y/w/h/selector (~60% menos tokens, paridade com headless). Suporte a paginação: max (default 50, máx 120) + offset para paginar até o fim. Rank por importância (viewport→nome→papel; editáveis por último) + junk sem nome descartado com `omitted`. Auto-compact-por-campos: corta CAMPOS (nunca elementos — mantém a página) acima do orçamento. Use offset para avançar páginas.",
  inputSchema: { type: "object", properties: { tabId: { type: "number" }, tab: { type: "string", description: "trecho do título/URL (resolve p/ tabId; IDs mudam)" }, max: { type: "number", default: 50, description: "máximo de elementos por página (default 50, máx 120)" }, offset: { type: "number", default: 0, description: "pula N primeiros (paginação)" }, compact: { type: "boolean", default: false, description: "compact=true: só ref|tag|texto|role sem x/y/w/h (~60% menos tokens, paridade com headless)" } }, required: [] },
  run: async ({ tabId, tab, max, offset, compact }) => {
    const t0 = Date.now();
    const cappedMax = Math.min(Number(max) || 50, 120);
    const r = await ubSend("tab.snapshot", { tabId, tab, max: cappedMax, offset });
    if (r.__offline || r.__timeout) return devOut({ status: "error", summary: r.__offline ? UB_OFF_FULL : `${UB_TIMEOUT} | ${UB_FB}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    if (!r.ok) return devOut({ status: "error", summary: `extensão: ${r.error} | ${UB_FB}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    const elements = Array.isArray(r.data) ? r.data : (Array.isArray(r.data?.items) ? r.data.items : []);
    const ranked = ubSnapRank(elements);
    const kept = [];
    let junk = 0;
    for (const el of ranked) { if (ubSnapIsJunk(el)) junk++; else kept.push(el); }
    const omitNote = junk ? ` (+${junk} junk omitidos)` : "";
    if (compact) {
      const compactOut = kept.map(({ ref, tag, text, role }) => ({ ref, tag, text, role }));
      return devOut({ summary: `${compactOut.length} elemento(s) (compact)${omitNote}`, data: { elements: compactOut, compact: true, omitted: junk }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "n_ubrowser_act", reason: "Agir com selector" }] });
    }
    const ac = ubSnapAutoCompactFields(kept);
    const autoNote = ac.autoCompact ? ` (auto-compact campos: -${ac.dropped.join(",")})` : "";
    return devOut({ summary: `${ac.elements.length} elemento(s)${ac.autoCompact ? " (compact-campos)" : ""}${omitNote}${autoNote}`, data: { elements: ac.elements, compact: ac.autoCompact, compactFields: ac.dropped, omitted: junk, bytes: ac.bytes }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "n_ubrowser_act", reason: "Agir com selector" }] });
  },
});

reg("n_ubrowser_act", {
  description: "AUTOMAÇÃO no Chrome LOGADO do dono (só quando ele pedir; NUNCA destrutivo sem pedido; alto risco exige confirm; FECHAR ABAS e ROUBAR FOCO PROIBIDOS). Ações: goto/click/fill/type/select/press/scroll/waittext/evaluate/cursor/scan/flow (1 ida-volta). Funciona em aba de fundo (tabId). Sem login? use n_browser_* headless.",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["goto", "back", "forward", "reload", "click", "fill", "type", "select", "press", "scroll", "highlight", "waittext", "wait", "evaluate", "cursor", "new", "scan", "count", "attr", "html", "flow"] },
      tabId: { type: "number" }, tab: { type: "string", description: "trecho do título/URL (resolve p/ tabId; IDs mudam)" }, url: { type: "string" }, selector: { type: "string" }, text: { type: "string" },
      name: { type: "string", description: "atributo p/ attr (href/src/value/text/html)" },
      container: { type: "string", description: "selector do container p/ scan/scroll (listas virtualizadas, opcional)" },
      confirmLogin: { type: "boolean", description: "(legado, ignorado) gate de senha removido a pedido do dono" },
      value: { type: "string", description: "valor p/ select (match por texto ou value da option)" },
      timeoutMs: { type: "number", description: "teto p/ waittext e evaluate (default 8000, máx 20000)" },
      steps: { type: "array", description: "p/ flow: [{cmd:tab.read|..., ...args}] (máx 12, 1 ida-volta)", items: { type: "object" } },
      key: { type: "string" }, js: { type: "string" }, ms: { type: "number" },
      x: { type: "number", description: "viewport X p/ cursor" }, y: { type: "number", description: "viewport Y p/ cursor" },
      click: { type: "boolean", description: "cursor clica ao chegar" },
      direction: { type: "string", enum: ["up", "down", "top", "bottom"] },
      submit: { type: "boolean" }, waitMs: { type: "number" },
      pages: { type: "number", default: 4, description: "páginas de rolagem p/ scan (listas virtualizadas)" },
      confirm: { type: "string", description: "Frase do dono p/ alto risco" },
    },
    required: ["action"],
  },
  run: async (a) => {
    const t0 = Date.now();
    if (!a.action) return devOut({ status: "error", summary: `action ausente — ações válidas: goto|back|forward|reload|click|fill|type|select|press|scroll|highlight|waittext|wait|evaluate|cursor|new|scan|count|attr|html|flow | exemplo: {action:"goto", tab:"trecho", url:"https://..."}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    const risk = ubRisk(a);
    if (risk === "high" && !(a.confirm && a.confirm.trim().length >= 4))
      return devOut({ status: "error", summary: `BLOQUEADO (alto risco: pagamento/senha/excluir/apagar). Só com pedido EXPLÍCITO + confirm="<frase do dono>". Ação: ${a.action} ${a.selector || a.url || ""}`, data: { action: a.action, risk }, telemetry: { execution_time_ms: Date.now() - t0 } });
    if (a.action === "wait") { await new Promise((r) => setTimeout(r, Math.min(Number(a.ms) || 2000, 15000))); return devOut({ summary: "wait ok", data: { action: "wait" }, telemetry: { execution_time_ms: Date.now() - t0 } }); }
    const map = { goto: "tab.goto", back: "tab.back", forward: "tab.forward", reload: "tab.reload", click: "tab.click", fill: "tab.fill", type: "tab.type", select: "tab.select", press: "tab.press", scroll: "tab.scroll", highlight: "tab.highlight", waittext: "tab.waittext", evaluate: "tab.evaluate", cursor: "tab.cursor", new: "tab.new", scan: "tab.scan", count: "tab.count", attr: "tab.attr", html: "tab.html", flow: "tab.flow" };
    const r = await ubSend(map[a.action], { ...a });
    if (r.__offline || r.__timeout) return devOut({ status: "error", summary: r.__offline ? UB_OFF_FULL : `${UB_TIMEOUT} | ${UB_FB}`, data: { action: a.action }, telemetry: { execution_time_ms: Date.now() - t0 } });
    if (!r.ok) return devOut({ status: "error", summary: `extensão: ${r.error} | ${UB_FB}`, data: { action: a.action }, telemetry: { execution_time_ms: Date.now() - t0 } });
    const d = r.data || {};
    if (a.action === "evaluate") {
      const value = d.value ?? null;
      const errStr = String(d.error ?? d.message ?? d.details ?? "");
      const cspBlocked = /CSP|Content-Security|blocked|eval/i.test(errStr);
      const pageLoaded = d.pageLoaded ?? true;
      const selFound = a.selector ? (value !== null && value !== undefined && value !== "") : undefined;
      if (!pageLoaded) return devOut({ status: "error", summary: `página não carregou — recovery: reload via n_ubrowser_act + waittext e tente de novo | ${UB_FB}`, data: { action: a.action, risk, value: null, cspBlocked: false, selectorFound: false, pageLoaded: false }, telemetry: { execution_time_ms: Date.now() - t0 } });
      if (cspBlocked) return devOut({ status: "error", summary: `CSP bloqueou avaliação JS — use n_ubrowser_read / n_ubrowser_snapshot em vez de evaluate | ${UB_FB}`, data: { action: a.action, risk, value: null, cspBlocked: true, selectorFound: selFound, error: d.error }, telemetry: { execution_time_ms: Date.now() - t0 } });
      if (a.selector && !selFound) return devOut({ status: "error", summary: `seletor não achou elemento — recovery: rode n_ubrowser_snapshot p/ selector atual + confira aba ativa | ${UB_FB}`, data: { action: a.action, risk, value: null, cspBlocked: false, selectorFound: false }, telemetry: { execution_time_ms: Date.now() - t0 } });
      if (!a.selector && value === null) return devOut({ status: "warn", summary: `evaluate retornou null — termine JS com valor + confira n_ubrowser_snapshot/read | ${UB_FB}`, data: { action: a.action, risk, value: null, cspBlocked: false, selectorFound: selFound }, telemetry: { execution_time_ms: Date.now() - t0 } });
      return devOut({ summary: "[evaluate] ok", data: { action: a.action, risk, value, cspBlocked: false, selectorFound: selFound }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "n_ubrowser_shot", reason: "Confirmar visualmente" }] });
    }
    // state-diff barato (sem round-trip extra): antes = intenção (a.url p/ goto/new), depois = estado que a extensão já retorna (d.title/d.url, fallback p/ a.url).
    const afterUrl = d.url ?? a.url ?? null;
    const afterTitle = d.title ?? null;
    const beforeUrl = (a.action === "goto" || a.action === "new") && a.url ? String(a.url) : null;
    const urlChanged = !!beforeUrl && !!afterUrl && beforeUrl !== afterUrl;
    const navNewDoc = ["goto", "back", "forward", "new"].includes(a.action);
    const titleChanged = !!afterTitle && (urlChanged || navNewDoc);
    const afterLabel = String(afterTitle ? `${afterTitle} — ${afterUrl || ""}` : (afterUrl || d.selector || d.value || d.text || "ok")).slice(0, 120);
    const diff = urlChanged ? `navegou ${beforeUrl}→${afterUrl}` : (navNewDoc && afterUrl ? `navegou para ${afterLabel}` : `mesma página: ${afterLabel}`);
    return devOut({ summary: `[${a.action} risk=${risk}] ok — ${diff}`, data: { action: a.action, risk, ok: true, title: d.title, url: d.url, result: trimOut(d.text ?? d.value ?? "", 500), after: { url: afterUrl, title: afterTitle }, changed: { url: urlChanged, title: titleChanged } }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "n_ubrowser_shot", reason: "Confirmar visualmente" }] });
  },
});

reg("n_ubrowser_shot", {
  description: "Print da aba VISÍVEL do dono (imagem + arquivo). Fundo = sem print — se a aba estiver em segundo plano: 'Chrome só imprime aba VISÍVEL — traga p/ frente ou use n_browser_screenshot headless'. Nunca troca de aba. Retorna tamanho em kB no texto; se pesado use scale:0.5 (metade dos bytes).",
  inputSchema: { type: "object", properties: { tabId: { type: "number" }, tab: { type: "string", description: "trecho do título/URL (resolve p/ tabId; IDs mudam)" }, scale: { type: "number", enum: [0.5, 1], default: 1, description: "deviceScaleFactor: 0.5 = metade dos bytes" } }, required: [] },
  run: async ({ tabId, tab, scale }) => {
    const t0 = Date.now();
    const dsf = Number(scale) === 0.5 ? 0.5 : 1;
    const r = await ubSend("tab.shot", { tabId, tab, scale: dsf });
    if (r.__offline || r.__timeout) return devOut({ status: "error", summary: r.__offline ? UB_OFF_FULL : `${UB_TIMEOUT} | ${UB_FB}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    if (!r.ok) return devOut({ status: "error", summary: `extensão: ${r.error} | ${UB_FB}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    if (r.data?.background) return devOut({ status: "error", summary: "Chrome só imprime aba VISÍVEL — traga p/ frente ou use n_browser_screenshot headless", data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    const b64 = String(r.data.dataUrl || "").split(",")[1] || "";
    if (!b64) return devOut({ status: "error", summary: `screenshot vazio — traga aba p/ frente e tente de novo | ${UB_FB}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    const kb = Math.round((b64.length * 0.75) / 1024);
    const truncated = b64.length > 1500000;
    const tip = (truncated || kb > 500) ? " — dica: scale:0.5 = metade dos bytes" : "";
    return { content: [{ type: "text", text: `Screenshot ${r.data.tab?.title || ""} — ${r.data.tab?.url || ""} (${kb} kB base64${truncated ? ", truncado em 1500k chars" : ""})${tip}` }, { type: "image", data: truncated ? b64.slice(0, 1500000) : b64, mimeType: "image/png" }] };
  },
});

