// canivete — tools do navegador LOGADO do dono (ubrowser_*)
import { reg, devOut, trimOut } from "./ctx.mjs";
import { ubEnsure, ubSend, ubConnected, UB_OFF, ubRisk, UB_PORT, ubStats, ubAlertsPending, ubAlertsRead, ubAlertsHint } from "./ubridge.mjs";
// recovery sem mudar protocolo: só texto de erro acionável (janela NORMAL, popup, token) + fallback headless
const UB_REC = "Recovery dono: 1) Chrome janela NORMAL mesmo perfil (sem anonimo) 2) popup extensao UBrowser ATIVO 3) token ~/.config/canivete/token.txt igual na extensao 4) rode n_ubrowser_status p/ confirmar";
const UB_FB = "Sem login? fallback headless: n_browser_navigate / n_browser_screenshot";
const UB_OFF_FULL = `${UB_OFF} | ${UB_REC} | ${UB_FB}`;
const UB_TIMEOUT = "timeout 60s — extensao nao respondeu: tente de novo ou cheque n_ubrowser_status";

reg("n_ubrowser_status", {
  description: "Status da ponte com o Chrome LOGADO do dono (extensão local). SEMPRE o passo 1: offline → janela NORMAL (anônima é invisível), mesmo perfil, popup ATIVO, token igual. Fluxo: status→tabs→read|snapshot→act→shot. IDs de aba mudam — nas tools prefira tab:\"trecho do título/URL\".",
  inputSchema: { type: "object", properties: {}, required: [] },
  run: async () => {
    ubEnsure();
    const c = ubConnected();
    return devOut({ status: c ? "success" : "error", summary: c ? "UBrowser pronto (extensão conectada)" : "EXTENSÃO OFFLINE — dono: abra o Chrome (janela NORMAL, mesmo perfil, popup ATIVO)", data: { connected: c, ...ubStats() }, telemetry: { execution_time_ms: 0 } });
  },
});

reg("n_ubrowser_tabs", {
  description: "Abas do Chrome do dono (id, janela, anônima?, título, url). Diagnostica janela/perfil errado. Nas demais tools passe tab:\"trecho\" (resolve sozinho, http(s) primeiro, chrome:// por último) — tabId numérico só se o trecho ambíguo.",
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
  description: "Lê aba do dono COM login (texto+links). Mire com tab:\"trecho\" ou tabId. mode=distill (default, enxuto) | raw (integral + links). outline=true: só estrutura (h1-h6 + contagens) p/ triagem. maxChars/maxLinks dão teto. AUTOMÁTICO: espera a página aquietar (SPA), perfura shadow DOM, inputs mostram value separado (`[campo text Nome] = \"João\"`). Pra JS use evaluate no act; pra erros/rede use act console.",
  inputSchema: { type: "object", properties: { tabId: { type: "number" }, tab: { type: "string", description: "trecho do título/URL (resolve p/ tabId; IDs mudam)" }, maxChars: { type: "number", default: 2500 }, maxLinks: { type: "number", default: 15 }, mode: { type: "string", enum: ["distill", "raw"], default: "distill", description: "distill=destilado enxuto (default); raw=texto integral opt-out" }, outline: { type: "boolean", description: "outline=true: só estrutura (h1-h6 + contagens) p/ triagem rápida" } }, required: [] },
  run: async ({ tabId, tab, mode, maxChars, maxLinks, outline }) => {
    const t0 = Date.now();
    const r = await ubSend("tab.read", { tabId, tab, mode: mode || "distill", maxChars, maxLinks, ...(outline ? { outline: true } : {}) });
    if (r.__offline || r.__timeout) return devOut({ status: "error", summary: r.__offline ? UB_OFF_FULL : `${UB_TIMEOUT} | ${UB_FB}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    if (!r.ok) return devOut({ status: "error", summary: `extensão: ${r.error} | ${UB_FB}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    const body = r.data.markdown || r.data.text || "";
    const allLinks = r.data.links || [];
    const links = allLinks.slice(0, 15);
    const omitted = allLinks.length > links.length ? allLinks.length - links.length : 0;
    const omitNote = omitted ? ` (+${omitted} links omitidos)` : "";
    return devOut({ summary: `${r.data.title} — ${r.data.url}${r.data.markdown ? ` (destilado ${r.data.stats ? r.data.stats.chars + " chars" : ""})` : ""}${omitNote}${ubAlertsHint()}`, data: { title: r.data.title, url: r.data.url, text: trimOut(body, 6000), links, linksOmitted: omitted, stats: r.data.stats }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "n_ubrowser_snapshot", reason: "Mapear cliques" }] });
  },
});

// UB_SNAP_PURE_START — lógica pura do n_ubrowser_snapshot (rank/junk/auto-compact-por-campos). Sem I/O: testável via node -e sem extensão.
// Rank: viewport → nome → papel (editáveis por último, como antes). Junk: sem nome descartado com `omitted`. Auto-compact: corta CAMPOS por nível, nunca elementos.
// Fold: runs ≥6 consecutivos com mesmo role+head viram 1 marcador com refs preservadas (mcprune-style).
// DedupLinks: mesmo (texto+href) mantém o primeiro.
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
  if (typeof el.layer === "string" && el.layer) return false; // v11: em overlay (modal/menu/popover) nunca é junk — o LLM precisa ver a camada
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
  try { if (el && el.layer === "modal") s += 2; else if (el && el.layer) s += 1; } catch {} // v11: camada de overlay primeiro (modal bloqueia a página)
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
function ubSnapFoldKey(el) { return `${String(el?.role || "")}|${String(el?.text || el?.name || "").slice(0, 24).toLowerCase()}`; }
function ubSnapFold(els, minRun = 6) {
  const out = [];
  let i = 0, folded = 0;
  while (i < els.length) {
    const k = ubSnapFoldKey(els[i]);
    let j = i + 1;
    while (j < els.length && ubSnapFoldKey(els[j]) === k) j++;
    const run = j - i;
    if (run >= minRun && k.split("|")[0]) {
      folded++;
      const refs = els.slice(i, j).map((e) => e.ref).filter((r) => r !== undefined);
      const first = els[i];
      out.push({ ...first, text: `${first.text || first.name || ""} … +${run - 1} similares`, folded: run, foldRefs: refs });
    } else {
      for (let m = i; m < j; m++) out.push(els[m]);
    }
    i = j;
  }
  return { elements: out, folded };
}
function ubSnapDedupLinks(els) {
  const seenHref = new Set();
  const out = [];
  let dupes = 0;
  for (const el of els) {
    const h = el && el.role === "link" ? String(el.href || "") : "";
    if (h) {
      const k = h.split("#")[0];
      if (seenHref.has(k)) { dupes++; continue; }
      seenHref.add(k);
    }
    out.push(el);
  }
  return { elements: out, dupes };
}
// auto-compact-por-campos: N1 path/state/level/type/href → N2 x/y/w/h (layout; cursor re-mede via selector) → N3 name/text 60→40 → N4 shape compact+selector (ação intacta). depth e layer/layerLabel NUNCA caem — hierarquia e camada p/ o LLM. Contagem SEMPRE intacta.
function ubSnapAutoCompactFields(els, budget = UB_SNAP_BYTE_BUDGET) {
  const bytes0 = ubSnapBytes(els);
  if (bytes0 <= budget) return { elements: els, autoCompact: false, dropped: [], bytes: bytes0 };
  const drop = (o, ks) => { const c = { ...o }; for (const k of ks) delete c[k]; return c; };
  let out = els.map((el) => drop(el, ["path", "state", "level", "type", "href"]));
  let dropped = ["path", "state", "level", "type", "href"];
  if (ubSnapBytes(out) <= budget) return { elements: out, autoCompact: true, dropped, bytes: ubSnapBytes(out) };
  out = out.map((el) => drop(el, ["x", "y", "w", "h"]));
  dropped = [...dropped, "x", "y", "w", "h"];
  if (ubSnapBytes(out) <= budget) return { elements: out, autoCompact: true, dropped, bytes: ubSnapBytes(out) };
  out = out.map((el) => ({ ...el, ...(el.name ? { name: String(el.name).slice(0, 40) } : {}), ...(el.text ? { text: String(el.text).slice(0, 40) } : {}) }));
  dropped = [...dropped, "text>40", "name>40"];
  if (ubSnapBytes(out) <= budget) return { elements: out, autoCompact: true, dropped, bytes: ubSnapBytes(out) };
  out = out.map(({ ref, tag, text, role, name, selector, depth, layer, layerLabel, folded, foldRefs }) => ({ ref, tag, text, role, ...(name ? { name } : {}), ...(selector ? { selector } : {}), ...(depth ? { depth } : {}), ...(layer ? { layer, ...(layerLabel ? { layerLabel } : {}) } : {}), ...(folded ? { folded, foldRefs } : {}) }));
  dropped = [...dropped, "shape=compact+selector"];
  return { elements: out, autoCompact: true, dropped, bytes: ubSnapBytes(out) };
}
// UB_SNAP_PURE_END

// Cache ref→selector (#48: click por ref). Chave = tabId ?? tab ?? "active".
// Refs morrem na navegação — sem detector barato, miss vira erro acionável (re-snapshot).
const UB_SNAP_CACHE = new Map();
function ubSnapCacheKey({ tabId, tab }) {
  if (tabId !== undefined && tabId !== null && String(tabId) !== "") return `id:${tabId}`;
  if (tab) return `tab:${String(tab).toLowerCase()}`;
  return "active";
}
function ubSnapCacheStore(key, elements) {
  try {
    UB_SNAP_CACHE.set(key, (Array.isArray(elements) ? elements : []).map((el) => ({ ref: el.ref, selector: el.selector })).filter((e) => e.ref !== undefined && e.selector));
    if (UB_SNAP_CACHE.size > 5) UB_SNAP_CACHE.delete(UB_SNAP_CACHE.keys().next().value);
  } catch {}
}
function ubSnapCacheResolve(key, ref) {
  const box = UB_SNAP_CACHE.get(key);
  if (!box) return { ok: false, error: `sem snapshot em cache p/ esta aba — rode n_ubrowser_snapshot antes de usar ref` };
  const hit = box.find((e) => String(e.ref) === String(ref));
  if (!hit) return { ok: false, error: `ref ${ref} expirada (snapshot mudou/navegou) — re-snapshot e use a ref nova` };
  return { ok: true, selector: hit.selector };
}

reg("n_ubrowser_snapshot", {
  description: "Clicáveis da aba → aja com SELECTOR ou ref (refs válidas até a próxima navegação — SEMPRE re-snapshot após goto/click que navega). find=\"texto\": localiza com ±3 contexto sem despejar tudo. layer=\"modal|menu|popover|tooltip\": foca SÓ na camada (modal de 2 botões sem ler a página); sem filtro e com overlay aberto, a camada vai primeiro sozinha. Listas grandes dobram sozinhas (marcador … +N similares com refs). Links repetidos caem no dedup. shadow: na frente do selector = dentro de web component (clicável). imgs com alt/src entram. compact=true economiza ~60% tokens (mantém layer). max (50-120) + offset pagina. Lista virtualizada (WhatsApp): act scan antes. Rank: viewport→nome→papel.",
  inputSchema: { type: "object", properties: { tabId: { type: "number" }, tab: { type: "string", description: "trecho do título/URL (resolve p/ tabId; IDs mudam)" }, max: { type: "number", default: 50, description: "máximo de elementos por página (default 50, máx 120)" }, offset: { type: "number", default: 0, description: "pula N primeiros (paginação)" }, compact: { type: "boolean", default: false, description: "compact=true: só ref|tag|texto|role sem x/y/w/h (~60% menos tokens, paridade com headless)" }, find: { type: "string", description: "busca texto no snapshot e devolve matches ±3 contexto (sem despejar tudo)" }, layer: { type: "string", enum: ["modal", "menu", "popover", "tooltip"], description: "foco SÓ na camada (ex: modal de 2 botões sem ler a página inteira)" } }, required: [] },
  run: async ({ tabId, tab, max, offset, compact, find, layer }) => {
    const t0 = Date.now();
    const cappedMax = Math.min(Number(max) || 50, 120);
    const needle = String(find || "").trim().toLowerCase();
    const r = await ubSend("tab.snapshot", { tabId, tab, max: cappedMax, offset, ...(needle ? { match: needle } : {}) });
    if (r.__offline || r.__timeout) return devOut({ status: "error", summary: r.__offline ? UB_OFF_FULL : `${UB_TIMEOUT} | ${UB_FB}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    if (!r.ok) return devOut({ status: "error", summary: `extensão: ${r.error} | ${UB_FB}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    const elements = Array.isArray(r.data) ? r.data : (Array.isArray(r.data?.items) ? r.data.items : []);
    const overlay = (!Array.isArray(r.data) && r.data && typeof r.data.overlay === "object" && r.data.overlay) ? r.data.overlay : null;
    const overlayNote = (overlay && overlay.open) ? ` | OVERLAY OPEN (${overlay.kind || "?"}${overlay.label ? ` "${String(overlay.label).slice(0, 60)}"` : ""}) — página bloqueada atrás` : "";
    const overlayData = overlay ? { overlay } : {};
    const ranked = ubSnapRank(elements);
    const kept = [];
    let junk = 0;
    for (const el of ranked) { if (ubSnapIsJunk(el)) junk++; else kept.push(el); }
    ubSnapCacheStore(ubSnapCacheKey({ tabId, tab }), kept); // ref→selector p/ click por ref (#48)
    const omitNote = junk ? ` (+${junk} junk omitidos)` : "";
    // FOCO NA CAMADA: layer="modal" mostra SÓ a camada (modal de 2 botões sem ler a página);
    // sem filtro e com overlay aberto, a camada do modal vai PRIMEIRO (partição estável).
    let pool = kept, focusNote = "";
    const layerFilter = String(layer || "").trim().toLowerCase();
    if (layerFilter) {
      pool = kept.filter((el) => String(el.layer || "").toLowerCase() === layerFilter);
      if (!pool.length) return devOut({ summary: `layer "${layer}": vazio (overlay: ${overlay && overlay.open ? `${overlay.kind || "?"}${overlay.label ? ` "${String(overlay.label).slice(0, 60)}"` : ""}` : "nenhum aberto"}) em ${kept.length} elemento(s)${omitNote}${overlayNote}`, data: { layer, found: false, elements: [], ...overlayData }, telemetry: { execution_time_ms: Date.now() - t0 } });
      focusNote = ` (foco: layer=${layerFilter}, ${pool.length}/${kept.length})`;
    } else if (overlay && overlay.open) {
      const want = String(overlay.kind || "modal").toLowerCase();
      const isTop = (el) => { const l = String(el.layer || "").toLowerCase(); return l === want || (want !== "modal" && l === "modal"); };
      const top = pool.filter(isTop), rest = pool.filter((el) => !isTop(el));
      if (top.length && top.length < pool.length) { pool = [...top, ...rest]; focusNote = ` (foco: ${top.length} da camada "${overlay.kind || "modal"}" primeiro)`; }
    }
    // find: matches ±3 contexto, sem fold/dedup (previsível); resto do pipeline pula.
    if (needle) {
      const hits = [];
      pool.forEach((el, i) => {
        const hay = `${el.text || ""} ${el.name || ""}`.toLowerCase();
        if (hay.includes(needle)) hits.push(i);
      });
      if (!hits.length) return devOut({ summary: `find "${find}": nada em ${pool.length} elemento(s)${omitNote}${overlayNote}${focusNote}`, data: { find, found: false, elements: [], ...overlayData }, telemetry: { execution_time_ms: Date.now() - t0 } });
      const win = new Set();
      for (const h of hits) for (let k = Math.max(0, h - 3); k <= Math.min(pool.length - 1, h + 3); k++) win.add(k);
      const hitSet = new Set(hits);
      const lines = [...win].sort((a, b) => a - b).map((i) => {
        const el = pool[i];
        const tag = `[${el.ref ?? i}] ${el.role || el.tag} "${(el.text || el.name || "").slice(0, 80)}"`;
        return hitSet.has(i) ? `→ ${tag}  ← MATCH` : `  ${tag}`;
      });
      return devOut({ summary: `find "${find}": ${hits.length} match(es) em ${pool.length} elemento(s)${omitNote}${overlayNote}${focusNote}`, data: { find, found: true, matches: hits.map((i) => pool[i].ref ?? i), elements: [...win].sort((a, b) => a - b).map((i) => pool[i]), ...overlayData }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "n_ubrowser_act", reason: "Agir com ref/selector" }] });
    }
    const folded = ubSnapFold(pool);
    const foldedNote = folded.folded ? ` (dobra: ${pool.length}→${folded.elements.length})` : "";
    const dd = ubSnapDedupLinks(folded.elements);
    const dupeNote = dd.dupes ? ` (+${dd.dupes} links duplicados)` : "";
    if (compact) {
      // #42: text||name — img com alt/src ganha nome na extensão; compact não o esconde.
      const compactOut = dd.elements.map(({ ref, tag, text, role, name, layer, layerLabel }) => ({ ref, tag, text: text || name || "", role, ...(layer ? { layer, ...(layerLabel ? { layerLabel } : {}) } : {}) }));
      return devOut({ summary: `${compactOut.length} elemento(s) (compact)${omitNote}${foldedNote}${dupeNote}${overlayNote}${focusNote}${ubAlertsHint()}`, data: { elements: compactOut, compact: true, omitted: junk, ...overlayData }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "n_ubrowser_act", reason: "Agir com selector" }] });
    }
    const ac = ubSnapAutoCompactFields(dd.elements);
    const autoNote = ac.autoCompact ? ` (auto-compact campos: -${ac.dropped.join(",")})` : "";
    return devOut({ summary: `${ac.elements.length} elemento(s)${ac.autoCompact ? " (compact-campos)" : ""}${omitNote}${foldedNote}${dupeNote}${autoNote}${overlayNote}${focusNote}${ubAlertsHint()}`, data: { elements: ac.elements, compact: ac.autoCompact, compactFields: ac.dropped, omitted: junk, bytes: ac.bytes, ...overlayData }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "n_ubrowser_act", reason: "Agir com selector" }] });
  },
});

reg("n_ubrowser_act", {
  description: "AUTOMAÇÃO no Chrome LOGADO do dono (só quando ele pedir; NUNCA destrutivo sem pedido; alto risco exige confirm; FECHAR ABAS e ROUBAR FOCO PROIBIDOS). Mire por selector CSS, ref do snapshot OU text=\"trecho\" (qualquer elemento visível). EFICIÊNCIA (aja direto, sem enrolar): goto/new/back/forward/reload com snap:true já voltam top-10 (1 call a menos); click/fill/type/select/press retornam delta (o que mudou — sem re-snapshot p/ confirmar); flow = N cmds em 1 ida-volta; find no snapshot em vez de paginar. Funciona em aba de fundo (tabId). fill SUBSTITUI (Monaco/CodeMirror via API); type ANEXA. wait=waitMs reais (teto 15s). evaluate no MAIN (retry em null; CSP bloqueia → read/snapshot). console {filter:all|errors|net|console} lê erros+rede da aba (erros CHEGAM SOZINHOS via push + 📬 nas respostas). click/fill/type/select/press mostram 🔔 aviso efêmero no delta. scan {pages} p/ virtualizada. click/cursor retornam verified+whatChanged (verified:true = confie sem re-snapshot). tooltip {selector|x,y} revela tooltip via hover SEM clicar (só-leitura). snapshot marca layer=modal|menu|popover nos itens + overlay aberto no topo (aja dentro da camada). catchup {durationMs} pesca transientes (toasts/snackbars/aria-live, role=status|alert) que somem em segundos — volta apareceu/sumiu + texto, sem snapshot. Alvo que some entre snapshot e ação volta com WHERE (removed|hidden|scrolled-out|zero-box|recycled|never-found) em vez de NOTFOUND seco; scroll re-mede e re-resolve por texto/papel (até 3 tentativas, resolve=moved|recycled) em lista virtualizada. aesthetic julga layout (score 0-100 + issues até 12: contrast/tap-target/overflow-x/overlap/fonts) sem print — opinião visual direta. click/fill/type/select aceitam expectUrl/expectText/expectGone (assert pós-settle com PASS/FAIL no expect, sem re-ler a página).",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["goto", "back", "forward", "reload", "click", "fill", "type", "select", "press", "scroll", "highlight", "waittext", "wait", "evaluate", "cursor", "tooltip", "catchup", "aesthetic", "new", "scan", "count", "attr", "html", "flow", "console"] },
      tabId: { type: "number" }, tab: { type: "string", description: "trecho do título/URL (resolve p/ tabId; IDs mudam)" }, url: { type: "string" }, selector: { type: "string" }, text: { type: "string" },
      ref: { type: "number", description: "ref do snapshot (resolve p/ selector via cache; expira se navegar — re-snapshot)" },
      name: { type: "string", description: "atributo p/ attr (href/src/value/text/html)" },
      container: { type: "string", description: "selector do container p/ scan/scroll (listas virtualizadas, opcional)" },
      confirmLogin: { type: "boolean", description: "(legado, ignorado) gate de senha removido a pedido do dono" },
      value: { type: "string", description: "valor p/ select (match por texto ou value da option)" },
      timeoutMs: { type: "number", description: "teto p/ waittext e evaluate (default 8000, máx 20000)" },
      steps: { type: "array", description: "p/ flow: [{cmd:tab.read|..., ...args}] (máx 12, 1 ida-volta)", items: { type: "object" } },
      key: { type: "string" }, js: { type: "string" }, ms: { type: "number" },
      x: { type: "number", description: "viewport X p/ cursor|tooltip" }, y: { type: "number", description: "viewport Y p/ cursor|tooltip" },
      click: { type: "boolean", description: "cursor clica ao chegar (TRUSTED via CDP por padrão; trusted:false = sintético)" },
      trusted: { type: "boolean", description: "cursor: false desliga o clique trusted (usa sintético direto)" },
      hover: { type: "boolean", description: "click/cursor: mouseover antes do clique p/ menus/linhas que exigem :hover" },
      hoverMs: { type: "number", description: "duração do hover em ms p/ click/cursor/tooltip (default 300, teto 1500)" },
      force: { type: "boolean", description: "click/cursor_sel: clica mesmo com overlay por cima (padrão: falha COVERED)" },
      noEscalate: { type: "boolean", description: "click/cursor: desliga duplo-clique automático (default: escala sozinho)" },
      direction: { type: "string", enum: ["up", "down", "top", "bottom"] },
      submit: { type: "boolean" }, waitMs: { type: "number" },
      snap: { type: "boolean", description: "p/ goto/new/back/forward/reload: volta top-10 do snapshot junto (economiza 1 call)" },
      filter: { type: "string", enum: ["all", "errors", "net", "console"], default: "all", description: "p/ console: all|errors|net|console" },
      limit: { type: "number", default: 30, description: "p/ console: máx entradas (1-120)" },
      clear: { type: "boolean", description: "p/ console: limpa o buffer após ler" },
      pages: { type: "number", default: 4, description: "páginas de rolagem p/ scan (listas virtualizadas)" },
      durationMs: { type: "number", description: "p/ catchup: janela de pesca em ms (default 3000, teto 5000)" },
      expectUrl: { type: "string", description: "p/ click/fill/type/select: substring que deve aparecer na URL após settle" },
      expectText: { type: "string", description: "p/ click/fill/type/select: substring que deve aparecer no texto após settle" },
      expectGone: { type: "string", description: "p/ click/fill/type/select: selector que deve SUMIR após settle" },
      confirm: { type: "string", description: "Frase do dono p/ alto risco" },
    },
    required: ["action"],
  },
  run: async (a) => {
    const t0 = Date.now();
    if (!a.action) return devOut({ status: "error", summary: `action ausente — ações válidas: goto|back|forward|reload|click|fill|type|select|press|scroll|highlight|waittext|wait|evaluate|cursor|tooltip|catchup|aesthetic|new|scan|count|attr|html|flow | exemplo: {action:"goto", tab:"trecho", url:"https://..."}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    // #48: ref do snapshot resolve p/ selector (cache por aba); selector explícito vence.
    if (a.ref !== undefined && a.ref !== null && String(a.ref) !== "" && !a.selector) {
      const res = ubSnapCacheResolve(ubSnapCacheKey({ tabId: a.tabId, tab: a.tab }), a.ref);
      if (!res.ok) return devOut({ status: "error", summary: `${res.error} | ${UB_FB}`, data: { action: a.action, ref: a.ref }, telemetry: { execution_time_ms: Date.now() - t0 } });
      a = { ...a, selector: res.selector };
    }
    const risk = ubRisk(a);
    if (risk === "high" && !(a.confirm && a.confirm.trim().length >= 4))
      return devOut({ status: "error", summary: `BLOQUEADO (alto risco: pagamento/senha/excluir/apagar). Só com pedido EXPLÍCITO + confirm="<frase do dono>". Ação: ${a.action} ${a.selector || a.url || ""}`, data: { action: a.action, risk }, telemetry: { execution_time_ms: Date.now() - t0 } });
    if (a.action === "wait") { await new Promise((r) => setTimeout(r, Math.min(Number(a.waitMs ?? a.ms) || 2000, 15000))); return devOut({ summary: "wait ok", data: { action: "wait" }, telemetry: { execution_time_ms: Date.now() - t0 } }); }
    const map = { goto: "tab.goto", back: "tab.back", forward: "tab.forward", reload: "tab.reload", click: "tab.click", fill: "tab.fill", type: "tab.type", select: "tab.select", press: "tab.press", scroll: "tab.scroll", highlight: "tab.highlight", waittext: "tab.waittext", evaluate: "tab.evaluate", cursor: "tab.cursor", tooltip: "tab.tooltip", catchup: "tab.catchup", aesthetic: "tab.aesthetic", new: "tab.new", scan: "tab.scan", count: "tab.count", attr: "tab.attr", html: "tab.html", flow: "tab.flow", console: "tab.console" };
    if (!map[a.action]) return devOut({ status: "error", summary: `action "${a.action}" desconhecida — use tooltip p/ hover-to-reveal | ${UB_FB}`, data: { action: a.action }, telemetry: { execution_time_ms: Date.now() - t0 } });
    // tooltip exige alvo (selector vence; senão x+y) — falha local, sem ida-volta.
    if (a.action === "tooltip" && !a.selector && (a.x === undefined || a.y === undefined))
      return devOut({ status: "error", summary: `tooltip exige selector OU x+y — exemplo: {action:"tooltip", selector:"button[aria-label]"} ou {action:"tooltip", x:120, y:300} | ${UB_FB}`, data: { action: a.action }, telemetry: { execution_time_ms: Date.now() - t0 } });
    // console zera os alertas push ANTES da ida-volta: vale mesmo se a extensão falhar
    // (o hint já cumpriu o papel de levar o agente até aqui).
    if (a.action === "console") ubAlertsRead();
    let r = await ubSend(map[a.action], { ...a });
    // #43a: evaluate null intermitente (race com JS da página) — 1 retry após 800ms antes de declarar null.
    if (a.action === "evaluate" && r && r.ok && (r.data?.value ?? null) === null && !r.data?.error) {
      await new Promise((res) => setTimeout(res, 800));
      const r2 = await ubSend(map[a.action], { ...a });
      if (r2 && (r2.ok || r2.__timeout || r2.__offline)) r = r2;
    }
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
      if (!a.selector && value === null) return devOut({ status: "warn", summary: `evaluate retornou null${d.note ? ` — ${String(d.note).slice(0, 160)}` : " — termine JS com valor + confira n_ubrowser_snapshot/read"} | ${UB_FB}`, data: { action: a.action, risk, value: null, cspBlocked: false, selectorFound: selFound, note: d.note || undefined }, telemetry: { execution_time_ms: Date.now() - t0 } });
      return devOut({ summary: "[evaluate] ok", data: { action: a.action, risk, value, cspBlocked: false, selectorFound: selFound }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "n_ubrowser_shot", reason: "Confirmar visualmente" }] });
    }
    if (a.action === "console") {
      // #47: console+erros+rede da aba (hook MAIN; só vê o que aconteceu após a 1ª injeção).
      if (d.hooked === false) return devOut({ status: "warn", summary: `${d.note || "hook de console ainda não ativo nesta página"} | ${UB_FB}`, data: { action: "console", hooked: false }, telemetry: { execution_time_ms: Date.now() - t0 } });
      const entries = Array.isArray(d.entries) ? d.entries : [];
      const lines = entries.map((e) => {
        e = e && typeof e === "object" ? e : {};
        if (e.kind === "net") return `[net ${e.method || "?"} ${e.status ?? "?"} ${e.ms ?? "?"}ms] ${e.url || ""}${e.error ? ` ERRO: ${e.error}` : ""}${e.body ? ` :: ${String(e.body).slice(0, 200)}` : ""}`;
        if (e.kind === "js-error") return `[js-error] ${e.text || ""}${e.src ? ` @ ${e.src}:${e.line || 0}` : ""}`;
        if (e.kind === "promise") return `[unhandled] ${e.text || ""}`;
        return `[${e.level || e.kind || "?"}] ${e.text || ""}`;
      });
      const body = lines.join("\n").slice(0, 6000);
      return devOut({ summary: `[console ${d.filter || "all"}] ${entries.length} entrada(s)${d.total > entries.length ? ` (de ${d.total})` : ""}`, data: { action: "console", hooked: true, filter: d.filter, count: entries.length, text: body, entries: entries.slice(0, 30) }, telemetry: { execution_time_ms: Date.now() - t0 } });
    }
    if (a.action === "tooltip") {
      // hover-to-reveal (só-leitura, sem clique): tooltip string ou null.
      const tip = (d && typeof d.tooltip === "string" && d.tooltip) ? d.tooltip : null;
      const where = a.selector || ((a.x !== undefined && a.y !== undefined) ? `${a.x},${a.y}` : "?");
      if (tip) return devOut({ summary: `[tooltip] "${String(tip).slice(0, 120)}" em ${where} (via ${d.source || "?"})`, data: { action: "tooltip", risk, tooltip: tip, source: d.source || "", x: d.x, y: d.y }, telemetry: { execution_time_ms: Date.now() - t0 } });
      return devOut({ summary: `[tooltip] sem tooltip em ${where} — sem hover-text nem title/aria (nada para ler)`, data: { action: "tooltip", risk, tooltip: null, x: d.x, y: d.y }, telemetry: { execution_time_ms: Date.now() - t0 } });
    }
    if (a.action === "catchup") {
      // pesca de transientes: apareceu/sumiu + texto (sem snapshot — toast morre antes).
      const ap = Array.isArray(d.appeared) ? d.appeared : [];
      const dis = Array.isArray(d.disappeared) ? d.disappeared : [];
      const fmt = (n) => `"${String((n && n.text) || "").slice(0, 100)}"`;
      if (!ap.length && !dis.length) return devOut({ summary: `[catchup] nada transitório em ${d.durationMs ?? "?"}ms (${d.samples ?? 0} amostra(s)) — sem toast/alerta nesse intervalo`, data: { action: "catchup", risk, appeared: [], disappeared: [], samples: d.samples ?? 0 }, telemetry: { execution_time_ms: Date.now() - t0 } });
      return devOut({ summary: `[catchup] +${ap.length} apareceu(ram)${ap.length ? ": " + ap.map(fmt).join(" | ").slice(0, 200) : ""} | -${dis.length} sumiu(ram)${dis.length ? ": " + dis.map(fmt).join(" | ").slice(0, 200) : ""}`, data: { action: "catchup", risk, appeared: ap, disappeared: dis, samples: d.samples ?? 0 }, telemetry: { execution_time_ms: Date.now() - t0 } });
    }
    if (a.action === "aesthetic") {
      // veredito visual bounded: score 0-100 + issues (kind/where/detail, teto 12).
      const score = (d && typeof d.score === "number") ? d.score : null;
      const issues = Array.isArray(d?.issues) ? d.issues : [];
      const stats = (d && typeof d.stats === "object" && d.stats) ? d.stats : {};
      if (score === null) return devOut({ status: "warn", summary: `[aesthetic] sem score — página sem elementos visíveis? | ${UB_FB}`, data: { action: "aesthetic", risk, score: null, issues: [], stats }, telemetry: { execution_time_ms: Date.now() - t0 } });
      const kinds = {};
      for (const it of issues) { try { const k = String(it?.kind || "?"); kinds[k] = (kinds[k] || 0) + 1; } catch {} }
      const kindNote = Object.entries(kinds).map(([k, n]) => `${k}×${n}`).join(", ");
      const top = issues.slice(0, 6).map((it) => `${it.kind}@${it.where}: ${it.detail}`).join(" | ").slice(0, 400);
      return devOut({ summary: `[aesthetic] score ${score}/100 — ${issues.length} issue(s)${kindNote ? ` (${kindNote})` : " (limpo)"}${top ? `: ${top}` : ""}`, data: { action: "aesthetic", risk, score, issues, stats }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "n_ubrowser_shot", reason: "Confirmar visualmente" }] });
    }
    const afterUrl = d.url ?? a.url ?? null;
    const afterTitle = d.title ?? null;
    const beforeUrl = (a.action === "goto" || a.action === "new") && a.url ? String(a.url) : null;
    const urlChanged = !!beforeUrl && !!afterUrl && beforeUrl !== afterUrl;
    const navNewDoc = ["goto", "back", "forward", "new"].includes(a.action);
    const titleChanged = !!afterTitle && (urlChanged || navNewDoc);
    const afterLabel = String(afterTitle ? `${afterTitle} — ${afterUrl || ""}` : (afterUrl || d.selector || d.value || d.text || "ok")).slice(0, 120);
    const diff = urlChanged ? `navegou ${beforeUrl}→${afterUrl}` : (navNewDoc && afterUrl ? `navegou para ${afterLabel}` : `mesma página: ${afterLabel}`);
    // delta pós-ação: o que mudou no DOM (sem re-snapshot). Vazio = sem efeito visível.
    // transients (toast/aviso efêmero) em destaque: o agente vê o aviso sem call extra.
    let deltaNote = "";
    try {
      const dl = d.delta;
      if (dl && typeof dl === "object" && (dl.total > 0 || (Array.isArray(dl.added) && dl.added.length))) {
        const parts = [];
        if (Array.isArray(dl.transients) && dl.transients.length) parts.push(`🔔 aviso: ${dl.transients.slice(0, 3).join(" | ").slice(0, 240)}`);
        if (dl.added && dl.added.length) parts.push(`+${dl.added.length} ${dl.added.slice(0, 3).join(" | ").slice(0, 160)}`);
        if (dl.removed) parts.push(`~${dl.removed} removido(s)`);
        if (dl.txts) parts.push(`${dl.txts} texto(s)`);
        if (dl.attrs) parts.push(`${dl.attrs} attr(s)`);
        if (parts.length) deltaNote = ` | mudou: ${parts.join(", ")}`;
      } else if (dl && typeof dl === "object") {
        deltaNote = " | sem mudança no DOM";
      }
    } catch {}
    // Verificação de clique (content+background): verified/whatChanged/method — o LLM
    // confia sem re-snapshot quando verified:true; quando false, NÃO confia e tenta outro alvo.
    let clickNote = "";
    let verifyFields = {};
    try {
      if ((a.action === "click" || a.action === "cursor") && d && typeof d === "object" && typeof d.verified === "boolean") {
        const wc = Array.isArray(d.whatChanged) ? d.whatChanged : [];
        const meth = d.method || d.via || "?";
        verifyFields = { verified: d.verified, whatChanged: wc, ...(d.method || d.via ? { method: d.method || d.via } : {}), ...(Array.isArray(d.escalations) ? { escalations: d.escalations } : {}) };
        if (d.verified) clickNote = ` | click verified (${wc.join(",") || "?"} via ${meth})`;
        else {
          const esc = Array.isArray(d.escalations) && d.escalations.length ? ` após ${d.escalations.join("→")}` : "";
          clickNote = ` | click UNVERIFIED${esc} — NÃO confie: re-snapshot e tente outro selector/ponto`;
        }
        if (d.childHit) clickNote += ` | aviso: ponto cai em filho (${String(d.childHit).slice(0, 80)} — ex: avatar abre perfil, não o chat)`;
        if (d.trustedFallback) clickNote += ` | trusted falhou (${String(d.trustedFallback).slice(0, 80)}) → sintético`;
        if (d.trustedError) clickNote += ` | trusted errou (${String(d.trustedError).slice(0, 80)})`;
        if (d.resolve) clickNote += ` | resolve=${String(d.resolve).slice(0, 20)} (nó moveu/reciclou — re-snapshot se for agir de novo)`;
      }
    } catch {}
    // expects pós-ação (click/fill/type/select): PASS/FAIL 1 checagem cada, pós-settle.
    // pass = confie sem re-ler; fail = NÃO confie (re-snapshot e ajuste o alvo).
    let expectNote = "";
    let expectFields = {};
    try {
      const ex = d && d.expect;
      if ((a.action === "click" || a.action === "fill" || a.action === "type" || a.action === "select" || a.action === "cursor") && ex && typeof ex === "object") {
        const cks = Array.isArray(ex.checks) ? ex.checks : [];
        expectFields = { expect: ex };
        if (cks.length) {
          if (ex.passed) expectNote = ` | expect PASS (${cks.map((c) => c.name).join(",")})`;
          else {
            const fails = cks.filter((c) => !c.ok).map((c) => c.name + (c.detail ? `: ${String(c.detail).slice(0, 100)}` : "")).join("; ");
            expectNote = ` | expect FAIL — ${fails} — NÃO confie: re-snapshot e ajuste`;
          }
        }
      }
    } catch {}
    // snap:true pós-navegação: top-10 rankeado junto (refs frescas sem call extra).
    let snapNote = "", snapTop = null;
    if (navNewDoc && a.snap && afterUrl) {
      try {
        const sr = await ubSend("tab.snapshot", { tabId: a.tabId, tab: a.tab, max: 40 });
        const sels = Array.isArray(sr?.data) ? sr.data : (Array.isArray(sr?.data?.items) ? sr.data.items : []);
        if (sr?.ok && sels.length) {
          const ranked = ubSnapRank(sels).slice(0, 10);
          snapTop = ranked.map((el) => `[${el.ref ?? "?"}] ${el.role || el.tag} "${String(el.text || el.name || "").slice(0, 60)}"`);
          snapNote = ` | snap: ${sels.length} interativos (top 10 abaixo)`;
        }
      } catch {}
    }
    return devOut({ summary: `[${a.action} risk=${risk}] ok — ${diff}${deltaNote}${snapNote}${clickNote}${expectNote}${ubAlertsHint()}`, data: { action: a.action, risk, ok: true, title: d.title, url: d.url, result: trimOut(d.text ?? d.value ?? "", 500), delta: d.delta || undefined, ...verifyFields, ...expectFields, ...(snapTop ? { snapshotTop: snapTop } : {}), after: { url: afterUrl, title: afterTitle }, changed: { url: urlChanged, title: titleChanged } }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "n_ubrowser_shot", reason: "Confirmar visualmente" }] });
  },
});

reg("n_ubrowser_shot", {
  description: "Print da aba VISÍVEL do dono (imagem + arquivo). Aba em fundo NÃO imprime — use n_browser_screenshot headless. Nunca troca de aba. scale:0.5 = metade dos bytes. Confirme visualmente após click/fill importantes.",
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

