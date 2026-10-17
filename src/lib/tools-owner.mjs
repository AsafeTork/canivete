// canivete — tools do navegador LOGADO do dono (ubrowser_*)
import { reg, devOut, trimOut } from "./ctx.mjs";
import { ubEnsure, ubSend, ubConnected, UB_OFF, ubRisk, UB_PORT, ubStats, ubAlertsPending, ubAlertsRead, ubAlertsHint, ubResolveProfile, ubListExtensions, UB_TIMEOUT_MS } from "./ubridge.mjs";
import { snapLabel as ubSnapLabel, snapRole as ubSnapRole, snapHasBox as ubSnapHasBox, snapInViewport as ubSnapInViewport, snapIsEditable as ubSnapIsEditable, snapBytes as ubSnapBytes, snapFoldKey as ubSnapFoldKey, snapFold as ubSnapFold, snapDedupLinks as ubSnapDedupLinks } from "../core/snapshot.mjs";
// recovery sem mudar protocolo: só texto de erro acionável (janela NORMAL, popup, token) + fallback headless
const UB_REC = "Recovery dono: 1) Chrome janela NORMAL mesmo perfil (sem anonimo) 2) popup extensao UBrowser ATIVO 3) token ~/.config/canivete/token.txt igual na extensao 4) rode n_ubrowser_status p/ confirmar";
const UB_FB = "Sem login? fallback headless: n_browser_navigate / n_browser_screenshot";
const UB_OFF_FULL = `${UB_OFF} | ${UB_REC} | ${UB_FB}`;
// timeout de transporte ÚNICO (const UB_TIMEOUT_MS do ubridge): mensagem mostra o valor REAL
// (env CANIVETE_UB_TIMEOUT, piso 1s teto 300s) — antes dizia "60s" fixo mesmo com env mudado.
const ubTimeoutMsg = (ms = UB_TIMEOUT_MS) => `timeout ${Math.round(ms / 1000)}s — extensao nao respondeu: tente de novo ou cheque n_ubrowser_status`;

// Roteamento por perfil: SE o caller pediu `profile` e ele não casa com nenhuma extensão,
// NÃO roteia em silêncio p/ "qualquer" (comando no perfil ERRADO é pior que erro) —
// devolve erro acionável listando os conectados (clientId/label/idade do último poll).
// Sem profile = comportamento de sempre (broadcast p/ o mais recente).
function ubTarget(profile) {
  if (!profile) return { ok: true, id: null };
  const id = ubResolveProfile(profile);
  if (id) return { ok: true, id };
  const exts = ubListExtensions();
  if (!exts.length) return { ok: false, summary: `profile "${String(profile).slice(0, 60)}" não conectado — NENHUMA extensão conectada | ${UB_OFF_FULL}` };
  const list = exts.map((e) => `${e.id}${e.profileLabel ? ` (${e.profileLabel})` : ""} — último poll há ${Math.round(Math.max(0, e.lastPollAgoMs) / 1000)}s${e.connected ? "" : " (DESCONECTADO)"}`).join("; ");
  return { ok: false, summary: `profile "${String(profile).slice(0, 60)}" não corresponde a NENHUMA extensão — conectados: ${list} | use clientId exato (n_ubrowser_status → extensions[].id), trecho de URL/label, ou omita profile p/ o mais recente | ${UB_FB}` };
}

reg("n_ubrowser_status", {
  description: "Status da ponte com o Chrome LOGADO do dono (extensão local). SEMPRE o passo 1: offline → janela NORMAL (anônima é invisível), mesmo perfil, popup ATIVO, token igual. Fluxo: status→tabs→read|snapshot→act→shot. IDs de aba mudam — nas tools prefira tab:\"trecho do título/URL\".",
  inputSchema: { type: "object", properties: {}, required: [] },
  run: async () => {
    const t0 = Date.now();
    ubEnsure();
    const c = ubConnected();
    const st = ubStats();
    const exts = Array.isArray(st.extensions) ? st.extensions : [];
    const conns = exts.filter((e) => e.connected);
    const newest = conns.slice().sort((a, b) => (a.lastPollAgoMs || 0) - (b.lastPollAgoMs || 0))[0] || null;
    const version = newest?.info?.bg ? String(newest.info.bg) : undefined;
    const noLabel = conns.length > 0 && conns.every((e) => !e.profileLabel);
    const oldVer = conns.map((e) => (e.info?.bg ? String(e.info.bg) : "")).find((v) => v && ubVerLt(v, UB_VER_ACT));
    // dicas de roteamento: cada uma existe p/ evitar erro depois (profile errado, activate antigo)
    const hints = [];
    if (oldVer) hints.push(`extensão rodando ${oldVer} (< ${UB_VER_ACT}) — tab.activate indisponível: {action:"reload-extension"} aplica o código novo, depois re-status (data.version)`);
    if (conns.length > 1) hints.push(`${conns.length} perfis conectados — alvo por profile:"<clientId>" (extensions[].id), trecho de label/URL; omitir = ext mais recente`);
    if (conns.length === 1) hints.push("1 perfil só — omita profile (ou passe o clientId exato)");
    if (noLabel) hints.push("profileLabel ausente — configure o nome do perfil no popup da extensão p/ alvo por nome legível");
    return devOut({ status: c ? "success" : "error", summary: c ? `UBrowser pronto — ${conns.length} perfil(es) conectado(s)` : "EXTENSÃO OFFLINE — dono: abra o Chrome (janela NORMAL, mesmo perfil, popup ATIVO)", data: { connected: c, ...(version ? { version } : {}), ...(hints.length ? { hint: hints.join(" | ") } : {}), ...st }, telemetry: { execution_time_ms: Date.now() - t0 }, next: !c ? [{ tool: "n_ubrowser_status", reason: "Re-checar após abrir o Chrome (popup ativo)" }] : [{ tool: "n_ubrowser_tabs", reason: conns.length > 1 ? "Abas vêm consolidadas dos perfis — aponte profile ao agir" : "Listar abas do dono" }] });
  },
});

reg("n_ubrowser_tabs", {
  description: "Abas do Chrome do dono (id, janela, ativa?, anônima?, título, url; cada aba traz profile/label — sempre). Diagnostica janela/perfil errado. Nas demais tools passe tab:\"trecho\" (resolve sozinho, http(s) primeiro, chrome:// por último) — tabId numérico só se o trecho ambíguo. profile=<clientId> roteia p/ um perfil específico; OMITIDO com vários perfis conectados = consolida TODAS as extensões (tab traz profile/label).",
  inputSchema: { type: "object", properties: { filter: { type: "string", description: "opcional: substring em título+url (case-insensitive)" }, max: { type: "number", default: 50, description: "máx abas (default 50, teto 200)" }, profile: { type: "string", description: "clientId de um perfil conectado (multi-perfil) — omitir = 1 perfil: mais recente; 2+: consolida todos" } }, required: [] },
  run: async ({ filter, max, profile } = {}) => {
    const t0 = Date.now();
    const tgt = ubTarget(profile);
    if (!tgt.ok) return devOut({ status: "error", summary: tgt.summary, data: { profile: String(profile) }, telemetry: { execution_time_ms: Date.now() - t0 } });
    const args = { ...(filter ? { filter } : {}), ...(max ? { max } : {}) };
    const res = await ubTabsFetch(args, tgt, UB_TIMEOUT_MS);
    const isBad = (r) => r && (r.__offline || r.__timeout);
    if (res.multi) {
      const goods = [], bads = [];
      res.all.forEach((r, i) => (isBad(r) ? bads.push({ e: res.exts[i], r }) : goods.push({ e: res.exts[i], r })));
      if (!goods.length) return devOut({ status: "error", summary: res.all[0].__offline ? UB_OFF_FULL : `${ubTimeoutMsg()} | ${UB_FB}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
      const tabs = [];
      const profiles = goods.map(({ e, r }) => {
        const d = r.data || {};
        const ta = Array.isArray(d.tabs) ? d.tabs : Array.isArray(d) ? d : [];
        const ws = Array.isArray(d.windows) ? d.windows : [];
        for (const t of ta) tabs.push(ubTabsSlim(t, ubProfTag(e)));
        return { id: e.id, ...(e.profileLabel ? { label: e.profileLabel } : {}), windows: ws.length, tabs: ta.length };
      });
      for (const b of bads) profiles.push({ id: b.e.id, ...(b.e.profileLabel ? { label: b.e.profileLabel } : {}), error: b.r.__offline ? "offline" : "timeout" });
      const f = ubTabsFilterMax(tabs, filter, max);
      const omitNote = f.omitted ? ` (...[+${f.omitted} omitidos — refine filter])` : "";
      const badNote = bads.length ? ` (${bads.length} perfil sem resposta: ${bads.map((b) => b.e.profileLabel || b.e.id).join(", ")})` : "";
      const firstProf = f.tabs.find((t) => t.profile)?.profile || profiles[0]?.id || "";
      return devOut({ summary: `${f.tabs.length} aba(s) em ${profiles.length} perfil(is)${omitNote}${badNote}`, data: { tabs: f.tabs, profiles, ...(f.omitted ? { omitted: f.omitted } : {}) }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "n_ubrowser_read", reason: profiles.length > 1 && !bads.length ? `Escolha a aba e use profile:"${firstProf}" no read/snapshot/act` : "Ler aba ativa" }] });
    }
    const r = res.single;
    if (r.__offline || r.__timeout) return devOut({ status: "error", summary: r.__offline ? UB_OFF_FULL : `${ubTimeoutMsg()} | ${UB_FB}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    if (!r.ok) return devOut({ status: "error", summary: `extensão: ${r.error} | ${UB_FB}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    const tabs = r.data.tabs || r.data || [];
    const wins = r.data.windows || [];
    const ext0 = res.exts[0] || null;
    const slim = (Array.isArray(tabs) ? tabs : []).map((t) => ubTabsSlim(t, ubProfTag(ext0)));
    const f = ubTabsFilterMax(slim, filter, max);
    const omitNote = f.omitted ? ` (...[+${f.omitted} omitidos — refine filter])` : "";
    return devOut({ summary: `${f.tabs.length} aba(s) em ${wins.length || "?"} janela(s)${omitNote}`, data: { tabs: f.tabs, profiles: ext0 ? [{ id: ext0.id, ...(ext0.profileLabel ? { label: ext0.profileLabel } : {}), windows: wins.length, tabs: (Array.isArray(tabs) ? tabs : []).length }] : [], ...(f.omitted ? { omitted: f.omitted } : {}) }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "n_ubrowser_read", reason: "Ler aba ativa" }] });
  },
});

reg("n_ubrowser_read", {
  description: "Lê aba do dono COM login (texto+links). Mire com tab:\"trecho\" ou tabId. mode=distill (default, enxuto) | raw (integral + links). outline=true: só estrutura (h1-h6 + contagens) p/ triagem. maxChars/maxLinks dão teto. AUTOMÁTICO: espera a página aquietar (SPA), perfura shadow DOM, inputs mostram value separado (`[campo text Nome] = \"João\"`). Pra JS use evaluate no act; pra erros/rede use act console. selector=\"CSS\" escopa a leitura a um container (#app, table, ...); texto curto em página grande ganha WARN no summary (tente mode:\"raw\" ou snapshot).",
  inputSchema: { type: "object", properties: { tabId: { type: "number" }, tab: { type: "string", description: "trecho do título/URL (resolve p/ tabId; IDs mudam)" }, maxChars: { type: "number", default: 2500 }, maxLinks: { type: "number", default: 15 }, mode: { type: "string", enum: ["distill", "raw"], default: "distill", description: "distill=destilado enxuto (default); raw=texto integral opt-out" }, outline: { type: "boolean", description: "outline=true: só estrutura (h1-h6 + contagens) p/ triagem rápida" }, selector: { type: "string", description: "CSS p/ escopar a leitura a um container (ex: \"#app\", \"table.turmas\") — erro \"seletor não encontrado\" se não achar" } }, required: [] },
  run: async ({ tabId, tab, mode, maxChars, maxLinks, outline, selector, profile }) => {
    const t0 = Date.now();
    const tgt = ubTarget(profile);
    if (!tgt.ok) return devOut({ status: "error", summary: tgt.summary, data: { profile: String(profile) }, telemetry: { execution_time_ms: Date.now() - t0 } });
    const r = await ubSend("tab.read", { tabId, tab, mode: mode || "distill", maxChars, maxLinks, ...(outline ? { outline: true } : {}), ...(selector ? { selector } : {}) }, UB_TIMEOUT_MS, tgt.id);
    if (r.__offline || r.__timeout) return devOut({ status: "error", summary: r.__offline ? UB_OFF_FULL : `${ubTimeoutMsg()} | ${UB_FB}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    if (!r.ok) return devOut({ status: "error", summary: `extensão: ${r.error}${ubErrHint(r.error) || ""} | ${UB_FB}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    const body = r.data.markdown || r.data.text || "";
    const allLinks = r.data.links || [];
    const links = allLinks.slice(0, 15);
    const omitted = allLinks.length > links.length ? allLinks.length - links.length : 0;
    const omitNote = omitted ? ` (+${omitted} links omitidos)` : "";
    const warnNote = r.data.warn ? ` | ${r.data.warn}` : "";
    const nxt = [];
    if (omitted > 0) nxt.push({ tool: "n_ubrowser_read", reason: "mode:\"raw\" traz o texto integral e links completos" });
    nxt.push({ tool: "n_ubrowser_snapshot", reason: "Mapear cliques" });
    return devOut({ summary: `${r.data.title} — ${r.data.url}${r.data.markdown ? ` (destilado ${r.data.stats ? r.data.stats.chars + " chars" : ""})` : ""}${omitNote}${warnNote}${ubAlertsHint()}`, data: { title: r.data.title, url: r.data.url, text: trimOut(body, 6000), links, linksOmitted: omitted, warn: r.data.warn || undefined, stats: r.data.stats }, telemetry: { execution_time_ms: Date.now() - t0 }, next: nxt });
  },
});

// UB_SNAP_PURE_START — lógica pura do n_ubrowser_snapshot (rank/junk/auto-compact-por-campos). Sem I/O: testável via node -e sem extensão.
// Rank: viewport → nome → papel (editáveis por último, como antes). Junk: sem nome descartado com `omitted`. Auto-compact: corta CAMPOS por nível, nunca elementos.
// Fold: runs ≥6 consecutivos com mesmo role+head viram 1 marcador com refs preservadas (mcprune-style).
// DedupLinks: mesmo (texto+href) mantém o primeiro.
const UB_SNAP_ROLE_SCORE = { button: 3, link: 3, textbox: 3, combobox: 3, checkbox: 3, radio: 3, switch: 3, slider: 3, searchbox: 3, spinbutton: 2, menuitem: 2, menuitemcheckbox: 2, menuitemradio: 2, tab: 2, option: 1, listitem: 1, row: 1, heading: 0, img: -2, generic: -2, "": -2 };
const UB_SNAP_KEEP_NAMELESS = new Set(["button", "link", "textbox", "combobox", "checkbox", "radio", "switch", "slider", "searchbox", "spinbutton", "menuitem", "menuitemcheckbox", "menuitemradio", "tab", "option"]);
const UB_SNAP_BYTE_BUDGET = 12000; // ~3k tokens: acima disso corta CAMPOS (nunca elementos — contagem intacta)
// Primitivos puros (label/role/box/viewport/editable/bytes/fold/dedup): ver core/snapshot.mjs — fonte única.
// Mantidos aqui: junk/score/rank/auto-compact (regras específicas do ubrowser: layer boost, editáveis por último).
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

// UB_OWNER_PURE_START — puros do tools-owner (tabs filter/max, retry do evaluate,
// undefined-vs-null, remontagem chunked, chave do shot). Sem I/O: testáveis via node.
function ubTabsFilterMax(tabs, filter, max) {
  try {
    const list = Array.isArray(tabs) ? tabs : [];
    const needle = String(filter || "").trim().toLowerCase();
    const cap = Math.min(Math.max(Number(max) || 50, 1), 200);
    const kept = needle
      ? list.filter((t) => { try { return (((t.title || "") + " " + (t.url || "")).toLowerCase().includes(needle)); } catch { return false; } })
      : list.slice();
    const omitted = Math.max(kept.length - cap, 0);
    return { tabs: kept.slice(0, cap), omitted };
  } catch { return { tabs: Array.isArray(tabs) ? tabs.slice(0, 50) : [], omitted: 0 }; }
}
// Retry do evaluate: vale a VERDADE MAIS NOVA — adota r2 seja ok ou erro;
// pendings (__timeout/__offline, sem resposta) mantêm o comportamento antigo.
function ubEvalPickRetry(r, r2) {
  try {
    if (r2 && (("ok" in r2) || r2.__timeout || r2.__offline)) return r2;
    return r;
  } catch { return r; }
}
// undefined-vs-null: "undefined" = rodou e retornou undefined; "null" = null ou
// falha de transporte; "value" = tem valor (inclui 0/false/"").
function ubEvalNullKind(d) {
  try {
    if (d && typeof d === "object" && d.undefined === true) return "undefined";
    const v = d ? d.value ?? null : null;
    if (v === null) return "null";
    return "value";
  } catch { return "null"; }
}
// Chunked (>500kB fatiado pelo bridge): remonta chunks.join("") → JSON → data;
// falha → erro acionável em vez de degradar p/ null-warn.
function ubReassembleChunks(r) {
  try {
    if (!r || !r.chunked || !Array.isArray(r.chunks)) return { ok: false, error: "not-chunked" };
    const full = r.chunks.join("");
    const parsed = JSON.parse(full);
    if (parsed && typeof parsed === "object" && ("data" in parsed)) return { ok: true, data: parsed.data };
    return { ok: true, data: parsed };
  } catch { return { ok: false, error: "resposta grande — refine com max/compact/offset" }; }
}
function ubShotCacheKey({ tabId, tab }, data) {
  try {
    if (data && data.tab && data.tab.id !== undefined && data.tab.id !== null) return `id:${data.tab.id}`;
    if (tabId !== undefined && tabId !== null && String(tabId) !== "") return `id:${tabId}`;
    if (tab) return `tab:${String(tab).toLowerCase()}`;
    return "active";
  } catch { return "active"; }
}
// UB_OWNER_PURE_END

// UB_OWNER_POWER_START — ganhos de PODER/usabilidade (verções, erros que instruem, tabs
// multi-perfil, timeout de ações pesadas, activate). Puros: testáveis via node sem extensão.
const UB_VER_ACT = "1.7.3"; // tab.activate exige extensão ≥ 1.7.3 (contrato c/ background)
function ubVerNum(v) {
  try {
    const m = String(v || "").match(/(\d+)\.(\d+)(?:\.(\d+))?/);
    if (!m) return null;
    return [Number(m[1]), Number(m[2]), Number(m[3] || 0)];
  } catch { return null; }
}
function ubVerLt(a, b) {
  const x = ubVerNum(a), y = ubVerNum(b);
  if (!x || !y) return false; // "?" / versão desconhecida: NUNCA bloqueia por versão
  return x[0] !== y[0] ? x[0] < y[0] : (x[1] !== y[1] ? x[1] < y[1] : x[2] < y[2]);
}
// Erro da extensão/ponte → instrução de recovery (cada caso é um erro REAL já visto no protocolo).
function ubErrHint(error) {
  const s = String(error || "");
  if (/seletor|SELECTOR/i.test(s)) return " — rode n_ubrowser_snapshot (ou find com trecho de texto) p/ ver seletores atuais";
  if (/não encontrada|nao encontrada|not found|NOTFOUND|nenhuma aba/i.test(s)) return " — mire de novo: n_ubrowser_tabs lista as abas/atuais (tabId ou trecho de título/URL)";
  if (/aba fechou/i.test(s)) return " — a aba morreu: reliste com n_ubrowser_tabs e re-mire";
  if (/sem histórico/i.test(s)) return " — back/forward precisam de historico do Chrome: navegue (goto) antes";
  if (/CSP|eval/i.test(s)) return " — evaluate opcional: n_ubrowser_read/snapshot dao o mesmo dado sem JS";
  if (/401|403|token/i.test(s)) return " — token divergente: confira o campo token no popup da extensão";
  return null;
}
// scan/flow varrem N passos/páginas: transporte com env baixo (ex: 10s) mata a varredura no meio —
// pesadas ganham piso de 90s (teto próprio 165s = guard do host #50; nada acima disso volta sync vivo). Default global intacto.
const UB_HEAVY_ACTIONS = new Set(["scan", "flow"]);
const ubHeavyMs = () => Math.min(Math.max(UB_TIMEOUT_MS, 90000), 165000);
// Param obrigatório por ação (espelha o que a extensão joga como throw) + exemplo pronto p/ colar.
const UB_REQ = {
  goto: ["url", '{action:"goto", tab:"trecho", url:"https://…"}'],
  evaluate: ["js", '{action:"evaluate", tab:"trecho", js:"location.href"}'],
  flow: ["steps", '{action:"flow", tab:"trecho", steps:[{cmd:"tab.read"},{cmd:"tab.click", selector:"a"}]}'],
  count: ["selector", '{action:"count", selector:".item"}'],
  attr: ["selector+name", '{action:"attr", selector:"a", name:"href"}'],
};
function ubReqMiss(action, a) {
  try {
    const spec = UB_REQ[action];
    if (!spec) return null;
    const keys = spec[0] === "selector+name" ? ["selector", "name"] : [spec[0]];
    const missing = keys.filter((k) => {
      const v = a[k];
      if (k === "steps") return !Array.isArray(v) || !v.length;
      return v === undefined || v === null || (typeof v === "string" && !v.trim());
    });
    return missing.length ? { keys: spec[0], example: spec[1] } : null;
  } catch { return null; }
}
// shape da aba p/ o agente: título 70 chars, flags true-only (bytes), profile quando vem de fan-out
function ubTabsSlim(t, prof) {
  try {
    const p = prof || {};
    return {
      id: t.id, window: t.windowId ?? t.window ?? t.win,
      ...(t.active ? { active: true } : {}),
      ...(t.incognito ? { incognito: true } : {}),
      title: String(t.title || "").slice(0, 70), url: t.url,
      ...(p.id ? { profile: p.id } : {}), ...(p.label ? { label: p.label } : {}),
    };
  } catch { return { id: t && t.id, title: "", url: "" }; }
}
const ubProfTag = (e) => {
  const x = e || {};
  return { ...(x.id ? { id: x.id } : {}), ...(x.profileLabel ? { label: x.profileLabel } : {}) };
};
// tabs multi-perfil: SEM profile e 2+ conectadas = consolida TODAS (Promise.all, params iguais).
// 1 conectada (ou profile pedido) = 1 ida-volta — protocolo antigo intocado.
async function ubTabsFetch(args, tgt, timeoutMs) {
  const exts = tgt.id
    ? ubListExtensions().filter((e) => e.id === tgt.id)
    : ubListExtensions().filter((e) => e.connected);
  if (exts.length <= 1) {
    return { multi: false, single: await ubSend("tabs.list", args, timeoutMs, tgt.id), exts };
  }
  const all = await Promise.all(exts.map((e) => ubSend("tabs.list", args, timeoutMs, e.id)));
  return { multi: true, all, exts };
}
// UB_OWNER_POWER_END
const UB_SHOT_LAST = new Map(); // hash do último shot por aba (frescor v14)

reg("n_ubrowser_snapshot", {
  description: "Clicáveis da aba → aja com SELECTOR ou ref (refs válidas até a próxima navegação — SEMPRE re-snapshot após goto/click que navega). find=\"texto\": localiza com ±3 contexto sem despejar tudo. layer=\"modal|menu|popover|tooltip\": foca SÓ na camada (modal de 2 botões sem ler a página); sem filtro e com overlay aberto, a camada vai primeiro sozinha. Listas grandes dobram sozinhas (marcador … +N similares com refs). Links repetidos caem no dedup. shadow: na frente do selector = dentro de web component (clicável). imgs com alt/src entram. compact=true economiza ~60% tokens (mantém layer). max (50-120) + offset pagina. Lista virtualizada (WhatsApp): act scan antes. Rank: viewport→nome→papel.",
  inputSchema: { type: "object", properties: { tabId: { type: "number" }, tab: { type: "string", description: "trecho do título/URL (resolve p/ tabId; IDs mudam)" }, max: { type: "number", default: 50, description: "máximo de elementos por página (default 50, máx 120)" }, offset: { type: "number", default: 0, description: "pula N primeiros (paginação)" }, compact: { type: "boolean", default: false, description: "compact=true: só ref|tag|texto|role sem x/y/w/h (~60% menos tokens, paridade com headless)" }, find: { type: "string", description: "busca texto no snapshot e devolve matches ±3 contexto (sem despejar tudo)" }, layer: { type: "string", enum: ["modal", "menu", "popover", "tooltip"], description: "foco SÓ na camada (ex: modal de 2 botões sem ler a página inteira)" } }, required: [] },
  run: async ({ tabId, tab, max, offset, compact, find, layer, profile }) => {
    const t0 = Date.now();
    const cappedMax = Math.min(Number(max) || 50, 120);
    const needle = String(find || "").trim().toLowerCase();
    const tgt = ubTarget(profile);
    if (!tgt.ok) return devOut({ status: "error", summary: tgt.summary, data: { profile: String(profile) }, telemetry: { execution_time_ms: Date.now() - t0 } });
    const r = await ubSend("tab.snapshot", { tabId, tab, max: cappedMax, offset, ...(needle ? { match: needle } : {}) }, UB_TIMEOUT_MS, tgt.id);
    if (r.__offline || r.__timeout) return devOut({ status: "error", summary: r.__offline ? UB_OFF_FULL : `${ubTimeoutMsg()} | ${UB_FB}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
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
      return devOut({ summary: `${compactOut.length} elemento(s) (compact)${omitNote}${foldedNote}${dupeNote}${overlayNote}${focusNote}${ubAlertsHint()}`, data: { elements: compactOut, compact: true, omitted: junk, ...overlayData }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "n_ubrowser_act", reason: "Agir com ref:N ou selector" }] });
    }
    const ac = ubSnapAutoCompactFields(dd.elements);
    const autoNote = ac.autoCompact ? ` (auto-compact campos: -${ac.dropped.join(",")})` : "";
    return devOut({ summary: `${ac.elements.length} elemento(s)${ac.autoCompact ? " (compact-campos)" : ""}${omitNote}${foldedNote}${dupeNote}${autoNote}${overlayNote}${focusNote}${ubAlertsHint()}`, data: { elements: ac.elements, compact: ac.autoCompact, compactFields: ac.dropped, omitted: junk, bytes: ac.bytes, ...overlayData }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "n_ubrowser_act", reason: "Agir com ref:N ou selector" }] });
  },
});

reg("n_ubrowser_act", {
  description: "AUTOMAÇÃO no Chrome LOGADO do dono (só quando ele pedir; NUNCA destrutivo sem pedido; alto risco exige confirm; FECHAR ABAS DO DONO PROIBIDO). Mire por selector CSS, ref do snapshot OU text=\"trecho\" (qualquer elemento visível). activate troca a aba à frente NO Chrome — foco de SO intocado por padrão; focused=true (roubar foco de SO p/ device-flow) exige confirm=\"<frase>\". EFICIÊNCIA (aja direto, sem enrolar): goto/new/back/forward/reload com snap:true já voltam top-10 (1 call a menos); click/fill/type/select/press retornam delta (o que mudou — sem re-snapshot p/ confirmar); flow = N cmds em 1 ida-volta; find no snapshot em vez de paginar. Funciona em aba de fundo (tabId). fill SUBSTITUI (Monaco/CodeMirror via API); type ANEXA. wait=waitMs reais (teto 15s). evaluate no MAIN (retry em null; CSP bloqueia → read/snapshot). console {filter:all|errors|net|console} lê erros+rede da aba (erros CHEGAM SOZINHOS via push + 📬 nas respostas). click/fill/type/select/press mostram 🔔 aviso efêmero no delta. scan {pages} p/ virtualizada. click/cursor retornam verified+whatChanged (verified:true = confie sem re-snapshot). tooltip {selector|x,y} revela tooltip via hover SEM clicar (só-leitura). snapshot marca layer=modal|menu|popover nos itens + overlay aberto no topo (aja dentro da camada). catchup {durationMs} pesca transientes (toasts/snackbars/aria-live, role=status|alert) que somem em segundos — volta apareceu/sumiu + texto, sem snapshot. Alvo que some entre snapshot e ação volta com WHERE (removed|hidden|scrolled-out|zero-box|recycled|never-found) em vez de NOTFOUND seco; scroll re-mede e re-resolve por texto/papel (até 3 tentativas, resolve=moved|recycled) em lista virtualizada. aesthetic julga layout (score 0-100 + issues até 12: contrast/tap-target/overflow-x/overlap/fonts) sem print — opinião visual direta. click/fill/type/select aceitam expectUrl/expectText/expectGone (assert pós-settle com PASS/FAIL no expect, sem re-ler a página). reload-extension recarrega a extensão remota (aplica código novo do disco; ponte reconecta sozinha). close fecha SÓ aba-fantasma do agente (about:blank) — aba do dono com http(s) ativo é RECUSADA sem confirm=\"<frase do dono>\"; {action:\"close\", mode:\"close_by_prefix\"} limpa TODAS as about:blank de uma vez. activate precisa extensão 1.7.3+ (n_ubrowser_status → data.version); antiga = erro com hint de reload-extension.",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["goto", "back", "forward", "reload", "reload-extension", "click", "fill", "type", "select", "press", "scroll", "highlight", "waittext", "wait", "evaluate", "cursor", "tooltip", "catchup", "aesthetic", "new", "scan", "count", "attr", "html", "flow", "console", "close", "activate"] },
      tabId: { type: "number" }, tab: { type: "string", description: "trecho do título/URL (resolve p/ tabId; IDs mudam)" }, url: { type: "string" }, selector: { type: "string" }, text: { type: "string" }, profile: { type: "string", description: "clientId de um perfil conectado (multi-perfil) — omitir = mais recente" },
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
      urlPrefix: { type: "string", description: "p/ close mode:\"close_by_prefix\": prefixo de URL (só about:blank — fechar abas do dono em massa é PROIBIDO)" },
      mode: { type: "string", description: "p/ close: \"close_by_prefix\" fecha TODAS as abas com urlPrefix (default about:blank)" },
      expectUrl: { type: "string", description: "p/ click/fill/type/select: substring que deve aparecer na URL após settle" },
      expectText: { type: "string", description: "p/ click/fill/type/select: substring que deve aparecer no texto após settle" },
      expectGone: { type: "string", description: "p/ click/fill/type/select: selector que deve SUMIR após settle" },
      focused: { type: "boolean", description: "p/ activate: true dá TAMBÉM foco de SO à janela (roubo de foco — só com confirm=\"frase\"); default/omitido = só a aba à frente NO Chrome" },
      confirm: { type: "string", description: "Frase do dono p/ alto risco e p/ activate focused:true" },
    },
    required: ["action"],
  },
  run: async (a) => {
    const t0 = Date.now();
    if (!a.action) return devOut({ status: "error", summary: `action ausente — ações válidas: goto|back|forward|reload|reload-extension|click|fill|type|select|press|scroll|highlight|waittext|wait|evaluate|cursor|tooltip|catchup|aesthetic|new|scan|count|attr|html|flow|console|close|activate | exemplos: {action:"goto", tab:"trecho", url:"https://..."} / {action:"click", ref:3} / {action:"activate", tab:"Gmail"}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    // roteamento multi-perfil: profile pedido SEM match = erro acionável (lista conectados),
    // nunca despacha em silêncio p/ outro perfil. Um só resolve vale p/ ida e retry.
    const tgt = ubTarget(a.profile);
    if (!tgt.ok) return devOut({ status: "error", summary: tgt.summary, data: { action: a.action, profile: String(a.profile ?? "") }, telemetry: { execution_time_ms: Date.now() - t0 } });
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
    const map = { goto: "tab.goto", back: "tab.back", forward: "tab.forward", reload: "tab.reload", "reload-extension": "tab.reload-extension", click: "tab.click", fill: "tab.fill", type: "tab.type", select: "tab.select", press: "tab.press", scroll: "tab.scroll", highlight: "tab.highlight", waittext: "tab.waittext", evaluate: "tab.evaluate", cursor: "tab.cursor", tooltip: "tab.tooltip", catchup: "tab.catchup", aesthetic: "tab.aesthetic", new: "tab.new", scan: "tab.scan", count: "tab.count", attr: "tab.attr", html: "tab.html", flow: "tab.flow", console: "tab.console", close: "tab.close", activate: "tab.activate" };
    if (!map[a.action]) return devOut({ status: "error", summary: `action "${a.action}" desconhecida — ações válidas: goto|back|forward|reload|reload-extension|click|fill|type|select|press|scroll|highlight|waittext|wait|evaluate|cursor|tooltip|catchup|aesthetic|new|scan|count|attr|html|flow|console|close|activate | ${UB_FB}`, data: { action: a.action }, telemetry: { execution_time_ms: Date.now() - t0 } });
    // valida antes da ida-volta: param que a extensão joga como throw vira erro AQUI com exemplo pronto p/ colar.
    {
      const req = ubReqMiss(a.action, a);
      if (req) return devOut({ status: "error", summary: `${a.action} exige ${req.keys} — exemplo: ${req.example} | ${UB_FB}`, data: { action: a.action, missing: req.keys }, telemetry: { execution_time_ms: Date.now() - t0 } });
    }
    // activate (tab à frente): SEM focused = foco de SO nunca roubado; focused=true foge da doutrina
    // (device-flow precisa de janela afla p/ o botão final) e por isso exige confirm ≥4 chars.
    // Extensão < 1.7.3 = erro local com hint (sem ida-volta); versão desconhecida → despacha e trata no r.
    if (a.action === "activate") {
      const focused = a.focused === true;
      if (focused && !(a.confirm && String(a.confirm).trim().length >= 4))
        return devOut({ status: "error", summary: `activate com focused=true ROUBA o foco de SO do dono — exige confirm="<frase>" (exemplo: {action:"activate", tab:"Gmail", focused:true, confirm:"muda pro Gmail"}) | omita focused: só a aba à frente NO Chrome, foco intocado | ${UB_FB}`, data: { action: "activate", focused: true }, telemetry: { execution_time_ms: Date.now() - t0 } });
      const extAct = ubListExtensions().find((e) => e.id === tgt.id);
      const verAct = extAct?.info?.bg ? String(extAct.info.bg) : null;
      if (verAct && ubVerLt(verAct, UB_VER_ACT))
        return devOut({ status: "error", summary: `tab.activate requer extensão ${UB_VER_ACT}+ (rodando ${verAct}) — rode {action:"reload-extension"} e confirme versão com n_ubrowser_status (data.version) | ${UB_FB}`, data: { action: "activate", version: verAct, required: UB_VER_ACT }, telemetry: { execution_time_ms: Date.now() - t0 } });
    }
    // tooltip exige alvo (selector vence; senão x+y) — falha local, sem ida-volta.
    if (a.action === "tooltip" && !a.selector && (a.x === undefined || a.y === undefined))
      return devOut({ status: "error", summary: `tooltip exige selector OU x+y — exemplo: {action:"tooltip", selector:"button[aria-label]"} ou {action:"tooltip", x:120, y:300} | ${UB_FB}`, data: { action: a.action }, telemetry: { execution_time_ms: Date.now() - t0 } });
    // console zera os alertas push ANTES da ida-volta: vale mesmo se a extensão falhar
    // (o hint já cumpriu o papel de levar o agente até aqui).
    if (a.action === "console") ubAlertsRead();
    // timeout adaptativo: scan/flow varrem muitas páginas — env baixo não mata a varredura (piso 90s, teto 180s).
    const ubTo = UB_HEAVY_ACTIONS.has(a.action) ? ubHeavyMs() : UB_TIMEOUT_MS;
    let r = await ubSend(map[a.action], { ...a }, ubTo, tgt.id);
    // #43a: evaluate null intermitente (race com JS da página) — 1 retry após 800ms antes de declarar null.
    // v14: vale a verdade mais nova — adota r2 seja ok ou erro (só pendings mantêm o antigo).
    if (a.action === "evaluate" && r && r.ok && (r.data?.value ?? null) === null && !r.data?.error) {
      await new Promise((res) => setTimeout(res, 800));
      const r2 = await ubSend(map[a.action], { ...a }, UB_TIMEOUT_MS, tgt.id);
      r = ubEvalPickRetry(r, r2);
    }
    if (r.__offline || r.__timeout) return devOut({ status: "error", summary: r.__offline ? UB_OFF_FULL : `${ubTimeoutMsg(ubTo)} | ${UB_FB}`, data: { action: a.action }, telemetry: { execution_time_ms: Date.now() - t0 } });
    if (!r.ok) {
      // extensão antiga (<1.7.3) sem tab.activate: "cmd desconhecido"/"unknown action" → hint de versão/reload
      const unknownAct = a.action === "activate" && /desconhecido|unknown/i.test(String(r.error || ""));
      return devOut({ status: "error", summary: `extensão: ${r.error}${ubErrHint(r.error) || ""}${unknownAct ? ` — tab.activate precisa extensão ${UB_VER_ACT}+ (n_ubrowser_status → data.version); rode {action:"reload-extension"}` : ""} | ${UB_FB}`, data: { action: a.action, ...(unknownAct ? { versionHint: UB_VER_ACT } : {}) }, telemetry: { execution_time_ms: Date.now() - t0 } });
    }
    const d = r.data || {};
    if (a.action === "activate") {
      // aba à frente NO Chrome (contrato u Melhora): tolera d.tab{} (futuro), {tabId,title,url,focused} (bg 1.7.3) ou d plano.
      const tb = (d.tab && typeof d.tab === "object") ? d.tab : d;
      const focused = typeof d.focused === "boolean" ? d.focused : (a.focused === true);
      const where = (tb.title || tb.url) ? `${String(tb.title || "").slice(0, 60)} — ${String(tb.url || "").slice(0, 80)}` : ((tb.tabId ?? tb.id) !== undefined ? `tabId ${tb.tabId ?? tb.id}` : (a.tab ? `"${String(a.tab).slice(0, 40)}"` : "aba alvo"));
      const actNext = focused
        ? [{ tool: "n_ubrowser_snapshot", reason: "Aba afla — mapeie o fluxo (refs frescas)" }]
        : [{ tool: "n_ubrowser_read", reason: "Aba à frente NO Chrome (OS foco intocado) — leia o conteúdo" }, { tool: "n_ubrowser_snapshot", reason: "Mapear cliques da aba" }];
      return devOut({ summary: `[activate] ok — aba à frente NO Chrome: ${where}${focused ? " + foco de SO (confirm ok)" : " (foco de SO intocado — regra do dono)"}`, data: { action: "activate", risk, focused, tabId: tb.tabId ?? tb.id ?? d.id, ...(tb.title ? { title: String(tb.title).slice(0, 100) } : {}), ...(tb.url ? { url: String(tb.url).slice(0, 200) } : {}), ...(d.window ? { window: d.window } : {}) }, telemetry: { execution_time_ms: Date.now() - t0 }, next: actNext });
    }
    if (a.action === "reload-extension") {
      // auto-reload remoto da extensão (aplica código novo do disco).
      return devOut({ summary: `[reload-extension] ok — extensão recarregando, ponte reconecta sozinha em segundos (confira versões com n_ubrowser_status)`, data: { action: a.action, risk, reloading: true, bg: d.bg || undefined }, telemetry: { execution_time_ms: Date.now() - t0 } });
    }
    if (a.action === "evaluate") {
      // v14 chunked (>500kB): remonta em vez de degradar p/ null-warn.
      if (r.chunked && Array.isArray(r.chunks)) {
        const re = ubReassembleChunks(r);
        if (!re.ok) return devOut({ status: "error", summary: `${re.error} (${r.bytes || "?"} bytes) | ${UB_FB}`, data: { action: a.action, risk, value: null, chunked: true }, telemetry: { execution_time_ms: Date.now() - t0 } });
        return devOut({ summary: "[evaluate] ok (chunked)", data: { action: a.action, risk, value: (re.data && typeof re.data === "object" && ("value" in re.data)) ? re.data.value : re.data, cspBlocked: false, chunked: true }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "n_ubrowser_shot", reason: "Confirmar visualmente" }] });
      }
      const value = d.value ?? null;
      const errStr = String(d.error ?? d.message ?? d.details ?? "");
      const cspBlocked = /CSP|Content-Security|blocked|eval/i.test(errStr);
      const pageLoaded = d.pageLoaded ?? true;
      const selFound = a.selector ? (value !== null && value !== undefined && value !== "") : undefined;
      if (!pageLoaded) return devOut({ status: "error", summary: `página não carregou — recovery: reload via n_ubrowser_act + waittext e tente de novo | ${UB_FB}`, data: { action: a.action, risk, value: null, cspBlocked: false, selectorFound: false, pageLoaded: false }, telemetry: { execution_time_ms: Date.now() - t0 } });
      if (cspBlocked) return devOut({ status: "error", summary: `CSP bloqueou avaliação JS — use n_ubrowser_read / n_ubrowser_snapshot em vez de evaluate | ${UB_FB}`, data: { action: a.action, risk, value: null, cspBlocked: true, selectorFound: selFound, error: d.error }, telemetry: { execution_time_ms: Date.now() - t0 } });
      if (a.selector && !selFound) return devOut({ status: "error", summary: `seletor não achou elemento — recovery: rode n_ubrowser_snapshot p/ selector atual + confira aba ativa | ${UB_FB}`, data: { action: a.action, risk, value: null, cspBlocked: false, selectorFound: false }, telemetry: { execution_time_ms: Date.now() - t0 } });
      // v14: undefined (rodou, sem valor) ≠ null/falha de transporte — mensagens distintas.
      if (!a.selector && ubEvalNullKind(d) === "undefined") return devOut({ status: "warn", summary: `evaluate executou e retornou undefined — termine o JS com o valor desejado | ${UB_FB}`, data: { action: a.action, risk, value: null, undefined: true, cspBlocked: false, selectorFound: selFound, note: d.note || undefined }, telemetry: { execution_time_ms: Date.now() - t0 } });
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
    if (a.action === "close") {
      // #67: fechar aba-fantasma (about:blank) do agente. Aba do dono com http(s) ativo
      // é RECUSADA pela extensão sem confirm explícito — recai aqui como erro do bridge.
      if (a.mode === "close_by_prefix") {
        const n = Number(d.closed) || 0;
        const pfx = String(d.prefix || a.urlPrefix || "about:blank");
        if (!n) return devOut({ status: "warn", summary: `[close] nenhuma aba com prefixo "${pfx}" — nada a limpar (só about:blank é aceito)`, data: { action: "close", mode: "close_by_prefix", risk, closed: 0, prefix: pfx }, telemetry: { execution_time_ms: Date.now() - t0 } });
        return devOut({ summary: `[close risk=${risk}] ok — ${n} aba(s) fantasma (${pfx}) fechada(s) — aba do dono intocada`, data: { action: "close", mode: "close_by_prefix", risk, closed: n, tabIds: Array.isArray(d.tabIds) ? d.tabIds : [], prefix: pfx }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "n_ubrowser_tabs", reason: "Conferir abas restantes" }] });
      }
      const where = d.url ? String(d.url).slice(0, 80) : (a.tabId ? `tabId ${a.tabId}` : "aba ativa");
      return devOut({ summary: `[close risk=${risk}] ok — fechei ${where} — aba do dono intocada`, data: { action: "close", risk, closed: d.closed ?? 1, tabId: d.tabId, url: d.url, title: d.title }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "n_ubrowser_tabs", reason: "Conferir abas restantes" }] });
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
        const sr = await ubSend("tab.snapshot", { tabId: a.tabId, tab: a.tab, max: 40 }, UB_TIMEOUT_MS, tgt.id); // mesmo perfil da ação (multi-perfil)
        const sels = Array.isArray(sr?.data) ? sr.data : (Array.isArray(sr?.data?.items) ? sr.data.items : []);
        if (sr?.ok && sels.length) {
          const ranked = ubSnapRank(sels).slice(0, 10);
          snapTop = ranked.map((el) => `[${el.ref ?? "?"}] ${el.role || el.tag} "${String(el.text || el.name || "").slice(0, 60)}"`);
          snapNote = ` | snap: ${sels.length} interativos (top 10 abaixo)`;
        }
      } catch {}
    }
    // next[] utile: URL mudou = domínio novo → snapshot (refs frescas) vale mais que print.
    const nxtGen = urlChanged
      ? [{ tool: "n_ubrowser_snapshot", reason: "URL mudou — mapeie refs frescas antes de agir (shot confirma se precisar)" }]
      : [{ tool: "n_ubrowser_shot", reason: "Confirmar visualmente" }];
    return devOut({ summary: `[${a.action} risk=${risk}] ok — ${diff}${deltaNote}${snapNote}${clickNote}${expectNote}${ubAlertsHint()}`, data: { action: a.action, risk, ok: true, title: d.title, url: d.url, result: trimOut(d.text ?? d.value ?? "", 500), delta: d.delta || undefined, ...verifyFields, ...expectFields, ...(snapTop ? { snapshotTop: snapTop } : {}), after: { url: afterUrl, title: afterTitle }, changed: { url: urlChanged, title: titleChanged } }, telemetry: { execution_time_ms: Date.now() - t0 }, next: nxtGen });
  },
});

reg("n_ubrowser_shot", {
  description: "Print da aba VISÍVEL do dono (imagem + arquivo). Aba em fundo NÃO imprime — use n_browser_screenshot headless. Nunca troca de aba. scale:0.5 = metade dos bytes. Confirme visualmente após click/fill importantes. O texto da resposta traz tabId + título/url — aja na mesma aba com act/read sem re-listar tabs.",
  inputSchema: { type: "object", properties: { tabId: { type: "number" }, tab: { type: "string", description: "trecho do título/URL (resolve p/ tabId; IDs mudam)" }, scale: { type: "number", enum: [0.5, 1], default: 1, description: "deviceScaleFactor: 0.5 = metade dos bytes" } }, required: [] },
  run: async ({ tabId, tab, scale, profile }) => {
    const t0 = Date.now();
    const dsf = Number(scale) === 0.5 ? 0.5 : 1;
    const tgt = ubTarget(profile);
    if (!tgt.ok) return devOut({ status: "error", summary: tgt.summary, data: { profile: String(profile) }, telemetry: { execution_time_ms: Date.now() - t0 } });
    const r = await ubSend("tab.shot", { tabId, tab, scale: dsf }, UB_TIMEOUT_MS, tgt.id);
    if (r.__offline || r.__timeout) return devOut({ status: "error", summary: r.__offline ? UB_OFF_FULL : `${ubTimeoutMsg()} | ${UB_FB}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    if (!r.ok) return devOut({ status: "error", summary: `extensão: ${r.error} | ${UB_FB}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    if (r.data?.background) return devOut({ status: "error", summary: "Chrome só imprime aba VISÍVEL — traga p/ frente ou use n_browser_screenshot headless", data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    // v14 frescor: hash do shot por aba — imagem idêntica à anterior vira aviso, não verde falso.
    try {
      const h = r.data?.hash || null;
      if (h) {
        const key = ubShotCacheKey({ tabId, tab }, r.data);
        const prev = UB_SHOT_LAST.get(key);
        UB_SHOT_LAST.set(key, h);
        if (UB_SHOT_LAST.size > 20) UB_SHOT_LAST.delete(UB_SHOT_LAST.keys().next().value);
        if (prev && prev === h) return devOut({ status: "warn", summary: `imagem idêntica à anterior (hash ${h}) — repita após settle (página pode não ter aquietado) | ${UB_FB}`, data: { hash: h, capturedAt: r.data?.capturedAt || null, tab: r.data?.tab || null }, telemetry: { execution_time_ms: Date.now() - t0 } });
      }
    } catch {}
    const b64 = String(r.data.dataUrl || "").split(",")[1] || "";
    if (!b64) return devOut({ status: "error", summary: `screenshot vazio — traga aba p/ frente e tente de novo | ${UB_FB}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    const kb = Math.round((b64.length * 0.75) / 1024);
    const truncated = b64.length > 1500000;
    const tip = (truncated || kb > 500) ? " — dica: scale:0.5 = metade dos bytes" : "";
    const mime = String(r.data?.mime || "").startsWith("image/") ? String(r.data.mime) : "image/png";
    const tb = (r.data?.tab && typeof r.data.tab === "object") ? r.data.tab : {};
    const tbId = tb.id !== undefined && tb.id !== null ? `tabId ${tb.id} — aja nesta aba (act/read aceitam tabId:${tb.id})` : "";
    return { content: [{ type: "text", text: `Screenshot ${tb.title || ""} — ${tb.url || ""} (${kb} kB base64${truncated ? ", truncado em 1500k chars" : ""})${tip}${tbId ? ` | ${tbId}` : ""}` }, { type: "image", data: truncated ? b64.slice(0, 1500000) : b64, mimeType: mime }] };
  },
});

