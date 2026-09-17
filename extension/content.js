// UBrowser Bridge — content script (mundo isolado).
// Executa leitura e ações simples no DOM da página logada.
function cssPath(el) {
  // SELETORES ESTÁVEIS (sobrevivem a reload). Ordem: name → placeholder →
  // aria-label → text= → a[href] → #id (se não-dinâmico) → path curto.
  const tag = (el.tagName || "").toLowerCase() || "*";
  const q = (s) => String(s ?? "").replace(/"/g, '\\"');
  const uniq = (sel) => {
    try {
      return document.querySelectorAll(sel).length === 1;
    } catch {
      return false;
    }
  };
  const name = el.getAttribute && el.getAttribute("name");
  if (name) {
    const sel = `${tag}[name="${q(name)}"]`;
    if (uniq(sel)) return sel;
  }
  const ph = el.getAttribute && el.getAttribute("placeholder");
  if (ph) {
    const sel = `${tag}[placeholder="${q(ph)}"]`;
    if (uniq(sel)) return sel;
  }
  const al = el.getAttribute && el.getAttribute("aria-label");
  if (al) {
    const sel = `${tag}[aria-label="${q(al)}"]`;
    if (uniq(sel)) return sel;
  }
  const role = el.getAttribute && el.getAttribute("role");
  const txt = (((el.innerText || el.value || "") + "").replace(/\s+/g, " ").trim().slice(0, 30));
  if (role && !txt) {
    const sel = `${tag}[role="${q(role)}"]`;
    if (uniq(sel)) return sel;
  }
  if (txt && txt.length >= 2) {
    // findEl() resolve `text=` p/ tag + [role] (button/link/role) — estável entre reloads
    return "text=" + txt;
  }
  if (tag === "a") {
    const href = el.getAttribute && el.getAttribute("href");
    if (href && href.length < 200 && !/^javascript:/i.test(href) && href !== "#") {
      const sel = `a[href="${q(href)}"]`;
      if (uniq(sel)) return sel;
    }
  }
  const DYNAMIC_ID_RE = /^(radix|ti\d|ember|_r_|r\d+$|mui-)/;
  if (el.id && !DYNAMIC_ID_RE.test(el.id)) {
    const sel = "#" + (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(el.id) : el.id);
    if (uniq(sel)) return sel;
  }
  const parts = [];
  let n = el;
  for (let d = 0; d < 3 && n && n !== document.body; d++) {
    let s = n.tagName.toLowerCase();
    if (typeof n.className === "string") {
      const c = n.className.trim().split(/\s+/)[0];
      if (c) s += "." + c.replace(/[^a-zA-Z0-9_-]/g, "");
    }
    if (n.parentElement) {
      const sib = [...n.parentElement.children].filter((c) => c.tagName === n.tagName);
      if (sib.length > 1) s += ":nth-of-type(" + (sib.indexOf(n) + 1) + ")";
    }
    parts.unshift(s);
    n = n.parentElement;
  }
  return parts.join(" > ");
}

function findEl(sel) {
  if (!sel) return null;
  if (sel.startsWith("text=")) {
    const t = sel.slice(5).toLowerCase();
    return (
      [...document.querySelectorAll('a,button,input,select,textarea,[role="button"],[role="link"]')].find((e) =>
        ((e.innerText || e.value || "") + "").toLowerCase().includes(t)
      ) ||
      // linhas de lista (WhatsApp etc.): divs clicáveis sem role
      [...document.querySelectorAll('div[data-testid="cell-frame-container"],div[data-testid^="list-item-"],div[role="listitem"],div[role="row"]')].find((e) =>
        ((e.innerText || "") + "").toLowerCase().includes(t)
      ) || null
    );
  }
  try {
    return document.querySelector(sel);
  } catch {
    return null;
  }
}

var ubSleep = (ms) => new Promise((r) => setTimeout(r, ms)); // var: reinjeção (hot-update) reexecuta sem SyntaxError
// ubSettle: espera POR EVENTO (MutationObserver) com teto. Resolve true
// quiet ms após a última mutação; resolve false no teto. Sem rAF
// (aba em fundo não dispara rAF). Erro retorna imediato no caller.
function ubSettle({ timeout = 3000, quiet = 250 } = {}) {
  const t = Math.min(Math.max(Number(timeout) || 3000, 100), 10000);
  const q = Math.min(Math.max(Number(quiet) || 250, 50), 2000);
  return new Promise((resolve) => {
    let done = false;
    let obs = null;
    let quietTo = null;
    const finish = (v) => {
      if (done) return;
      done = true;
      try { obs && obs.disconnect(); } catch {}
      clearTimeout(cap);
      clearTimeout(quietTo);
      resolve(v);
    };
    const arm = () => {
      clearTimeout(quietTo);
      quietTo = setTimeout(() => finish(true), q);
    };
    const cap = setTimeout(() => finish(false), t);
    try {
      obs = new MutationObserver(() => arm());
      obs.observe(document.documentElement || document, { childList: true, subtree: true, characterData: true });
    } catch {
      finish(true);
      return;
    }
    arm();
  });
}
// Resiliência viewport virtualizada: estabiliza após scrollIntoView+300ms e
// tenta 1x de novo antes do NOTFOUND final.
async function findElResilient(sel) {
  let el = findEl(sel);
  if (el) {
    try { el.scrollIntoView({ block: "center" }); } catch {}
    await ubSleep(300);
    return findEl(sel) || el;
  }
  // 1ª tentativa falhou: cutuca viewport (materializa lista virtualizada) e tenta 1x
  try { document.body?.scrollIntoView?.({ block: "center" }); } catch {}
  try { window.scrollBy(0, 1); } catch {}
  await ubSleep(300);
  return findEl(sel);
}

// ---- cursor INDEPENDENTE (overlay roxo: não rouba o mouse do dono) ----
// PERSISTENTE: registrado via scripting.registerContentScripts (toda página http/https,
// desde o document_start) + posição salva em chrome.storage.session → sobrevive a F5/navegação.
var ubCursor = (typeof ubCursor !== "undefined" && ubCursor) || null, ubCX = 0, ubCY = 0; // var: preserva overlay em reinjeção
var UB_V = "8"; // anti-dupla-injeção: var + listener só-responde-mais-novo (hot-update seguro)
var __ubN = (typeof __ubN === "number" ? __ubN + 1 : 1); // contador de injeções (hot-update seguro)
globalThis.__ubLatestN = __ubN;
function ubShowCursor() {
  if (ubCursor && ubCursor.isConnected) return ubCursor;
  if (!document.getElementById("ubrowser-kf")) {
    const st = document.createElement("style");
    st.id = "ubrowser-kf";
    st.textContent = "@keyframes ubPulseLoop{0%,100%{filter:drop-shadow(0 0 5px #7c3aed)}50%{filter:drop-shadow(0 0 14px #a855f7)}}";
    document.documentElement.appendChild(st);
  }
  ubCursor = document.createElement("div");
  ubCursor.id = "ubrowser-cursor";
  ubCursor.innerHTML = `<svg width="34" height="34" viewBox="0 0 26 26" style="animation:ubPulseLoop 1.6s ease-in-out infinite"><g><path d="M4,2 L4,19 L9.5,14.5 L12.5,21 L15,19.8 L12,13.5 L17.5,13.5 Z" fill="#7c3aed" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></g></svg>`;
  ubCX = Math.round(innerWidth / 2); ubCY = Math.round(innerHeight / 2); // nasce no CENTRO, nunca no canto
  Object.assign(ubCursor.style, { position: "fixed", zIndex: "2147483647", width: "34px", height: "34px", pointerEvents: "none", left: ubCX - 4 + "px", top: ubCY - 2 + "px", transition: "none" });
  ubCursor._arrow = ubCursor.firstChild;
  document.documentElement.appendChild(ubCursor);
  return ubCursor;
}
function ubGlide(x, y) {
  const c = ubShowCursor();
  ubCX = Math.max(0, Math.round(x)); ubCY = Math.max(0, Math.round(y));
  c.style.left = ubCX - 4 + "px"; c.style.top = ubCY - 2 + "px"; // ponta da seta no alvo
  try { chrome.storage.session.set({ ubCursor: { x: ubCX, y: ubCY } }).catch(() => {}); } catch {}
  return Promise.resolve(); // TELEPORTE: transition none — seta apenas APARECE no alvo, sem trajetória
}
// recria o cursor no load, na última posição salva (constante entre páginas)
try {
  chrome.storage.session.get(["ubCursor"]).then((s) => {
    if (s?.ubCursor) ubGlide(s.ubCursor.x, s.ubCursor.y);
  }).catch(() => {});
} catch {}
// guarda-costas: se a página remover nosso nó, recoloca (sem loop: só quando some)
try {
  let ubGuardBusy = false;
  new MutationObserver(() => {
    if (ubGuardBusy) return;
    if (!document.getElementById("ubrowser-cursor") && ubCursor) {
      ubGuardBusy = true;
      try { document.documentElement.appendChild(ubCursor); } catch {}
      ubGuardBusy = false;
    }
  }).observe(document.documentElement, { childList: true });
} catch {}
function ubPulse() {
  const c = ubShowCursor();
  const el = c._arrow || c;
  el.style.transform = "scale(.75)";
  el.style.transformOrigin = "top left";
  setTimeout(() => (el.style.transform = "scale(1)"), 160);
}
function elCenterValid(p, vw, vh) {
  return p && p.w > 0 && p.h > 0 && p.x >= 0 && p.y >= 0 && p.x <= vw && p.y <= vh;
}
function elRect(el) {
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) };
}
// mede DEPOIS do scroll assentar + re-query (lista virtualizada recicla nós)
async function elCenterFresh(sel, tries = 2) {
  let el = null, p = null;
  for (let i = 0; i < tries; i++) {
    el = findEl(sel);
    if (!el) return { el: null, p: null };
    try { el.scrollIntoView({ block: "center" }); } catch {}
    await ubSettle({ timeout: 800, quiet: 120 });
    el = findEl(sel) || el;
    p = elRect(el);
    if (elCenterValid(p, innerWidth, innerHeight)) return { el, p };
  }
  return { el, p };
}

// ---- semântica de acessibilidade p/ snapshot (role/name/state/level/path) ----
function ubAriaRole(el) {
  try {
    const explicit = el.getAttribute && el.getAttribute("role");
    if (explicit && String(explicit).trim()) return String(explicit).trim().split(/\s+/)[0].toLowerCase();
  } catch {}
  const tag = ((el.tagName || "").toLowerCase());
  let type = "";
  try { type = String(el.type || (el.getAttribute && el.getAttribute("type")) || "").toLowerCase(); } catch {}
  if (tag === "a") return (el.hasAttribute && el.hasAttribute("href")) ? "link" : "generic";
  if (tag === "button") return "button";
  if (tag === "select") return "combobox";
  if (tag === "textarea") return "textbox";
  if (/^h[1-6]$/.test(tag)) return "heading";
  if (tag === "img") return "img";
  if (tag === "li") return "listitem";
  if (tag === "ul" || tag === "ol") return "list";
  if (tag === "table") return "table";
  if (tag === "tr") return "row";
  if (tag === "form") return "form";
  if (tag === "nav") return "navigation";
  if (tag === "main") return "main";
  if (tag === "header") return "banner";
  if (tag === "footer") return "contentinfo";
  if (tag === "input") {
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    if (type === "button" || type === "submit" || type === "reset" || type === "image") return "button";
    if (type === "range") return "slider";
    if (type === "hidden") return "";
    return "textbox";
  }
  try {
    if (el.isContentEditable) return "textbox";
    if (el.getAttribute && el.getAttribute("contenteditable") === "true") return "textbox";
  } catch {}
  return "generic";
}
// Accessible name na ordem: aria-label → text → value → placeholder → title.
function ubAccessibleName(el, text) {
  try {
    const al = el.getAttribute && el.getAttribute("aria-label");
    if (al && String(al).trim()) return String(al).replace(/\s+/g, " ").trim().slice(0, 60);
  } catch {}
  if (text && String(text).trim()) return String(text).slice(0, 60);
  try {
    const v = el.value;
    if (v !== undefined && v !== null && String(v).trim()) return String(v).replace(/\s+/g, " ").trim().slice(0, 60);
  } catch {}
  try {
    const ph = el.getAttribute && el.getAttribute("placeholder");
    if (ph && String(ph).trim()) return String(ph).replace(/\s+/g, " ").trim().slice(0, 60);
  } catch {}
  try {
    const ti = el.getAttribute && el.getAttribute("title");
    if (ti && String(ti).trim()) return String(ti).replace(/\s+/g, " ").trim().slice(0, 60);
  } catch {}
  return "";
}
// Só flags relevantes; "" quando nenhuma se aplica (schema estável).
function ubElementState(el) {
  const st = [];
  try {
    const ariaDis = el.getAttribute && el.getAttribute("aria-disabled");
    if (el.disabled === true || ariaDis === "true") st.push("disabled");
  } catch {}
  try {
    const role = el.getAttribute && el.getAttribute("role");
    const t = String((el.type || "")).toLowerCase();
    const isCheck = t === "checkbox" || t === "radio" || role === "checkbox" || role === "radio" || role === "switch";
    const ariaChecked = el.getAttribute && el.getAttribute("aria-checked");
    if (isCheck) {
      if (el.checked === true || ariaChecked === "true") st.push("checked");
    } else if (ariaChecked === "true") {
      st.push("checked");
    }
  } catch {}
  try {
    const exp = el.getAttribute && el.getAttribute("aria-expanded");
    if (exp === "true") st.push("expanded");
    else if (exp === "false") st.push("collapsed");
  } catch {}
  try {
    if (el.selected === true) st.push("selected");
    else if (el.getAttribute && el.getAttribute("aria-selected") === "true") st.push("selected");
  } catch {}
  try {
    if (el.readOnly === true) st.push("readonly");
    else if (el.getAttribute && el.getAttribute("aria-readonly") === "true") st.push("readonly");
  } catch {}
  return st.join(" ");
}
function ubHeadingLevel(el, role) {
  try {
    const tag = ((el.tagName || "").toLowerCase());
    if (role !== "heading" && !/^h[1-6]$/.test(tag)) return 0;
    const ariaLevel = el.getAttribute && parseInt(el.getAttribute("aria-level"), 10);
    if (ariaLevel >= 1 && ariaLevel <= 6) return ariaLevel;
    const m = tag.match(/^h([1-6])$/);
    if (m) return Number(m[1]);
  } catch {}
  return 0;
}
// Path hierárquico curto ex. "main>form>div[2]" (índice 1-based só entre irmãos do mesmo tag).
function ubShortPath(el, maxDepth = 4) {
  try {
    const parts = [];
    let n = el;
    while (n && n !== document.body && n !== document.documentElement && parts.length < maxDepth) {
      const tag = ((n.tagName || "").toLowerCase() || "*");
      let s = tag;
      try {
        const parent = n.parentElement;
        if (parent) {
          const same = [...parent.children].filter((c) => ((c.tagName || "").toLowerCase() === tag));
          if (same.length > 1) s += "[" + (same.indexOf(n) + 1) + "]";
        }
      } catch {}
      parts.unshift(s);
      n = n.parentElement;
    }
    return parts.join(">");
  } catch { return ""; }
}

// ---- snapshot virtualizado: coleta incremental com scroll (WhatsApp etc.) ----
// Coleta crua (sem ref — ref é atribuído só no final p/ refs estáveis após dedup).
// Teto coleta: hard cap 120 elementos (fatia cedo, antes de sort/dedup) — alivia CPU/RAM no DOM gigante.
// needBox=false: pula getBoundingClientRect (força layout/sync) na varredura; box é
// preenchido LAZY só p/ itens finais via ubFillBoxLazy (até 120 medidas, não páginas*120).
function ubSnapshotCollectRaw(limit = 120, needBox = true) {
  const cap = Math.min(Math.max(Number(limit) || 120, 10), 120);
  const els = [...document.querySelectorAll('a,button,input,select,textarea,h1,h2,h3,h4,h5,h6,[role="button"],[role="link"],[role="listitem"],[role="row"],div[data-testid="cell-frame-container"],div[data-testid^="list-item-"],[onclick]')].slice(0, cap);
  return els.map((el) => {
    const tag = el.tagName.toLowerCase();
    const text = (((el.textContent || el.value || el.placeholder || (el.getAttribute && el.getAttribute("aria-label")) || "") + "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60));
    const role = (() => { try { return ubAriaRole(el); } catch { return ""; } })();
    const name = (() => { try { return ubAccessibleName(el, text); } catch { return text; } })();
    const state = (() => { try { return ubElementState(el); } catch { return ""; } })();
    const lvl = (() => { try { return ubHeadingLevel(el, role); } catch { return 0; } })();
    const path = (() => { try { return ubShortPath(el); } catch { return ""; } })();
    // LAZY: só mede box (getBoundingClientRect força layout/sync) quando needBox=true;
    // senão zera e guarda _el (não-enumerável) p/ ubFillBoxLazy medir só nos finais.
    const rect = needBox
      ? (() => { try { return elRect(el); } catch { return { x: 0, y: 0, w: 0, h: 0 }; } })()
      : { x: 0, y: 0, w: 0, h: 0 };
    const out = {
      tag,
      role,
      name,
      text,
      type: el.type || (el.getAttribute && el.getAttribute("role")) || "",
      state,
      ...(lvl ? { level: lvl } : {}),
      path,
      selector: (() => { try { return cssPath(el); } catch { return ""; } })(),
      ...rect,
    };
    if (!needBox) {
      try { Object.defineProperty(out, "_el", { value: el, enumerable: false, writable: true }); }
      catch { try { out._el = el; } catch {} }
    }
    return out;
  });
}
// Preenche x/y/w/h LAZY só p/ itens finais (evita forçar layout em 120*páginas).
// Usa _el quando ainda conectado; senão re-resolve via selector. Remove _el ao fim.
function ubFillBoxLazy(items) {
  for (const it of items) {
    try {
      let elb = null;
      try { elb = it._el && it._el.isConnected ? it._el : null; } catch { elb = null; }
      if (!elb && it.selector) { try { elb = findEl(it.selector); } catch { elb = null; } }
      if (elb) {
        let r = null;
        try { r = elRect(elb); } catch { r = null; }
        if (r) { it.x = r.x; it.y = r.y; it.w = r.w; it.h = r.h; }
      }
    } catch {}
    try { delete it._el; } catch {}
  }
  return items;
}
// Containers com scroll real (listas virtualizadas reciclam nós — sem scroll só vemos o viewport).
function ubFindVirtualContainers(hintSel) {
  const out = [];
  const push = (el) => { if (el && !out.includes(el) && out.length < 3) out.push(el); };
  if (hintSel) {
    try {
      const h = document.querySelector(hintSel);
      if (h) push(h);
    } catch {}
  }
  const known = ['#pane-side', '[data-testid="chat-list"]', '[role="list"]', '[role="grid"]', '[role="rowgroup"]', 'div[role="list"]'];
  for (const s of known) {
    try { document.querySelectorAll(s).forEach(push); } catch {}
    if (out.length >= 3) break;
  }
  if (out.length < 3) {
    try {
      document.querySelectorAll("div,ul").forEach((el) => {
        if (out.length >= 3 || out.includes(el)) return;
        let st = null;
        try { st = getComputedStyle(el); } catch { return; }
        const ov = ((st && st.overflowY) || "") + " " + ((st && st.overflow) || "");
        if (!/auto|scroll/i.test(ov)) return;
        try {
          if (el.scrollHeight > el.clientHeight + 40 && el.clientHeight > 100 && el.clientHeight < innerHeight * 0.95) push(el);
        } catch {}
      });
    } catch {}
  }
  return out;
}
// Rolagem p/ carregar + coleta incremental com dedup (selector|text). Restaura scroll ao fim.
// Bounded: páginas ≤5, containers ≤3, settle ~900ms/página — cabe no timeout de 15s do ask().
// Teto coleta: hard cap 120 (fatia cedo, antes de sort/dedup). Se pedir maior, para no teto (nota: truncado no cap).
// Com match: para cedo na 1ª coleta que contém o texto (não varre pages todas).
// Box LAZY: varredura com needBox=false (sem layout); ubFillBoxLazy mede só finais antes do sort.
async function ubSnapshotVirtualized({ pages = 2, container = null, limit = 120, match = "" } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 120, 10), 120);
  const maxPages = Math.min(Math.max(Number(pages) || 2, 1), 5);
  const seen = new Map();
  const needle = String(match ?? "").toLowerCase().trim();
  const hasNeedle = needle.length > 0;
  const hasMatch = () => {
    if (!hasNeedle) return false;
    for (const it of seen.values()) {
      if (((it.text || "").toLowerCase().includes(needle))) return true;
    }
    return false;
  };
  const push = (arr) => {
    for (const it of arr) {
      const k = (it.selector || "") + "|" + (it.text || "");
      if (!seen.has(k)) seen.set(k, it);
    }
  };
  push(ubSnapshotCollectRaw(lim, false));
  if (hasMatch()) {
    const early = [...seen.values()].slice(0, lim);
    ubFillBoxLazy(early);
    early.sort((x, y) => ((x.y - y.y) || (x.x - y.x)));
    return early.map((it, i) => ({ ref: i, ...it }));
  }
  const targets = ubFindVirtualContainers(container).slice(0, 3); // nota: máx 3 containers (se maior, para aqui)
  if (!targets.length) {
    try { window.scrollBy(0, 1); } catch {}
    await ubSleep(200);
    push(ubSnapshotCollectRaw(lim, false));
    try { window.scrollBy(0, -1); } catch {}
  } else {
    let foundEarly = false;
    for (const cont of targets) {
      let startTop = 0;
      try { startTop = cont.scrollTop || 0; } catch {}
      let lastTop = -1, same = 0;
      const step = Math.max(Math.round(((cont.clientHeight || innerHeight) * 0.9) || 400), 100);
      for (let p = 0; p < maxPages; p++) {
        try { cont.scrollBy(0, step); } catch { break; }
        await ubSettle({ timeout: 900, quiet: 150 });
        push(ubSnapshotCollectRaw(lim, false));
        if (hasMatch()) { foundEarly = true; break; }
        let cur = 0, max = 0;
        try { cur = cont.scrollTop; max = cont.scrollHeight - cont.clientHeight; } catch {}
        if (cur === lastTop) { same++; if (same >= 1) break; }
        else { same = 0; lastTop = cur; }
        try { if (cur + (cont.clientHeight || 0) >= (cont.scrollHeight || 0) - 8) break; } catch {}
        if (max <= 0) break;
        if (seen.size >= lim) break;
      }
      try { if (typeof cont.scrollTo === "function") cont.scrollTo(0, startTop); else cont.scrollTop = startTop; } catch {}
      if (foundEarly) break;
      if (seen.size >= lim) break;
    }
  }
  const items = [...seen.values()].slice(0, lim);
  ubFillBoxLazy(items);
  items.sort((x, y) => ((x.y - y.y) || (x.x - y.x)));
  return items.map((it, i) => ({ ref: i, ...it }));
}
// ---- read principal: article/main sem nav/footer/ads/scripts + links com texto (máx 15) ----
// Opera em CLONE p/ texto (nunca toca na página real); links via DOM vivo (href absoluto).
// Qualidade: score de blocos por densidade (palavras/tags); fora de article/main descarta <25 palavras.
function ubReadMain(maxChars = 2500, maxLinks = 15) {
  const mc = Math.min(Math.max(Number(maxChars) || 2500, 200), 6000);
  const ml = Math.min(Math.max(Number(maxLinks ?? 15) || 0, 0), 15);
  const semEl = document.querySelector("article") || document.querySelector("main") || document.querySelector('[role="main"]');
  const root = semEl || document.body;
  const isSemantic = !!semEl;
  let full = "";
  try {
    const clone = root.cloneNode(true);
    clone.querySelectorAll("script,style,noscript,template,nav,footer,header,aside").forEach((n) => n.remove());
    const adRe = /ad|banner|popup|cookie|newsletter|sponsor|paywall|modal|\btoc\b/i;
    clone.querySelectorAll("[class],[id]").forEach((n) => {
      const s = ((n.className && typeof n.className === "string" ? n.className : "") + " " + (n.id || ""));
      if (s && adRe.test(s)) n.remove();
    });
    const kept = [];
    try {
      const blocks = [...clone.querySelectorAll("p,h1,h2,h3,h4,h5,h6,li,blockquote,pre")];
      for (const b of blocks) {
        try { if (b.closest && b.closest("nav,footer,header,aside")) continue; } catch {}
        const t = ((b.textContent || "").replace(/\s+/g, " ").trim());
        if (!t) continue;
        const words = t.split(/\s+/).filter(Boolean).length;
        let tags = 1;
        try { tags = b.querySelectorAll("*").length + 1; } catch {}
        const density = words / tags; // palavras por tag: boilerplate link-heavy pontua baixo
        if (!isSemantic && words < 25) continue; // fora de article/main: só bloco substancial
        if (isSemantic && words < 8 && density < 2) continue; // micro-boilerplate mesmo dentro de article/main
        kept.push(t);
      }
    } catch {}
    if (kept.length) {
      full = kept.join("\n\n");
    } else {
      // fallback div-only (sites modernos sem <p>): só div/section folha, mesmo corte de 25 fora de article/main
      try {
        const divs = [...clone.querySelectorAll("div,section")];
        for (const d of divs) {
          try { if (d.closest && d.closest("nav,footer,header,aside")) continue; } catch {}
          try { if (d.querySelector("p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,div,section")) continue; } catch {} // só folha
          const t = ((d.textContent || "").replace(/\s+/g, " ").trim());
          if (!t) continue;
          const words = t.split(/\s+/).filter(Boolean).length;
          if (!isSemantic && words < 25) continue;
          if (isSemantic && words < 8) continue;
          kept.push(t);
        }
      } catch {}
      full = kept.length ? kept.join("\n\n") : ((clone.textContent || "").replace(/\s+/g, " ").trim());
    }
  } catch {
    try { full = (((root && (root.innerText || root.textContent)) || "").replace(/\s+/g, " ").trim()); } catch { full = ""; }
  }
  const text = full.slice(0, mc);
  let links = [];
  try {
    if (ml > 0 && root && root.querySelectorAll) {
      const seenHref = new Set();
      const all = [];
      for (const x of root.querySelectorAll("a[href]")) {
        let href = "";
        try { href = x.href || x.getAttribute("href") || ""; } catch { href = ""; }
        href = String(href || "").trim();
        if (!href || /^javascript:/i.test(href) || href === "#") continue;
        if (href.startsWith("#")) continue;
        try { if (x.closest && x.closest("nav,footer,header,aside")) continue; } catch {}
        try { if (x.getAttribute && x.getAttribute("aria-hidden") === "true") continue; } catch {}
        try { if (x.hasAttribute && x.hasAttribute("hidden")) continue; } catch {}
        const t = (((x.innerText || x.textContent) || "").replace(/\s+/g, " ").trim().slice(0, 80));
        if (!t || t.length < 3) continue;
        let key = href;
        try { key = href.split("#")[0].replace(/\/$/, ""); } catch {}
        if (!key) continue;
        if (seenHref.has(key)) continue;
        seenHref.add(key);
        all.push({ text: t, href });
        if (all.length >= ml) break;
      }
      links = all.slice(0, ml);
    }
  } catch {}
  return { text, links, stats: { chars: text.length, links: links.length, omitted: Math.max(full.length - text.length, 0) } };
}
function ubIsCSPError(e) {
  return /Content Security Policy|unsafe-eval|Refused to (evaluate|execute)/i.test(String((e && e.message) || e || ""));
}

// ---- distill: texto enxuto e desduplicado (opera em CLONE, nunca na página real) ----
function ubDistill(maxChars = 4000) {
  const cap = Math.min(Math.max(Number(maxChars) || 4000, 200), 12000);
  const clone = document.documentElement.cloneNode(true);
  // 1) remove lixo: scripts/estilos + landmarks + ad-like por class/id
  const junkSel = 'script,style,noscript,template,header,footer,nav,aside';
  clone.querySelectorAll(junkSel).forEach((n) => n.remove());
  const adRe = /ad|banner|popup|cookie|newsletter|sponsor|paywall|modal|navbox|\btoc\b|editsection|printfooter|catlinks|sitenotice|jump-?to/i;
  clone.querySelectorAll('[class],[id]').forEach((n) => {
    const s = ((n.className && typeof n.className === "string" ? n.className : "") + " " + (n.id || ""));
    if (s && adRe.test(s)) n.remove();
  });
  // 2) raiz: article || main || [role=main] || body
  const root = clone.querySelector("article") || clone.querySelector("main") || clone.querySelector('[role="main"]') || clone.querySelector("body") || clone;
  const blocks = root.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li,a,button,input,select,textarea,img[alt],tr,div,span");
  const seenText = new Set();
  const seenHref = new Set();
  const lines = [];
  let descartadas = 0;
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
  for (const el of blocks) {
    // 3) pula invisíveis e vazios (offsetParent só vale p/ nó conectado; clone é detached)
    try {
      if (el.isConnected && el.offsetParent === null) { descartadas++; continue; }
    } catch { /* noop */ }
    if (el.getAttribute && el.getAttribute("aria-hidden") === "true") { descartadas++; continue; }
    if (el.hasAttribute && (el.hasAttribute("hidden") || el.hasAttribute("aria-hidden") && el.getAttribute("aria-hidden") === "true")) { descartadas++; continue; }
    const st = (el.getAttribute && el.getAttribute("style")) || "";
    if (/display\s*:\s*none/i.test(st)) { descartadas++; continue; }
    if (el.style && el.style.display === "none") { descartadas++; continue; }
    const tag = (el.tagName || "").toLowerCase();
    let line = "";
    if (/^h[1-6]$/.test(tag)) {
      const t = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (!t) { descartadas++; continue; }
      line = "# " + t;
    } else if (tag === "li") {
      const t = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (!t) { descartadas++; continue; }
      line = "- " + t;
    } else if (tag === "a") {
      const t = (el.textContent || "").replace(/\s+/g, " ").trim();
      const href = el.getAttribute("href") || el.href || "";
      if (!t && !href) { descartadas++; continue; }
      if (t.length < 2) { descartadas++; continue; } // v/d/e e setinhas: ruído
      if (/\/Ficheiro:|\/File:|Especial:|action=edit|redlink=1/i.test(href)) { descartadas++; continue; } // edição/arquivo wiki: ruído
      if (href && seenHref.has(href)) { descartadas++; continue; }
      if (href) seenHref.add(href);
      line = href ? "[" + (t || href) + "](" + href + ")" : t;
    } else if (tag === "button") {
      const t = ((el.textContent || el.value || el.getAttribute("aria-label") || "") + "").replace(/\s+/g, " ").trim();
      if (!t) { descartadas++; continue; }
      line = "[btn: " + t + "]";
    } else if (tag === "input" || tag === "select" || tag === "textarea") {
      const tipo = el.getAttribute("type") || el.type || tag;
      const ph = ((el.getAttribute("placeholder") || el.value || el.getAttribute("aria-label") || "") + "").replace(/\s+/g, " ").trim();
      line = "[campo " + tipo + (ph ? " " + ph : "") + "]";
    } else if (tag === "img") {
      const alt = (el.getAttribute("alt") || "").replace(/\s+/g, " ").trim();
      if (!alt) { descartadas++; continue; }
      line = "[img: " + alt + "]";
    } else if (tag === "div" || tag === "span") {
      // só div/span MAIS INTERNO sem bloco filho (evita duplicar; sites modernos renderizam tudo em div)
      if (el.querySelector("h1,h2,h3,h4,h5,h6,p,li,a,button,input,select,textarea,tr,div,span")) { descartadas++; continue; }
      const t = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (!t || t.length < 3) { descartadas++; continue; }
      line = t;
    } else {
      // p, tr: texto corrido
      const t = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (!t) { descartadas++; continue; }
      line = t;
    }
    if (!line) { descartadas++; continue; }
    // 4) dedup por texto normalizado
    const k = norm(line);
    if (!k || seenText.has(k)) { descartadas++; continue; }
    seenText.add(k);
    lines.push(line);
  }
  let markdown = lines.join("\n");
  if (markdown.length > cap) markdown = markdown.slice(0, cap);
  return { title: document.title, url: location.href, markdown, stats: { linhas: lines.length, descartadas, chars: markdown.length } };
}

chrome.runtime.onMessage.addListener(((myN) => (msg, _sender, reply) => {
  if (myN !== globalThis.__ubLatestN) return; // injeção antiga: silenciosa (evita resposta dupla)
  (async () => {
    const a = msg.args || {};
    if (msg.cmd === "ping") { reply({ ok: true, data: { v: UB_V } }); return; }
    if (msg.cmd === "state") { reply({ ok: true, data: { title: document.title, url: location.href } }); return; }
    if (msg.cmd === "read") {
      if (a.mode === "distill") {
        const mc = Math.min(Math.max(Number(a.maxChars) || 4000, 200), 12000);
        const d = ubDistill(mc);
        reply({ ok: true, data: d });
        return;
      }
      // Destilado leve: conteúdo principal (article/main, sem nav/footer/ads/scripts),
      // links ≤15 com texto, stats {chars, links, omitted}. Protocolo {ok,data} preservado.
      const r = ubReadMain(a.maxChars, a.maxLinks);
      reply({
        ok: true,
        data: {
          title: document.title,
          url: location.href,
          text: r.text,
          links: r.links,
          stats: r.stats,
        },
      });
    } else if (msg.cmd === "distill") {
      const mc = Math.min(Math.max(Number(a.maxChars) || 4000, 200), 12000);
      const d = ubDistill(mc);
      reply({ ok: true, data: d });
    } else if (msg.cmd === "html") {
      // inspeção real: outerHTML do seletor (p/ ver estrutura viva como no DevTools)
      const el = a.selector ? findEl(a.selector) : document.documentElement;
      if (!el) return reply({ ok: false, error: "NOTFOUND: " + (a.selector || "root") });
      const cap = Math.min(Math.max(Number(a.maxChars) || 8000, 500), 30000);
      reply({ ok: true, data: { tag: el.tagName.toLowerCase(), html: el.outerHTML.slice(0, cap), truncated: el.outerHTML.length > cap } });
    } else if (msg.cmd === "snapshot") {
      // Virtualizado: rola containers p/ carregar + coleta incremental com dedup.
      // Protocolo preservado: responde {ok:true, data} (sem match: data=[...] array; background fatia offset/max).
      // Args opcionais (todos retrocompatíveis): {pages (1-5, default 2), container (seletor), limit (hard cap 120), match}.
      // Com match: para cedo (não varre pages todas); data={items, found, position}.
      try {
        const match = a.match ?? a.query ?? a.text ?? "";
        const data = await ubSnapshotVirtualized({ pages: a.pages, container: a.container, limit: 120, match });
        if (match && String(match).trim()) {
          const needle = String(match).toLowerCase();
          const pos = data.findIndex((it) => ((it.text || "").toLowerCase().includes(needle)));
          reply({ ok: true, data: { items: data, found: pos >= 0, position: pos } });
        } else {
          reply({ ok: true, data });
        }
      } catch (e) {
        // Fallback: coleta single-pass original (nunca quebra background que espera array).
        try {
          const fb = ubSnapshotCollectRaw(120).map((it, i) => ({ ref: i, ...it }));
          const matchFb = a.match ?? a.query ?? a.text ?? "";
          if (matchFb && String(matchFb).trim()) {
            const needleFb = String(matchFb).toLowerCase();
            const posFb = fb.findIndex((it) => ((it.text || "").toLowerCase().includes(needleFb)));
            reply({ ok: true, data: { items: fb, found: posFb >= 0, position: posFb } });
          } else {
            reply({ ok: true, data: fb });
          }
        } catch {
          reply({ ok: false, error: "SNAPSHOT_ERROR: " + String((e && e.message) || e || "").slice(0, 200) });
        }
      }
    } else if (msg.cmd === "wa_state") {
      reply({ ok: true, data: { logged: !!document.querySelector('[data-testid="chat-list-search"], #side'), qr: !!document.querySelector('canvas[aria-label="Scan me!"], div[data-testid="qrcode"]'), title: document.title } });
    } else if (msg.cmd === "wa_chats") {
      const lim = Math.min(Math.max(Number(a.limit) || 20, 1), 50);
      const rows = [...document.querySelectorAll('div[data-testid^="list-item-"], div[role="listitem"], div[role="row"]')].slice(0, lim);
      reply({ ok: true, data: rows.map((r) => ({ name: ((r.querySelector("span[dir]") || {}).innerText || r.innerText || "").replace(/\s+/g, " ").trim().slice(0, 80), preview: (r.innerText || "").replace(/\s+/g, " ").trim().slice(0, 120) })) });
    } else if (msg.cmd === "wa_open") {
      if (!a.name) return reply({ ok: false, error: "name obrigatório" });
      const name = String(a.name);
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      const setNative = (el, v) => {
        try {
          const proto = Object.getPrototypeOf(el);
          const desc = Object.getOwnPropertyDescriptor(proto, "value") || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
          if (desc && desc.set) desc.set.call(el, v);
          else el.value = v;
        } catch { try { el.value = v; } catch {} }
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      };
      const box = document.querySelector('#side div[contenteditable="true"][data-tab="3"]') || document.querySelector('#side div[contenteditable="true"]') || document.querySelector('div[title="Search input textbox"]')
        || document.querySelector('#side input[aria-label]') || document.querySelector('#side input[type="text"]') || document.querySelector('#side input') || document.querySelector('#side input[placeholder*="Pesquisar"]') || document.querySelector('#side input[placeholder*="Search"]') || document.querySelector('input[placeholder*="Pesquisar"]');
      if (!box) return reply({ ok: false, error: "search-box-not-found" });
      box.focus();
      if (box.tagName === "INPUT") setNative(box, name);
      else { document.execCommand("selectAll", false, null); document.execCommand("insertText", false, name); box.dispatchEvent(new Event("input", { bubbles: true })); }
      await ubSleep(2000);
      const rows = [...document.querySelectorAll('#pane-side div[role="row"], div[data-testid^="list-item-"], div[data-testid="cell-frame-container"]')];
      const byTitle = (nm) => rows.find((r) => {
        const t = r.querySelector('[data-testid="cell-frame-title"] span[title]') || r.querySelector('span[title]');
        return t && (t.getAttribute("title") || "").toLowerCase().includes(nm.toLowerCase());
      });
      let target = byTitle(name);
      if (!target) {
        const hits = [...document.querySelectorAll('span[data-testid="text-highlight"]')];
        const hl = hits.find((s) => (s.innerText || "").toLowerCase() && ((s.closest('[data-testid="cell-frame-container"]')?.innerText) || "").toLowerCase().includes(name.toLowerCase()));
        target = hl ? hl.closest('div[data-testid="cell-frame-container"]') : null;
      }
      if (!target) {
        // sem fallback rows[0]: abrir o chat errado é pior que falhar (incidente IBL)
        try { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); } catch {}
        return reply({ ok: false, error: `no-match: "${name}"` });
      }
      target.scrollIntoView({ block: "center" });
      await ubSleep(400);
      target.click();
      const want = name.toLowerCase().split(" ")[0];
      for (let i = 0; i < 20; i++) {
        await ubSleep(500);
        const head = document.querySelector('#main header span[dir="auto"], header span[data-testid="conversation-info-header-chat-title"]');
        const compose = document.querySelector('#main [data-testid="conversation-compose-box-input"], #main footer div[contenteditable="true"]');
        const title = ((head && head.innerText) || "").trim();
        if (head && compose && title.toLowerCase().includes(want)) return reply({ ok: true, data: { opened: true, title: title.slice(0, 80) } });
      }
      const head2 = document.querySelector('#main header span[dir="auto"]');
      reply({ ok: true, data: { opened: false, reason: "sem-confirmacao", headerNow: ((head2 && head2.innerText) || "").trim().slice(0, 80) } });
    } else if (msg.cmd === "wa_ids") {
      // ids reais das bolhas carregadas (semente p/ backfill do gateway) — sem clique, sem tela
      const bubbles = [...document.querySelectorAll('#main [data-pre-plain-text]')];
      reply({ ok: true, data: bubbles.map((b) => ({ id: b.getAttribute("data-id") || "", meta: (b.getAttribute("data-pre-plain-text") || "").slice(0, 80), len: (b.innerText || "").length })) });
    } else if (msg.cmd === "wa_read") {
      const lim = Math.min(Math.max(Number(a.limit) || 20, 1), 100);
      const bubbles = [...document.querySelectorAll('#main [data-pre-plain-text]')].slice(-lim);
      reply({
        ok: true,
        data: bubbles.map((b) => {
          const meta = b.getAttribute("data-pre-plain-text") || "";
          const m = meta.match(/^\[([^\]]+)\]\s*(.+?):\s*$/);
          const dir = b.closest(".message-out") ? "out" : b.closest(".message-in") ? "in" : "?";
          const spans = [...b.querySelectorAll("span[dir]")].filter((s) => !s.querySelector("span[dir]"));
          let text = spans.map((s) => s.innerText || "").join(" ").replace(/\s+/g, " ").trim();
          if (!text) text = (b.innerText || "").replace(/\s+/g, " ").trim().slice(0, 500);
          return { at: m ? m[1] : "", from: m ? m[2] : "", dir, text: text.slice(0, 500) };
        }),
      });
    } else if (msg.cmd === "wa_send") {
      if (!a.text || !String(a.text).trim()) return reply({ ok: false, error: "text obrigatório e não-vazio" });
      const msg2 = String(a.text).slice(0, 2000);
      const box = document.querySelector('#main [data-testid="conversation-compose-box-input"]') || document.querySelector('#main footer div[contenteditable="true"][role="textbox"]') || document.querySelector('#main div[data-lexical-editor="true"]') || document.querySelector('#main footer div[contenteditable="true"]');
      if (!box) return reply({ ok: false, error: "compose-not-found (abra o chat primeiro)" });
      box.focus();
      document.execCommand("insertText", false, msg2);
      await ubSleep(400);
      const before = document.querySelectorAll('#main div[data-testid="msg-container"]').length;
      box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
      await ubSettle({ timeout: 8000 });
      const outs = [...document.querySelectorAll('#main div.message-out [data-pre-plain-text]')];
      const last = outs.length ? (outs[outs.length - 1].innerText || "") : "";
      const after = document.querySelectorAll('#main div[data-testid="msg-container"]').length;
      reply({ ok: true, data: { sent: after > before || last.includes(msg2.slice(0, 30)), count: after } });
    } else if (msg.cmd === "click") {
      const el = await findElResilient(a.selector);
      if (!el) return reply({ ok: false, error: "NOTFOUND: " + a.selector });
      const fresh = await elCenterFresh(a.selector);
      if (!fresh.el) return reply({ ok: false, error: "NOTFOUND após scroll: " + a.selector });
      await ubGlide(fresh.p.x, fresh.p.y); // cursor desliza até o alvo antes de clicar
      ubPulse();
      (fresh.el || el).click();
      await ubSettle({ timeout: 3000 });
      reply({ ok: true, data: { clicked: a.selector, title: document.title, url: location.href } });
    } else if (msg.cmd === "cursor") {
      // cursor independente: move (x,y da viewport) e opcionalmente clica no ponto
      await ubGlide(Number(a.x) || 0, Number(a.y) || 0);
      let clicked = null;
      if (a.click) {
        ubPulse();
        const el = document.elementFromPoint(ubCX, ubCY);
        if (el) { el.click(); clicked = el.tagName.toLowerCase(); }
      }
      reply({ ok: true, data: { x: ubCX, y: ubCY, clicked, viewport: { w: innerWidth, h: innerHeight } } });
    } else if (msg.cmd === "cursor_sel") {
      const el = await findElResilient(a.selector);
      if (!el) return reply({ ok: false, error: "NOTFOUND: " + a.selector });
      const freshCs = await elCenterFresh(a.selector);
      if (!freshCs.el) return reply({ ok: false, error: "NOTFOUND após scroll: " + a.selector });
      await ubGlide(freshCs.p.x, freshCs.p.y);
      let clicked = null;
      if (a.click) { ubPulse(); freshCs.el.click(); clicked = freshCs.el.tagName.toLowerCase(); }
      await ubSettle({ timeout: 3000 });
      reply({ ok: true, data: { x: freshCs.p.x, y: freshCs.p.y, clicked } });
    } else if (msg.cmd === "fill") {
      const el = await findElResilient(a.selector);
      if (!el) return reply({ ok: false, error: "NOTFOUND: " + a.selector });
      el.scrollIntoView({ block: "center" });
      try { const fv = await elCenterFresh(a.selector); await ubGlide(fv.p.x, fv.p.y); } catch {} // visual
      ubPulse();
      el.focus();
      el.value = "";
      el.dispatchEvent(new Event("input", { bubbles: true }));
      document.execCommand("insertText", false, String(a.text ?? ""));
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      if (a.submit) {
        el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
        const f = el.form;
        if (f) f.submit();
      }
      await ubSettle({ timeout: 3000 });
      reply({ ok: true, data: { filled: a.selector, title: document.title, url: location.href } });
    } else if (msg.cmd === "type") {
      const el = await findElResilient(a.selector);
      if (!el) return reply({ ok: false, error: "NOTFOUND: " + a.selector });
      el.scrollIntoView({ block: "center" });
      try { const fv = await elCenterFresh(a.selector); await ubGlide(fv.p.x, fv.p.y); } catch {} // visual
      ubPulse();
      el.focus();
      try {
        const len = (el.value || "").length;
        if (typeof el.setSelectionRange === "function") el.setSelectionRange(len, len);
      } catch {}
      document.execCommand("insertText", false, String(a.text ?? ""));
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      await ubSettle({ timeout: 3000 });
      reply({ ok: true, data: { filled: a.selector, title: document.title, url: location.href } });
    } else if (msg.cmd === "select") {
      const el = await findElResilient(a.selector);
      if (!el) return reply({ ok: false, error: "NOTFOUND: " + a.selector });
      if ((el.tagName || "").toLowerCase() !== "select")
        return reply({ ok: false, error: "NOTSELECT: " + a.selector });
      const opts = [...el.options];
      let target = null;
      if (a.value !== undefined && a.value !== null && String(a.value).length) {
        const vv = String(a.value);
        target =
          opts.find((o) => o.value === vv) ||
          opts.find((o) => ((o.value || "") + "").toLowerCase() === vv.toLowerCase()) ||
          null;
      }
      if (!target && a.text !== undefined && a.text !== null && String(a.text).length) {
        const t = String(a.text).toLowerCase();
        target =
          opts.find((o) => (((o.text || o.textContent || "") + "").toLowerCase().includes(t))) || null;
      }
      if (!target)
        return reply({ ok: false, error: "NOTFOUND option: " + (a.value ?? a.text ?? "") });
      el.value = target.value;
      el.selectedIndex = opts.indexOf(target);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      await ubSettle({ timeout: 3000 });
      reply({ ok: true, data: { selected: el.value } });
    } else if (msg.cmd === "highlight") {
      let el = null;
      if (a.selector) el = findEl(a.selector);
      else if (a.x !== undefined && a.y !== undefined)
        el = document.elementFromPoint(Number(a.x) || 0, Number(a.y) || 0);
      if (!el) return reply({ ok: false, error: "NOTFOUND: " + (a.selector ?? (a.x + "," + a.y)) });
      const prevOutline = el.style.outline;
      const prevBoxShadow = el.style.boxShadow;
      el.style.outline = "3px solid #f97316";
      el.style.boxShadow = "0 0 0 4px rgba(249,115,22,.35)";
      setTimeout(() => {
        try { el.style.outline = prevOutline; el.style.boxShadow = prevBoxShadow; } catch {}
      }, 1200);
      reply({ ok: true, data: { highlighted: true } });
    } else if (msg.cmd === "settle") {
      const t = Math.min(Math.max(Number(a.timeoutMs) || 3000, 500), 10000);
      await ubSettle({ timeout: t });
      reply({ ok: true, data: { settled: true } });
    } else if (msg.cmd === "waittext") {
      const needle = String(a.text ?? "").toLowerCase();
      if (!needle) return reply({ ok: false, error: "texto vazio" });
      const timeoutMs = Math.min(Math.max(Number(a.timeoutMs) || 8000, 100), 20000);
      const hay = () => ((document.body ? document.body.innerText : "") + "").toLowerCase().includes(needle);
      if (hay()) { reply({ ok: true, data: { found: true, text: a.text } }); return; }
      const found = await new Promise((resolve) => {
        let done = false;
        let obs = null;
        const to = setTimeout(() => {
          if (!done) { done = true; try { obs && obs.disconnect(); } catch {} resolve(false); }
        }, timeoutMs);
        obs = new MutationObserver(() => {
          if (hay() && !done) { done = true; clearTimeout(to); try { obs.disconnect(); } catch {} resolve(true); }
        });
        try {
          obs.observe(document.body || document.documentElement, { childList: true, subtree: true, characterData: true });
        } catch {
          clearTimeout(to);
          resolve(hay());
        }
      });
      if (found) reply({ ok: true, data: { found: true, text: a.text } });
      else reply({ ok: false, error: "texto não apareceu em " + Math.round(timeoutMs / 1000) + "s" });
    } else if (msg.cmd === "press") {
      const key = a.key || "Enter";
      for (const t of ["keydown", "keyup"])
        document.activeElement?.dispatchEvent(new KeyboardEvent(t, { key, bubbles: true }));
      reply({ ok: true, data: { pressed: key } });
    } else if (msg.cmd === "scroll") {
      const dir = a.direction || "down";
      if (a.selector) findEl(a.selector)?.scrollIntoView({ block: "center" });
      else if (dir === "top") scrollTo(0, 0);
      else if (dir === "bottom") scrollTo(0, document.body.scrollHeight);
      else if (dir === "up") scrollBy(0, -innerHeight * 0.8);
      else scrollBy(0, innerHeight * 0.8);
      reply({ ok: true, data: { scrolled: dir, y: scrollY } });
    } else if (msg.cmd === "evaluate") {
      // Isolado (não sujeito à CSP da página como o MAIN). Distingue CSP vs seletor vs erro JS.
      // Protocolo: {ok:true, data:{value}} espelha background tab.evaluate; erro {ok:false, error:PREFIXO: ...}.
      try {
        const code = a.js ?? a.code ?? a.expr;
        const sel = a.selector;
        let scopeEl = null;
        if (sel) {
          let syntaxOk = true;
          try {
            if (!String(sel).startsWith("text=")) document.querySelector(String(sel));
          } catch (e) {
            syntaxOk = false;
            reply({ ok: false, error: "SELECTOR_ERROR: seletor inválido \"" + String(sel).slice(0, 120) + "\" (" + String((e && e.message) || e).slice(0, 150) + ")" });
            return;
          }
          if (syntaxOk) {
            try { scopeEl = findEl(sel); }
            catch (e) { reply({ ok: false, error: "SELECTOR_ERROR: " + String((e && e.message) || e).slice(0, 200) }); return; }
            if (!scopeEl) { reply({ ok: false, error: "NOTFOUND: " + sel + " (seletor válido, sem match — verifique seletor/página carregada)" }); return; }
          }
          if (code === undefined || code === null || String(code).trim() === "") {
            const t = (((scopeEl.innerText || scopeEl.value || "") + "").replace(/\s+/g, " ").trim().slice(0, 4000));
            reply({ ok: true, data: { value: t, tag: (scopeEl.tagName || "").toLowerCase() } });
            return;
          }
        }
        if (code === undefined || code === null || String(code).trim() === "") {
          reply({ ok: false, error: "EVAL_EMPTY: js vazio — passe a.js com a expressão (termine com o valor desejado)" });
          return;
        }
        let fn = null;
        try {
          fn = new Function("el", '"use strict"; return (' + String(code) + "\n);");
        } catch (e) {
          if (ubIsCSPError(e)) reply({ ok: false, error: "CSP_BLOCKED: eval/new Function bloqueado (" + String((e && e.message) || e).slice(0, 200) + ") — use seletor/snapshot/html em vez de JS arbitrário" });
          else reply({ ok: false, error: "EVAL_ERROR (sintaxe): " + String((e && e.message) || e).slice(0, 300) });
          return;
        }
        let val;
        try {
          val = fn(scopeEl);
          if (val && typeof val.then === "function") val = await val;
        } catch (e) {
          if (ubIsCSPError(e)) reply({ ok: false, error: "CSP_BLOCKED: execução bloqueada (" + String((e && e.message) || e).slice(0, 200) + ") — use seletor/snapshot/html" });
          else reply({ ok: false, error: "EVAL_ERROR: " + String((e && e.message) || e).slice(0, 300) });
          return;
        }
        if (typeof val === "undefined") { reply({ ok: true, data: { value: null, note: "expressão não retornou valor — termine o JS com o valor desejado" } }); return; }
        if (val === null) { reply({ ok: true, data: { value: null, note: "resultado null — seletor pode não ter casado ou JS retornou null (verifique seletor)" } }); return; }
        let out = val;
        try { out = JSON.parse(JSON.stringify(val)); }
        catch { out = String(val).slice(0, 4000); }
        if (typeof out === "string") out = out.slice(0, 4000);
        reply({ ok: true, data: { value: out } });
      } catch (e) {
        if (ubIsCSPError(e)) reply({ ok: false, error: "CSP_BLOCKED: " + String((e && e.message) || e).slice(0, 250) });
        else reply({ ok: false, error: "EVAL_ERROR: " + String((e && e.message) || e).slice(0, 300) });
      }
    } else {
      reply({ ok: false, error: "cmd desconhecido no content: " + msg.cmd });
    }
  })();
  return true; // resposta assíncrona
})(__ubN));
