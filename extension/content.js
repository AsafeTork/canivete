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
  // cadeia shadow "shadow:[...]" (snapshot marca itens dentro de web components).
  if (String(sel).startsWith("shadow:")) {
    try { return ubFindByShadowChain(JSON.parse(String(sel).slice(7))); } catch { return null; }
  }
  if (sel.startsWith("text=")) {
    const t = sel.slice(5).toLowerCase();
    const hit =
      ubShadowQueryAll('a,button,input,select,textarea,[role="button"],[role="link"]').find((e) =>
        ((e.innerText || e.value || "") + "").toLowerCase().includes(t)
      ) ||
      // linhas de lista (WhatsApp etc.): divs clicáveis sem role
      ubShadowQueryAll('div[data-testid="cell-frame-container"],div[data-testid^="list-item-"],div[role="listitem"],div[role="row"]').find((e) =>
        ((e.innerText || "") + "").toLowerCase().includes(t)
      );
    if (hit) return hit;
    // #48: fallback amplo — qualquer elemento visível com o texto (menor primeiro).
    // text= é intenção explícita; falhar tudo era pior que clicar o melhor candidato.
    try {
      const cands = ubShadowQueryAll("*").filter((e) => {
        try {
          const tag = ((e.tagName || "").toLowerCase());
          if (/^(script|style|noscript|template|head|meta|link|html|body)$/.test(tag)) return false;
          const txt = ((e.innerText || "") + "").toLowerCase();
          if (!txt || !txt.includes(t)) return false;
          // visível? (offsetParent null = oculto; fixed conta como visível)
          try {
            const st = window.getComputedStyle ? window.getComputedStyle(e) : null;
            if (st && (st.display === "none" || st.visibility === "hidden")) return false;
          } catch {}
          return true;
        } catch { return false; }
      }).slice(0, 400);
      cands.sort((x, y) => (((x.innerText || "").length || 0) - ((y.innerText || "").length || 0)));
      if (cands.length) return cands[0];
    } catch {}
    return null;
  }
  try {
    const el = document.querySelector(sel);
    if (el) return el;
  } catch { return null; }
  // fallback perfurante p/ seletores simples dentro de shadow.
  try {
    const found = ubShadowQueryAll(sel);
    if (found.length) return found[0];
  } catch {}
  return null;
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
// Delta pós-ação (Deltawright-lite): arma observer ANTES da ação, settle, coleta o net
// {added, removed, attrs, txts}. O agente vê O QUE MUDOU sem re-snapshot (economiza 1 call).
// Bounded: 60 registros, attrs só significativos (classe/style ruído fora), textos capados.
var UB_DELTA_ATTRS = null;
function ubDeltaAttrs() {
  if (!UB_DELTA_ATTRS) {
    try { UB_DELTA_ATTRS = new Set(["value", "checked", "selected", "disabled", "open", "hidden", "href", "src", "title", "placeholder", "aria-expanded", "aria-selected", "aria-checked", "aria-hidden", "role"]); }
    catch { UB_DELTA_ATTRS = { has: () => false }; }
  }
  return UB_DELTA_ATTRS;
}
function ubDeltaArm() {
  const seen = [];
  let obs = null;
  try {
    obs = new MutationObserver((muts) => {
      for (const m of muts) {
        if (seen.length > 60) break;
        try {
          if (m.type === "childList") {
            for (const n of (m.addedNodes || [])) {
              if (!n || n.nodeType !== 1) continue;
              const t = (((n.innerText || n.textContent || "") + "").replace(/\s+/g, " ").trim().slice(0, 80));
              // toast-like (role/status, aria-live, classes toast): destaque no stop().
              let toast = 0;
              try {
                const role = (n.getAttribute && n.getAttribute("role")) || "";
                if (/^(status|alert|log|marquee|timer)$/i.test(role)) toast = 1;
                else if (n.getAttribute && n.getAttribute("aria-live")) toast = 1;
                else {
                  const cl = (typeof n.className === "string" ? n.className : "") + " " + (n.id || "");
                  if (/toast|snackbar|notification|alert(?!dialog)|flash|banner-/i.test(cl)) toast = 1;
                }
              } catch {}
              seen.push({ k: "add", tag: ((n.tagName || "?") + "").toLowerCase(), t, toast });
            }
            for (const n of (m.removedNodes || [])) {
              if (!n || n.nodeType !== 1) continue;
              seen.push({ k: "del", tag: ((n.tagName || "?") + "").toLowerCase() });
            }
          } else if (m.type === "characterData") {
            const t = (((m.target && m.target.textContent) || "") + "").replace(/\s+/g, " ").trim().slice(0, 80);
            if (t) seen.push({ k: "txt", t });
          } else if (m.type === "attributes") {
            const at = String(m.attributeName || "").toLowerCase();
            if (ubDeltaAttrs().has(at)) seen.push({ k: "attr", at });
          }
        } catch {}
      }
    });
    obs.observe(document.documentElement || document, { childList: true, subtree: true, characterData: true, attributes: true });
  } catch {}
  return {
    async stop() {
      try { await ubSettle({ timeout: 1500, quiet: 250 }); } catch {}
      try { obs && obs.disconnect(); } catch {}
      const added = [];
      const transients = [];
      let removed = 0, attrs = 0, txts = 0;
      for (const s of seen) {
        if (s.k === "add" && added.length < 10) {
          added.push((s.tag || "?") + (s.t ? ' "' + s.t.slice(0, 60) + '"' : ""));
          // aviso efêmero (toast/snackbar/aria-live): texto vai em destaque p/ o agente ver na hora.
          if (s.toast && transients.length < 5 && s.t) transients.push(s.t.slice(0, 160));
        }
        else if (s.k === "del") removed++;
        else if (s.k === "attr") attrs++;
        else if (s.k === "txt") txts++;
      }
      return { added, removed, attrs, txts, total: seen.length, ...(transients.length ? { transients } : {}) };
    },
  };
}
// UB_EPHEM_PURE_START — transientes + offscreen (leitura pura, sem efeitos; testável via node).
// ubEphemMatch: candidato a transitório (toast/snackbar/aria-live/role=status|alert).
// ubEphemDiff: apareceu/sumiu entre varreduras. ubFpOf/ubFindByFp: re-resolve por
// texto/papel quando a lista virtualizada recicla o nó. ubVanishClassify: ONDE foi parar.
// Só function declarations (eval-safe); try/catch em tudo; nunca lança exceção.
function ubEphemRole(el) {
  try {
    const r = el.getAttribute && el.getAttribute("role");
    if (r && String(r).trim()) return String(r).trim().split(/\s+/)[0].toLowerCase();
  } catch {}
  try {
    if (((el.tagName || "") + "").toLowerCase() === "output") return "status";
  } catch {}
  return "";
}
function ubEphemMatch(el) {
  try {
    if (!el) return false;
    let role = "";
    try { role = ubEphemRole(el); } catch { role = ""; }
    if (role === "status" || role === "alert" || role === "log" || role === "marquee" || role === "timer") return true;
    try {
      const live = el.getAttribute && el.getAttribute("aria-live");
      if (live && /polite|assertive/i.test(String(live))) return true;
    } catch {}
    try {
      const hint = ((typeof el.className === "string" ? el.className : "") + " " + (el.id || "")).toLowerCase();
      if (/toast|snackbar|snack-bar|notification-toast|flash-message|alert-banner/i.test(hint)) return true;
    } catch {}
    try {
      const dt = el.getAttribute && el.getAttribute("data-testid");
      if (dt && /toast|snackbar|notification|alert/i.test(String(dt))) return true;
    } catch {}
    return false;
  } catch { return false; }
}
function ubEphemText(el) {
  try {
    if (!el) return "";
    const t = (((el.innerText || el.textContent || el.value) || "") + "").replace(/\s+/g, " ").trim();
    return t.slice(0, 200);
  } catch { return ""; }
}
function ubEphemKey(el) {
  try {
    if (!el) return "";
    let kind = "";
    try { kind = ubEphemRole(el) || ""; } catch {}
    if (!kind) {
      try {
        const live = el.getAttribute && el.getAttribute("aria-live");
        kind = live ? "live-" + String(live).toLowerCase() : "transient";
      } catch { kind = "transient"; }
    }
    const tag = ((el.tagName || "?") + "").toLowerCase();
    const t = ubEphemText(el).slice(0, 60).toLowerCase();
    return kind + "|" + tag + "|" + t;
  } catch { return ""; }
}
function ubEphemDiff(before, after) {
  try {
    const keyOf = (n) => { try { return String((n && n.key) || ""); } catch { return ""; } };
    const b = new Set((Array.isArray(before) ? before : []).map(keyOf).filter(Boolean));
    const a = new Set((Array.isArray(after) ? after : []).map(keyOf).filter(Boolean));
    const appeared = (Array.isArray(after) ? after : []).filter((n) => { try { return !b.has(keyOf(n)); } catch { return false; } }).slice(0, 10);
    const disappeared = (Array.isArray(before) ? before : []).filter((n) => { try { return !a.has(keyOf(n)); } catch { return false; } }).slice(0, 10);
    return { appeared, disappeared };
  } catch { return { appeared: [], disappeared: [] }; }
}
function ubFpOf(sel, el) {
  try {
    let text = "", role = "", tag = "";
    try { tag = ((el && el.tagName) || "").toLowerCase(); } catch {}
    try { role = ubEphemRole(el); } catch {}
    try { text = ubEphemText(el).slice(0, 60); } catch {}
    if (!text && typeof sel === "string" && sel.startsWith("text=")) text = sel.slice(5).slice(0, 60);
    return { sel: String(sel || ""), text, role, tag };
  } catch { return { sel: String(sel || ""), text: "", role: "", tag: "" }; }
}
function ubFpMatchEl(fp, el) {
  try {
    if (!fp || !el) return false;
    const needle = String((fp && fp.text) || "").toLowerCase().trim();
    if (needle && needle.length >= 2) {
      let hay = "";
      try { hay = (((el.innerText || el.textContent || el.value) || "") + "").toLowerCase(); } catch {}
      if (!hay || hay.indexOf(needle.slice(0, 30)) < 0) return false;
      if (fp.role) {
        let r = "";
        try { r = ubEphemRole(el); } catch {}
        if (r && r !== String(fp.role).toLowerCase() && r !== "generic") return false;
      }
      return true;
    }
    if (fp.role) {
      try { return ubEphemRole(el) === String(fp.role).toLowerCase(); } catch { return false; }
    }
    return false;
  } catch { return false; }
}
function ubFindByFp(fp, list) {
  try {
    if (!fp || !Array.isArray(list) || !list.length) return null;
    let best = null, bestLen = Infinity;
    for (const el of list.slice(0, 400)) {
      try {
        if (!ubFpMatchEl(fp, el)) continue;
        const len = (((el.innerText || el.textContent || "") + "").length || 0);
        if (len < bestLen) { best = el; bestLen = len; }
      } catch {}
    }
    return best;
  } catch { return null; }
}
function ubVanishClassify(info) {
  try {
    info = info || {};
    if (info.found && info.inViewport && info.hasBox) return { where: "visible", hint: "" };
    if (!info.everFound) return { where: "never-found", hint: "seletor nunca casou — confira snapshot/aba" };
    if (!info.connected) return { where: "removed", hint: "saiu do DOM (lista reciclou, toast expirou ou SPA re-renderizou) — re-snapshot" };
    if (info.displayNone || info.visibilityHidden) return { where: "hidden", hint: "está no DOM mas oculto (display:none/visibility:hidden) — mostre/expanda antes" };
    if (!info.hasBox) return { where: "zero-box", hint: "box zerado (colapsado ou ainda hidratando) — settle/waittext e tente de novo" };
    if (!info.inViewport) return { where: "scrolled-out", hint: "fora da viewport — scroll até o alvo e re-snapshot" };
    return { where: "unknown", hint: "re-snapshot e tente de novo" };
  } catch { return { where: "unknown", hint: "" }; }
}
// UB_EPHEM_PURE_END
var UB_LAST_FP = null; // fingerprint do último alvo resolvido (re-resolve pós-reciclagem)
var UB_RESOLVE_DIAG = null; // {attempts, outcome} da última resolução (ok|moved|recycled|not-found)
function ubFingerprintCapture(sel, el) {
  try { UB_LAST_FP = ubFpOf(sel, el); } catch {}
  return UB_LAST_FP;
}
// Re-resolve por texto/papel no DOM vivo (lista virtualizada recicla nós: o seletor
// antigo pode casar outro nó ou nada, mas o texto/papel identifica o item real).
function ubFindByFingerprintLive(fp) {
  try {
    if (!fp || (!fp.text && !fp.role)) return null;
    return ubFindByFp(fp, ubShadowQueryAll("*").slice(0, 400));
  } catch { return null; }
}
// ONDE foi parar o alvo? Distingue removed (saiu do DOM) vs hidden (oculto) vs
// scrolled-out (fora da viewport) vs recycled (nó trocado, texto vive noutro nó)
// vs never-found. Nunca lança exceção.
function ubDiagnoseVanish(sel) {
  try {
    let fp = null;
    try {
      if (UB_LAST_FP && (!sel || UB_LAST_FP.sel === sel)) fp = UB_LAST_FP;
      else if (sel && String(sel).startsWith("text=")) fp = ubFpOf(sel, null);
    } catch {}
    if (!fp || (!fp.text && !fp.role)) return ubVanishClassify({ everFound: false });
    let cand = null;
    try { cand = ubFindByFingerprintLive(fp); } catch { cand = null; }
    if (cand) {
      const info = { everFound: true, connected: true, found: true, hasBox: false, inViewport: false, displayNone: false, visibilityHidden: false };
      try {
        let disp = "", vis = "";
        try {
          const g = (typeof window !== "undefined" && window.getComputedStyle) ? window.getComputedStyle : (typeof getComputedStyle === "function" ? getComputedStyle : null);
          const cs = g ? g(cand) : null;
          disp = cs ? String(cs.display || "") : "";
          vis = cs ? String(cs.visibility || "") : "";
        } catch {}
        info.displayNone = disp === "none";
        info.visibilityHidden = vis === "hidden" || vis === "collapse";
        const r = cand.getBoundingClientRect ? cand.getBoundingClientRect() : null;
        info.hasBox = !!(r && r.width > 0 && r.height > 0);
        info.inViewport = !!(r && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth);
      } catch {}
      const c = ubVanishClassify(info);
      if (c.where === "visible") return { where: "recycled", hint: "nó reciclado pela lista virtualizada (texto ainda existe noutro nó) — re-snapshot e use a ref nova" };
      return c;
    }
    return ubVanishClassify({ everFound: true, connected: false });
  } catch { return { where: "unknown", hint: "" }; }
}
function ubNotFoundError(sel, stage) {
  try {
    const d = ubDiagnoseVanish(sel);
    const where = d && d.where ? " (" + d.where + ")" : "";
    const hint = d && d.hint ? " — " + d.hint : "";
    const st = stage ? " " + stage : "";
    return "NOTFOUND" + where + st + ": " + sel + hint;
  } catch { return "NOTFOUND: " + sel; }
}
function ubResolveNote(fresh) {
  try {
    if (!fresh) return {};
    if (fresh.recycled) return { resolve: "recycled" };
    if (fresh.moved) return { resolve: "moved" };
    if (UB_RESOLVE_DIAG && UB_RESOLVE_DIAG.outcome && UB_RESOLVE_DIAG.outcome !== "ok") return { resolve: UB_RESOLVE_DIAG.outcome };
    return {};
  } catch { return {}; }
}
// Resiliência viewport virtualizada: até 3 tentativas; após scrollIntoView
// re-mede E verifica visível (box não-zero, na viewport); se o nó foi reciclado,
// re-resolve por texto/papel em vez de segurar referência morta. Compat: retorna
// el ou null (diagnóstico em UB_RESOLVE_DIAG + ubNotFoundError no caller).
async function findElResilient(sel) {
  try {
    let first = null;
    try { first = findEl(sel); } catch { first = null; }
    if (first) { try { ubFingerprintCapture(sel, first); } catch {} }
    let last = first, outcome = first ? "ok" : "not-found";
    for (let i = 0; i < 3; i++) {
      let el = null;
      try { el = (i === 0) ? first : findEl(sel); } catch { el = null; }
      if (!el && UB_LAST_FP) {
        try {
          const f = ubFindByFingerprintLive(UB_LAST_FP);
          if (f) { el = f; outcome = "recycled"; }
        } catch {}
      }
      if (!el) {
        outcome = (outcome === "recycled") ? "recycled" : "not-found";
        try { window.scrollBy(0, 1); } catch {}
        try { await ubSleep(300); } catch {}
        continue;
      }
      try { el.scrollIntoView({ block: "center" }); } catch {}
      try { await ubSettle({ timeout: 800, quiet: 120 }); } catch { try { await ubSleep(300); } catch {} }
      let re = null;
      try { re = findEl(sel); } catch { re = null; }
      if (!re && UB_LAST_FP) {
        try {
          const f2 = ubFindByFingerprintLive(UB_LAST_FP);
          if (f2) { re = f2; outcome = "recycled"; }
        } catch {}
      }
      if (!re) { try { re = (el && el.isConnected) ? el : null; } catch { re = null; } }
      if (!re) { outcome = "recycled"; last = null; continue; }
      last = re;
      try { ubFingerprintCapture(sel, re); } catch {}
      let p = null;
      try { p = elRect(re); } catch { p = null; }
      if (p && elCenterValid(p, innerWidth, innerHeight)) {
        if (outcome !== "recycled") outcome = (i > 0) ? "moved" : "ok";
        break;
      }
      outcome = (outcome === "recycled") ? "recycled" : "moved";
    }
    try { UB_RESOLVE_DIAG = { attempts: 3, outcome }; } catch {}
    return last;
  } catch { try { return findEl(sel); } catch { return null; } }
}

// ---- cursor INDEPENDENTE (overlay roxo: não rouba o mouse do dono) ----
// PERSISTENTE: registrado via scripting.registerContentScripts (toda página http/https,
// desde o document_start) + posição salva em chrome.storage.session → sobrevive a F5/navegação.
var ubCursor = (typeof ubCursor !== "undefined" && ubCursor) || null, ubCX = 0, ubCY = 0; // var: preserva overlay em reinjeção
var UB_VERIFY = (typeof UB_VERIFY !== "undefined" && UB_VERIFY) || null; // var: janela de verificação p/ clique trusted (verify_arm/stop)
var UB_V = "13"; // anti-dupla-injeção: var + listener só-responde-mais-novo (hot-update seguro)
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
// Sequência sintética COMPLETA (fallback do remoto): mouseover→mousedown→mouseup→click
// como MouseEvents com view/coords — dispara listeners nativos E React (só isTrusted difere).
// Retorna a tag clicada ou null.
function ubSynthClick(el, x, y) {
  if (!el) return null;
  try {
    const cx = Math.round(x !== undefined ? x : (elRect(el).x || 0));
    const cy = Math.round(y !== undefined ? y : (elRect(el).y || 0));
    const init = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, button: 0, buttons: 1 };
    try { el.dispatchEvent(new MouseEvent("mouseover", { ...init, buttons: 0 })); } catch {}
    try { el.dispatchEvent(new MouseEvent("mousedown", init)); } catch {}
    try { el.dispatchEvent(new MouseEvent("mouseup", { ...init, buttons: 0 })); } catch {}
    try { el.dispatchEvent(new MouseEvent("click", { ...init, buttons: 0 })); } catch {}
    try { if (typeof el.click === "function") el.click(); } catch {}
    return (el.tagName || "?").toLowerCase();
  } catch { return null; }
}
// Descreve elemento p/ relatorio de cobertura: tag + identificador + texto curto.
// Pura: so le o no, sem efeitos. Nunca lanca excecao.
function ubDescribeEl(el) {
  try {
    if (!el) return "?";
    const tag = ((el.tagName || "?") + "").toLowerCase();
    let extra = "";
    try {
      const dt = el.getAttribute && el.getAttribute("data-testid");
      if (dt) extra += '[data-testid="' + String(dt).slice(0, 40) + '"]';
      else if (el.id) extra += "#" + String(el.id).slice(0, 30);
      else if (typeof el.className === "string" && el.className.trim()) extra += "." + el.className.trim().split(/\s+/)[0].slice(0, 30);
    } catch {}
    let txt = "";
    try {
      const al = el.getAttribute && el.getAttribute("aria-label");
      txt = ((el.innerText || el.value || al || "") + "").replace(/\s+/g, " ").trim().slice(0, 60);
    } catch {}
    return tag + extra + (txt ? ' "' + txt + '"' : "");
  } catch { return "?"; }
}
// Pre-clique: quem esta VISIVEL no ponto (x,y)? Usa elementsFromPoint e ignora
// camadas que nao interceptam (pointer-events:none) + overlay do proprio cursor.
// Retorna covered=true + cover (descricao) quando um estranho tapa o alvo.
// childHit=true quando o topmost e FILHO do alvo (ex: avatar dentro da linha do
// chat: clicar ali abre perfil, nao o chat). Puro-DOM, sem efeitos.
function ubTopmostCover(target, x, y) {
  try {
    const px = Math.round(Number(x) || 0), py = Math.round(Number(y) || 0);
    let stack = [];
    try {
      if (document && typeof document.elementsFromPoint === "function") stack = document.elementsFromPoint(px, py) || [];
      else if (document && typeof document.elementFromPoint === "function") {
        const one = document.elementFromPoint(px, py);
        stack = one ? [one] : [];
      }
    } catch { stack = []; }
    try {
      stack = stack.filter((el) => {
        try {
          if (!el) return false;
          if (el.id === "ubrowser-cursor" || el.id === "ubrowser-kf") return false;
          if (el.getAttribute && el.getAttribute("data-ub-shadow") === "1") return false;
          let pe = "";
          try { pe = (window.getComputedStyle(el) || {}).pointerEvents || ""; }
          catch { try { pe = (getComputedStyle(el) || {}).pointerEvents || ""; } catch {} }
          if (pe === "none") return false;
          return true;
        } catch { return true; }
      });
    } catch {}
    const top = stack.length ? stack[0] : null;
    if (!top) return { covered: false, cover: null, childHit: false, top: null };
    try { if (top === target) return { covered: false, cover: null, childHit: false, top: ubDescribeEl(top) }; } catch {}
    try {
      if (target && target.contains && target.contains(top))
        return { covered: false, cover: null, childHit: true, child: ubDescribeEl(top), top: ubDescribeEl(top) };
    } catch {}
    try {
      if (top.contains && target && top.contains(target))
        return { covered: false, cover: null, childHit: false, top: ubDescribeEl(top) };
    } catch {}
    return { covered: true, cover: ubDescribeEl(top), top: ubDescribeEl(top) };
  } catch { return { covered: false, cover: null, childHit: false, top: null }; }
}
// Hover antes do clique (menus e linhas que exigem estado :hover). Opt-in via
// a.hover no comando. Retorna promessa que nunca rejeita.
function ubHoverBeforeClick(el, x, y, ms) {
  try {
    if (!el) return Promise.resolve(false);
    const wait = Math.min(Math.max(Number(ms) || 300, 0), 1500);
    const cx = Math.round(Number(x) || 0), cy = Math.round(Number(y) || 0);
    const init = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, button: 0, buttons: 0 };
    try { el.dispatchEvent(new MouseEvent("mouseover", init)); } catch {}
    try { el.dispatchEvent(new MouseEvent("mouseenter", init)); } catch {}
    try { el.dispatchEvent(new MouseEvent("mousemove", init)); } catch {}
    return ubSleep(wait).then(() => true);
  } catch { return Promise.resolve(false); }
}
// Verificacao pos-clique. PURA e testavel: algo mudou entre before e after?
// before e after sao objetos com url, title e state. delta e a saida de ubDeltaArm.
// Retorna verified mais a lista whatChanged com a causa url, title, state ou dom.
function ubClickVerifyResult(before, after, delta) {
  try {
    const whatChanged = [];
    try {
      const bu = String((before && before.url) || ""), au = String((after && after.url) || "");
      if (bu && au && bu !== au) whatChanged.push("url");
    } catch {}
    try {
      const bt = String((before && before.title) || ""), at = String((after && after.title) || "");
      if (bt && at && bt !== at) whatChanged.push("title");
    } catch {}
    try {
      const bs = String((before && before.state) || ""), as = String((after && after.state) || "");
      if (bs !== as) whatChanged.push("state");
    } catch {}
    try {
      if (delta && typeof delta === "object") {
        if (Array.isArray(delta.added) && delta.added.length) whatChanged.push("dom+" + delta.added.length);
        else if (Number(delta.total) > 0) whatChanged.push("dom");
        else {
          if (Number(delta.removed) > 0) whatChanged.push("dom-del");
          if (Number(delta.txts) > 0) whatChanged.push("text");
          if (Number(delta.attrs) > 0) whatChanged.push("attr");
        }
      }
    } catch {}
    return { verified: whatChanged.length > 0, whatChanged };
  } catch { return { verified: false, whatChanged: [] }; }
}
// Escalada final no content: duplo-clique sintetico (linhas que so abrem com dblclick).
function ubSynthDblClick(el, x, y) {
  try {
    if (!el) return null;
    const cx = Math.round(x !== undefined ? x : 0), cy = Math.round(y !== undefined ? y : 0);
    const init = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, button: 0, buttons: 1 };
    const up = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, button: 0, buttons: 0 };
    try { el.dispatchEvent(new MouseEvent("mousedown", init)); } catch {}
    try { el.dispatchEvent(new MouseEvent("mouseup", up)); } catch {}
    try { el.dispatchEvent(new MouseEvent("click", { ...up, detail: 1 })); } catch {}
    try { el.dispatchEvent(new MouseEvent("mousedown", { ...init, detail: 2 })); } catch {}
    try { el.dispatchEvent(new MouseEvent("mouseup", { ...up, detail: 2 })); } catch {}
    try { el.dispatchEvent(new MouseEvent("click", { ...up, detail: 2 })); } catch {}
    try { el.dispatchEvent(new MouseEvent("dblclick", { ...up, detail: 2 })); } catch {}
    return (el.tagName || "?").toLowerCase();
  } catch { return null; }
}
// Orquestra sintetico + verificacao + duplo-clique (sem trusted: trusted vive no
// background via CDP; aqui sinalizamos needsTrusted). Retorna clickedTag, delta
// mesclado, verified, whatChanged, method e needsTrusted. Nunca lanca excecao.
async function ubClickWithVerify(tgt, x, y, opts) {
  try {
    opts = opts || {};
    const px = Math.round(Number(x) || 0), py = Math.round(Number(y) || 0);
    let before = null;
    try { before = { url: location.href, title: document.title, state: ubElementState(tgt) }; }
    catch { before = { url: "", title: "", state: "" }; }
    const dl = ubDeltaArm();
    const tag = ubSynthClick(tgt, px, py);
    const d = await dl.stop();
    let after = null;
    try { after = { url: location.href, title: document.title, state: (tgt.isConnected ? ubElementState(tgt) : before.state) }; }
    catch { after = before; }
    let v = null;
    try { v = ubClickVerifyResult(before, after, d); } catch { v = { verified: false, whatChanged: [] }; }
    if (v.verified || opts.noEscalate) {
      return { clickedTag: tag, delta: d, verified: !!v.verified, whatChanged: v.whatChanged || [], method: "synthetic", needsTrusted: !v.verified };
    }
    try {
      const dl2 = ubDeltaArm();
      ubSynthDblClick(tgt, px, py);
      const d2 = await dl2.stop();
      let after2 = null;
      try { after2 = { url: location.href, title: document.title, state: (tgt.isConnected ? ubElementState(tgt) : before.state) }; }
      catch { after2 = after; }
      const merged = {
        added: [...(d.added || []), ...(d2.added || [])].slice(0, 10),
        removed: (d.removed || 0) + (d2.removed || 0),
        attrs: (d.attrs || 0) + (d2.attrs || 0),
        txts: (d.txts || 0) + (d2.txts || 0),
        total: (d.total || 0) + (d2.total || 0),
      };
      let vAll = null;
      try { vAll = ubClickVerifyResult(before, after2, merged); } catch { vAll = { verified: false, whatChanged: [] }; }
      return { clickedTag: tag, delta: merged, verified: !!vAll.verified, whatChanged: vAll.whatChanged || [], method: "synthetic+dblclick", needsTrusted: !vAll.verified };
    } catch {
      return { clickedTag: tag, delta: d, verified: false, whatChanged: [], method: "synthetic+dblclick", needsTrusted: true };
    }
  } catch { return { clickedTag: null, delta: null, verified: false, whatChanged: [], method: "synthetic", needsTrusted: false }; }
}
// mede DEPOIS do scroll assentar + re-query (lista virtualizada recicla nós) +
// verifica visível (box não-zero, na viewport); re-resolve por texto/papel quando
// o nó morre; até 3 tentativas. Retorna {el, p} + {attempts, recycled, moved}
// (aditivo — callers antigos leem só el/p). Nunca lança exceção.
async function elCenterFresh(sel, tries = 3) {
  let el = null, p = null, recycled = false, moved = false, attempts = 0, prevC = null;
  try {
    const n = Math.min(Math.max(Number(tries) || 3, 1), 5);
    for (let i = 0; i < n; i++) {
      attempts = i + 1;
      try { el = findEl(sel); } catch { el = null; }
      if (!el && UB_LAST_FP) {
        try {
          const f = ubFindByFingerprintLive(UB_LAST_FP);
          if (f) { el = f; recycled = true; }
        } catch {}
      }
      if (!el) { p = null; recycled = true; continue; }
      try { el.scrollIntoView({ block: "center" }); } catch {}
      try { await ubSettle({ timeout: 800, quiet: 120 }); } catch { try { await ubSleep(200); } catch {} }
      let re = null;
      try { re = findEl(sel); } catch { re = null; }
      if (!re && UB_LAST_FP) {
        try {
          const f2 = ubFindByFingerprintLive(UB_LAST_FP);
          if (f2) { re = f2; recycled = true; }
        } catch {}
      }
      if (!re) { try { re = (el && el.isConnected) ? el : null; } catch { re = null; } }
      if (!re) { el = null; p = null; recycled = true; continue; }
      if (re !== el) recycled = true;
      el = re;
      try { ubFingerprintCapture(sel, el); } catch {}
      try { p = elRect(el); } catch { p = null; }
      if (p && prevC && Math.hypot(p.x - prevC.x, p.y - prevC.y) > 50) moved = true;
      if (p && elCenterValid(p, innerWidth, innerHeight)) return { el, p, attempts, recycled, moved };
      prevC = (p && Number.isFinite(p.x)) ? { x: p.x, y: p.y } : prevC;
    }
  } catch {}
  return { el, p, attempts, recycled, moved };
}
// Varredura viva de transientes (toast/snackbar/aria-live/role=status|alert).
// Pura-leitura, teto 20 nós, textos capados. Nunca lança exceção.
function ubEphemScanLive() {
  const out = [];
  try {
    const doc = (typeof document !== "undefined") ? document : null;
    if (!doc || !doc.querySelectorAll) return out;
    let list = [];
    try { list = ubShadowQueryAll('[role="status"],[role="alert"],[role="log"],[aria-live],.toast,.snackbar,.snack-bar,[data-testid*="toast"],[data-testid*="snack"]'); } catch { list = []; }
    for (const nd of list.slice(0, 20)) {
      try {
        if (!ubEphemMatch(nd)) continue;
        const t = ubEphemText(nd);
        if (!t) continue;
        let kind = "";
        try { kind = ubEphemRole(nd) || ((nd.getAttribute && nd.getAttribute("aria-live")) ? "live" : "transient"); } catch { kind = "transient"; }
        const item = { key: ubEphemKey(nd), kind, text: t.slice(0, 120) };
        try {
          const r = nd.getBoundingClientRect ? nd.getBoundingClientRect() : null;
          if (r && r.width > 0 && r.height > 0) { item.x = Math.round(r.left + r.width / 2); item.y = Math.round(r.top + r.height / 2); }
        } catch {}
        out.push(item);
        if (out.length >= 20) break;
      } catch {}
    }
  } catch {}
  return out;
}
// Pesca transientes: fast-poll (~200ms, até ~3s, teto 15 iterações) observando nós
// de vida curta. Retorna {appeared, disappeared, samples, durationMs} com texto
// curto (teto 10+10). Nunca lança exceção.
async function ubCatchup({ intervalMs = 200, durationMs = 3000 } = {}) {
  try {
    const iv = Math.min(Math.max(Number(intervalMs) || 200, 100), 1000);
    const du = Math.min(Math.max(Number(durationMs) || 3000, 500), 5000);
    const seen = new Map();
    let first = [];
    try {
      first = ubEphemScanLive();
      for (const nd of first) { try { if (!seen.has(nd.key)) seen.set(nd.key, nd); } catch {} }
    } catch {}
    const base = new Set(first.map((nd) => { try { return String(nd.key); } catch { return ""; } }).filter(Boolean));
    const t0 = Date.now();
    const steps = Math.min(Math.ceil(du / iv), 15);
    let last = first;
    for (let i = 0; i < steps; i++) {
      try { await ubSleep(iv); } catch {}
      try {
        last = ubEphemScanLive();
        for (const nd of last) { try { if (!seen.has(nd.key)) seen.set(nd.key, nd); } catch {} }
      } catch {}
      if (Date.now() - t0 >= du) break;
    }
    const now = new Set((Array.isArray(last) ? last : []).map((nd) => { try { return String(nd.key); } catch { return ""; } }).filter(Boolean));
    const appeared = [...seen.values()].filter((nd) => { try { return !base.has(String(nd.key)); } catch { return false; } }).slice(0, 10);
    const disappeared = [...seen.values()].filter((nd) => { try { return !now.has(String(nd.key)); } catch { return false; } }).slice(0, 10);
    return { appeared, disappeared, samples: seen.size, durationMs: Date.now() - t0 };
  } catch { return { appeared: [], disappeared: [], samples: 0, durationMs: 0 }; }
}
// ---- estética + expect pós-ação v12 (bounded; puras onde dá; nunca lançam) ----
// ubParseColor: "#rgb|#rrggbb|rgb()|rgba()|transparent" → {r,g,b,a} | null. Pura.
function ubParseColor(s) {
  try {
    const t = String(s || "").trim().toLowerCase();
    if (!t) return null;
    if (t === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
    let m = t.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
    if (m) {
      let h = m[1];
      if (h.length === 3) h = h.split("").map((c) => c + c).join("");
      return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
    }
    m = t.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/);
    if (m) {
      return {
        r: Math.min(255, Math.max(0, Number(m[1]) || 0)),
        g: Math.min(255, Math.max(0, Number(m[2]) || 0)),
        b: Math.min(255, Math.max(0, Number(m[3]) || 0)),
        a: (m[4] === undefined ? 1 : Math.min(1, Math.max(0, Number(m[4])))),
      };
    }
    return null;
  } catch { return null; }
}
// ubRelLum: luminância relativa WCAG de {r,g,b} (0..1). Pura.
function ubRelLum(c) {
  try {
    const f = (v) => {
      const s = Math.min(255, Math.max(0, Number(v) || 0)) / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  } catch { return 0; }
}
// ubContrastRatio: fg x bg (strings CSS) → razão WCAG (1..21) | null se inválidas.
// bg translúcido: mistura sobre branco (página típica) p/ razão conservadora. Pura.
function ubContrastRatio(fg, bg) {
  try {
    const a = ubParseColor(fg), b = ubParseColor(bg);
    if (!a || !b) return null;
    let br = b.r, bg2 = b.g, bb = b.b;
    try {
      const ba = (typeof b.a === "number" ? b.a : 1);
      if (ba < 1) { br = b.r * ba + 255 * (1 - ba); bg2 = b.g * ba + 255 * (1 - ba); bb = b.b * ba + 255 * (1 - ba); }
    } catch {}
    const L1 = ubRelLum(a), L2 = ubRelLum({ r: br, g: bg2, b: bb });
    const hi = Math.max(L1, L2), lo = Math.min(L1, L2);
    return (hi + 0.05) / (lo + 0.05);
  } catch { return null; }
}
// ubEffBg: fundo opaco mais próximo (caminha ≤6 ancestrais; default branco). Bounded.
function ubEffBg(el) {
  try {
    let n = el, guard = 0;
    const g = (typeof window !== "undefined" && window.getComputedStyle) ? window.getComputedStyle : (typeof getComputedStyle === "function" ? getComputedStyle : null);
    while (n && guard++ < 6) {
      try {
        const cs = g ? g(n) : null;
        const bg = cs ? cs.backgroundColor : "";
        const p = ubParseColor(bg);
        if (p && (p.a === undefined || p.a >= 0.95)) return bg;
      } catch {}
      try { n = n.parentElement; } catch { break; }
      if (!n || n.nodeType !== 1) break;
    }
  } catch {}
  return "rgb(255, 255, 255)";
}
// ubBoxesOverlap: interseção útil de {x,y,w,h} (área >25px² ignora encosto de borda). Pura.
function ubBoxesOverlap(a, b) {
  try {
    const ax = Number(a.x) || 0, ay = Number(a.y) || 0, aw = Number(a.w) || 0, ah = Number(a.h) || 0;
    const bx = Number(b.x) || 0, by = Number(b.y) || 0, bw = Number(b.w) || 0, bh = Number(b.h) || 0;
    if (aw <= 0 || ah <= 0 || bw <= 0 || bh <= 0) return false;
    const ix = Math.min(ax + aw, bx + bw) - Math.max(ax, bx);
    const iy = Math.min(ay + ah, by + bh) - Math.max(ay, by);
    if (ix <= 0 || iy <= 0) return false;
    return (ix * iy) > 25;
  } catch { return false; }
}
// ubAestheticScore: 100 − deduções (tetos por categoria), clamp 0..100. Pura.
function ubAestheticScore(c) {
  try {
    let s = 100;
    s -= Math.min(30, (Number(c.lowContrast) || 0) * 4);
    s -= Math.min(24, (Number(c.smallTargets) || 0) * 3);
    s -= Math.min(25, (Number(c.overflowing) || 0) * 5);
    s -= Math.min(25, (Number(c.overlapping) || 0) * 5);
    s -= Math.min(12, Math.max(0, (Number(c.fontFams) || 0) - 4) * 3);
    s -= Math.min(12, Math.max(0, (Number(c.fontSizes) || 0) - 6) * 2);
    return Math.min(100, Math.max(0, Math.round(s)));
  } catch { return 50; }
}
// ubAestheticVerdict: monta {score, issues≤12, stats} de linhas puras
// rows=[{sel,text,fg,bg,fam,size,tag,role,onclick,box:{x,y,w,h}}], vw=largura viewport.
// Pura (sem DOM): testável via node com linhas falsas. Nunca lança.
function ubAestheticVerdict(rows, vw) {
  try {
    const issues = [];
    const push = (kind, where, detail) => {
      try { if (issues.length < 12) issues.push({ kind, where: String(where || "?").slice(0, 80), detail: String(detail || "").slice(0, 140) }); } catch {}
    };
    const list = Array.isArray(rows) ? rows.slice(0, 80) : [];
    const w = Math.max(320, Number(vw) || 1280);
    const fams = {}, sizes = {};
    let lowContrast = 0, smallTargets = 0, overflowing = 0;
    const isInteractive = (r) => {
      try {
        const t = String(r.tag || "").toLowerCase(), ro = String(r.role || "").toLowerCase();
        return t === "a" || t === "button" || t === "input" || t === "select" || t === "textarea" || ro === "button" || ro === "link" || !!r.onclick;
      } catch { return false; }
    };
    for (const r of list) {
      try {
        if (r.fam) fams[String(r.fam).slice(0, 40)] = 1;
        if (r.size) sizes[String(r.size).slice(0, 12)] = 1;
      } catch {}
      try {
        if (r.text && String(r.text).trim()) {
          const ratio = ubContrastRatio(r.fg, r.bg);
          if (ratio !== null && ratio < 4.5) {
            lowContrast++;
            push("contrast", r.sel, "ratio " + ratio.toFixed(2) + " < 4.5 em \"" + String(r.text).slice(0, 50) + "\"");
          }
        }
      } catch {}
      try {
        const b = r.box || {};
        if (isInteractive(r) && (Number(b.w) < 24 || Number(b.h) < 24)) {
          smallTargets++;
          push("tap-target", r.sel, Math.round(Number(b.w) || 0) + "x" + Math.round(Number(b.h) || 0) + "px < 24px");
        }
      } catch {}
      try {
        const b = r.box || {};
        if ((Number(b.x) || 0) + (Number(b.w) || 0) > w + 1) {
          overflowing++;
          push("overflow-x", r.sel, "right " + Math.round((Number(b.x) || 0) + (Number(b.w) || 0)) + "px > viewport " + Math.round(w) + "px");
        }
      } catch {}
    }
    let overlapping = 0;
    try {
      const boxes = list.filter(isInteractive).slice(0, 40);
      for (let i = 0; i < boxes.length && issues.length < 12; i++) {
        for (let j = i + 1; j < boxes.length && issues.length < 12; j++) {
          try {
            if (ubBoxesOverlap(boxes[i].box || {}, boxes[j].box || {})) {
              overlapping++;
              push("overlap", boxes[i].sel, "sobrepõe " + String(boxes[j].sel || "?").slice(0, 60));
            }
          } catch {}
        }
      }
    } catch {}
    const nF = Object.keys(fams).length, nS = Object.keys(sizes).length;
    try { if (nF > 4) push("fonts", "page", nF + " font-families (ideal ≤4): " + Object.keys(fams).slice(0, 6).join(", ").slice(0, 100)); } catch {}
    try { if (nS > 6) push("font-sizes", "page", nS + " tamanhos (ideal ≤6)"); } catch {}
    const counts = { lowContrast, smallTargets, overflowing, overlapping, fontFams: nF, fontSizes: nS };
    return { score: ubAestheticScore(counts), issues, stats: { sampled: list.length, ...counts } };
  } catch { return { score: 50, issues: [], stats: { sampled: 0 } }; }
}
// ubWhere: selector curto p/ issues (teto 80). Nunca lança.
function ubWhere(el) {
  try {
    const s = ubSimpleSel(el);
    return String(s || (el && el.tagName) || "?").slice(0, 80);
  } catch { try { return String((el && el.tagName) || "?").toLowerCase().slice(0, 80); } catch { return "?"; } }
}
// ubAesthetic: coleta bounded (amostra ≤80, 1 getComputedStyle por nó) + veredito.
// Pula nós da própria extensão (cursor). Nunca lança.
function ubAesthetic() {
  try {
    let pool = [];
    try { pool = ubShadowQueryAll("p,h1,h2,h3,h4,h5,h6,a,button,input,select,textarea,img,li,span,[role=\"button\"],[role=\"link\"]").slice(0, 400); } catch { pool = []; }
    const vw = (typeof window !== "undefined" && window.innerWidth) || 1280;
    let g = null;
    try { g = (typeof window !== "undefined" && window.getComputedStyle) ? window.getComputedStyle : (typeof getComputedStyle === "function" ? getComputedStyle : null); } catch {}
    const rows = [];
    for (const el of pool) {
      try {
        if (rows.length >= 80) break;
        if (!el || el.id === "ubrowser-cursor" || el.id === "ubrowser-kf") continue;
        const r = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
        if (!r || !(r.width > 0) || !(r.height > 0)) continue;
        const cs = g ? g(el) : null;
        if (!cs) continue;
        let text = "";
        try { text = (((el.innerText || el.textContent) || "") + "").replace(/\s+/g, " ").trim().slice(0, 60); } catch {}
        let fam = "", size = "";
        try {
          fam = String((cs.fontFamily || "").split(",")[0] || "").replace(/["']/g, "").trim().toLowerCase().slice(0, 40) || "unknown";
          size = String(cs.fontSize || "").trim().slice(0, 12) || "?";
        } catch {}
        let role = "";
        try { role = String((el.getAttribute && el.getAttribute("role")) || "").trim().split(/\s+/)[0].toLowerCase(); } catch {}
        let onclick = false;
        try { onclick = !!(el.hasAttribute && el.hasAttribute("onclick")); } catch {}
        rows.push({
          sel: ubWhere(el), text, fg: cs.color || "", bg: ubEffBg(el), fam, size,
          tag: ((el.tagName || "") + "").toLowerCase(), role, onclick,
          box: { x: r.left, y: r.top, w: r.width, h: r.height },
        });
      } catch {}
    }
    return ubAestheticVerdict(rows, vw);
  } catch { return { score: 50, issues: [], stats: { sampled: 0 } }; }
}
// ubExpectCheck: asserts pós-ação (expectUrl/expectText/expectGone), 1 checagem cada.
// Chamado APÓS o settle do caller (delta.stop / settle trusted). Nunca lança.
function ubExpectCheck(o) {
  try {
    const checks = [];
    o = o || {};
    try {
      if (o.expectUrl !== undefined && o.expectUrl !== null && String(o.expectUrl) !== "") {
        const want = String(o.expectUrl);
        const href = (typeof location !== "undefined" && location.href) ? String(location.href) : "";
        const ok = href.includes(want);
        checks.push({ name: "expectUrl", ok, detail: ok ? ("url contém \"" + want.slice(0, 80) + "\"") : ("url \"" + href.slice(0, 120) + "\" sem \"" + want.slice(0, 80) + "\"") });
      }
    } catch {}
    try {
      if (o.expectText !== undefined && o.expectText !== null && String(o.expectText) !== "") {
        const want = String(o.expectText);
        let hay = "";
        try { hay = (((document && document.body && document.body.innerText) || "") + "").toLowerCase(); } catch {}
        const ok = !!hay && hay.includes(want.toLowerCase());
        checks.push({ name: "expectText", ok, detail: ok ? ("texto contém \"" + want.slice(0, 80) + "\"") : ("texto sem \"" + want.slice(0, 80) + "\"") });
      }
    } catch {}
    try {
      if (o.expectGone !== undefined && o.expectGone !== null && String(o.expectGone) !== "") {
        const sel = String(o.expectGone);
        let el = null;
        try { el = findEl(sel); } catch { el = null; }
        const ok = !el;
        checks.push({ name: "expectGone", ok, detail: ok ? ("\"" + sel.slice(0, 80) + "\" sumiu") : ("\"" + sel.slice(0, 80) + "\" ainda presente") });
      }
    } catch {}
    let passed = true;
    try { passed = checks.every((c) => { try { return !!c.ok; } catch { return false; } }); } catch { passed = false; }
    return { passed, checks };
  } catch { return { passed: false, checks: [] }; }
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
// Accessible name na ordem: aria-label → img alt → text → value → placeholder → title.
// (#42: alt entra antes do texto p/ logos/imagens ganharem nome no snapshot.)
function ubAccessibleName(el, text) {
  try {
    const al = el.getAttribute && el.getAttribute("aria-label");
    if (al && String(al).trim()) return String(al).replace(/\s+/g, " ").trim().slice(0, 60);
  } catch {}
  try {
    if (el && (el.tagName || "").toLowerCase() === "img" && el.getAttribute) {
      const alt = el.getAttribute("alt");
      if (alt && String(alt).trim()) return String(alt).replace(/\s+/g, " ").trim().slice(0, 60);
    }
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
  // #42: img com src mas sem alt (logo sem alt é comum) — basename como nome,
  // só se tiver corpo visível (>16px; tracking pixel 1x1 continua junk).
  try {
    if (el && (el.tagName || "").toLowerCase() === "img" && el.getAttribute) {
      const src = el.getAttribute("src") || el.currentSrc || el.src || "";
      const w = Number(el.width) || 0, h = Number(el.height) || 0;
      if (src && w > 16 && h > 16) {
        const base = String(src).split("?")[0].split("/").pop().slice(0, 40) || "img";
        return "[img " + base + "]";
      }
    }
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

// UB_LAYERS_PURE_START — overlay/layer awareness v11 (puro-DOM, sem efeitos; testável via node).
// ubLayerOf: contexto de stacking por item (modal/menu/popover/tooltip via ancestral).
// ubOverlayState: dialog/menu aberto bloqueando a página. ubTooltipText/Nodes: fontes de tooltip.
// Só function declarations (eval-safe); try/catch em tudo; nunca lança exceção.
function ubLayerKindFromRole(role) {
  try {
    const r = String(role || "").trim().toLowerCase();
    if (!r) return "";
    if (r === "dialog" || r === "alertdialog") return "modal";
    if (r === "menu" || r === "menubar" || r === "listbox") return "menu";
    if (r === "tooltip") return "tooltip";
    return "";
  } catch { return ""; }
}
function ubLayerLabel(box) {
  try {
    if (!box) return "";
    try {
      const al = box.getAttribute && box.getAttribute("aria-label");
      if (al && String(al).trim()) return String(al).replace(/\s+/g, " ").trim().slice(0, 80);
    } catch {}
    try {
      const lb = box.getAttribute && box.getAttribute("aria-labelledby");
      const doc = (typeof document !== "undefined") ? document : null;
      if (lb && doc && doc.getElementById) {
        const parts = [];
        for (const id of String(lb).split(/\s+/).slice(0, 3)) {
          try {
            const t = doc.getElementById(id);
            if (t) parts.push((((t.innerText || t.textContent) || "") + "").replace(/\s+/g, " ").trim());
          } catch {}
        }
        const s = parts.join(" ").trim().slice(0, 80);
        if (s) return s;
      }
    } catch {}
    try {
      const ti = box.getAttribute && box.getAttribute("title");
      if (ti && String(ti).trim()) return String(ti).replace(/\s+/g, " ").trim().slice(0, 80);
    } catch {}
    try {
      const t = (((box.textContent || box.innerText) || "") + "").replace(/\s+/g, " ").trim().slice(0, 80);
      if (t) return t;
    } catch {}
    return "";
  } catch { return ""; }
}
function ubLayerOf(el) {
  try {
    if (!el) return null;
    let n = el, guard = 0;
    while (n && guard++ < 10) {
      try {
        const tag = (((n.tagName || "") + "").toLowerCase());
        if (tag === "body" || tag === "html") break;
        let role = "";
        try { role = String((n.getAttribute && n.getAttribute("role")) || "").trim().split(/\s+/)[0].toLowerCase(); } catch {}
        const kind = ubLayerKindFromRole(role);
        if (kind) return { layer: kind, label: ubLayerLabel(n) };
        try { if (n.getAttribute && n.getAttribute("aria-modal") === "true") return { layer: "modal", label: ubLayerLabel(n) }; } catch {}
        try { if (tag === "dialog" && n.hasAttribute && n.hasAttribute("open")) return { layer: "modal", label: ubLayerLabel(n) }; } catch {}
        try {
          if (n.hasAttribute && n.hasAttribute("popover")) {
            let isOpen = false;
            try { isOpen = n.matches ? n.matches(":popover-open") : false; } catch {}
            if (!isOpen) {
              try { const r = n.getBoundingClientRect ? n.getBoundingClientRect() : null; isOpen = !!(r && r.width > 0 && r.height > 0); } catch {}
            }
            if (isOpen) return { layer: "popover", label: ubLayerLabel(n) };
          }
        } catch {}
        try {
          if (n.hasAttribute && (n.hasAttribute("data-radix-popper-content") || n.hasAttribute("data-tippy-root") || n.hasAttribute("data-tooltip-content")))
            return { layer: "popover", label: ubLayerLabel(n) };
        } catch {}
        try {
          const hint = ((typeof n.className === "string" ? n.className : "") + " " + (n.id || ""));
          const m = hint.match(/modal|dialog|popover|dropdown|tooltip|toast|sheet|drawer|menu/i);
          if (m) {
            let pos = "";
            try {
              const g = (typeof window !== "undefined" && window.getComputedStyle) ? window.getComputedStyle : (typeof getComputedStyle === "function" ? getComputedStyle : null);
              const cs = g ? g(n) : null;
              pos = cs ? String(cs.position || "").toLowerCase() : "";
            } catch {}
            if (pos === "fixed" || pos === "absolute" || pos === "sticky") {
              const w = m[0].toLowerCase();
              const layer = /tooltip/.test(w) ? "tooltip" : (/menu|dropdown/.test(w) ? "menu" : (/popover|toast/.test(w) ? "popover" : "modal"));
              return { layer, label: ubLayerLabel(n) };
            }
          }
        } catch {}
      } catch {}
      try { n = n.parentElement; } catch { break; }
      if (!n || n.nodeType !== 1) break;
    }
  } catch {}
  return null;
}
function ubLayerMark(el) {
  try {
    const hit = ubLayerOf(el);
    if (!hit || !hit.layer) return {};
    const out = { layer: hit.layer };
    if (hit.label) out.layerLabel = String(hit.label).slice(0, 80);
    return out;
  } catch { return {}; }
}
function ubOverlayState() {
  try {
    const doc = (typeof document !== "undefined") ? document : null;
    if (!doc || !doc.querySelectorAll) return { open: false, kind: "", label: "", count: 0 };
    let cands = [];
    try { cands = [...doc.querySelectorAll('dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"], [role="menu"], [role="listbox"], [popover], [data-radix-popper-content]')].slice(0, 30); } catch { cands = []; }
    let best = null, count = 0;
    for (const el of cands) {
      try {
        let vis = false;
        try { const r = el.getBoundingClientRect ? el.getBoundingClientRect() : null; vis = !!(r && r.width > 0 && r.height > 0); } catch {}
        if (!vis) {
          try { vis = !!(((el.tagName || "") + "").toLowerCase() === "dialog" && el.hasAttribute && el.hasAttribute("open")); } catch {}
        }
        if (!vis) continue;
        let hit = null;
        try { hit = ubLayerOf(el); } catch { hit = null; }
        const kind = (hit && hit.layer) || "modal";
        if (kind === "tooltip") continue; // tooltip não bloqueia a página
        count++;
        if (!best) best = { kind, label: (hit && hit.label) || ubLayerLabel(el) };
        else if (best.kind !== "modal" && kind === "modal") best = { kind, label: (hit && hit.label) || ubLayerLabel(el) };
      } catch {}
    }
    if (!best) return { open: false, kind: "", label: "", count: 0 };
    return { open: true, kind: best.kind, label: best.label || "", count };
  } catch { return { open: false, kind: "", label: "", count: 0 }; }
}
function ubTooltipText(el) {
  try {
    if (!el) return { text: null, source: "" };
    const pick = (v) => { const s = String(v ?? "").replace(/\s+/g, " ").trim(); return s ? s.slice(0, 300) : ""; };
    try {
      const g = (n) => { try { return el.getAttribute ? el.getAttribute(n) : null; } catch { return null; } };
      let t = pick(g("data-tippy-content"));
      if (t) return { text: t, source: "data-tippy-content" };
      t = pick(g("data-tooltip"));
      if (t) return { text: t, source: "data-tooltip" };
      t = pick(g("data-title"));
      if (t) return { text: t, source: "data-title" };
      t = pick(g("title"));
      if (t) return { text: t, source: "title" };
      const db = g("aria-describedby");
      const doc = (typeof document !== "undefined") ? document : null;
      if (db && doc && doc.getElementById) {
        for (const id of String(db).split(/\s+/).slice(0, 3)) {
          try {
            const ref = doc.getElementById(id);
            if (ref) {
              const tt = pick(ref.innerText || ref.textContent);
              if (tt) return { text: tt, source: "aria-describedby" };
            }
          } catch {}
        }
      }
    } catch {}
    return { text: null, source: "" };
  } catch { return { text: null, source: "" }; }
}
function ubTooltipNodes() {
  const out = [];
  try {
    const doc = (typeof document !== "undefined") ? document : null;
    if (!doc || !doc.querySelectorAll) return out;
    let list = [];
    try { list = [...doc.querySelectorAll('[role="tooltip"], .tooltip, .tippy-box, [data-tippy-root], [data-tooltip-content]')].slice(0, 15); } catch { list = []; }
    for (const n of list) {
      try {
        let vis = false, x = 0, y = 0;
        try {
          const r = n.getBoundingClientRect ? n.getBoundingClientRect() : null;
          if (r && r.width > 0 && r.height > 0) { vis = true; x = Math.round(r.left + r.width / 2); y = Math.round(r.top + r.height / 2); }
        } catch {}
        if (!vis) continue;
        const t = ((((n.innerText || n.textContent) || "") + "").replace(/\s+/g, " ").trim().slice(0, 300));
        if (!t) continue;
        out.push({ text: t, x, y });
        if (out.length >= 10) break;
      } catch {}
    }
  } catch {}
  return out;
}
// UB_LAYERS_PURE_END

// ---- snapshot virtualizado: coleta incremental com scroll (WhatsApp etc.) ----
// Coleta crua (sem ref — ref é atribuído só no final p/ refs estáveis após dedup).
// Teto coleta: hard cap 120 elementos (fatia cedo, antes de sort/dedup) — alivia CPU/RAM no DOM gigante.
// needBox=false: pula getBoundingClientRect (força layout/sync) na varredura; box é
// preenchido LAZY só p/ itens finais via ubFillBoxLazy (até 120 medidas, não páginas*120).
// ---- shadow DOM aberto: todo querySelector puro é cego dentro de web components.
// ubAllRoots: document + shadow roots abertos (BFS, teto 60 roots / 4000 nós).
// ubShadowQueryAll: mesma query em todos os roots, dedup por identidade.
// Cadeia shadow p/ interação: item dentro de shadow ganha selector "shadow:[s1,s2,leaf]".
function ubAllRoots() {
  const roots = [document];
  let stack = [];
  try { stack = [...(document.documentElement ? document.documentElement.children : [])]; } catch {}
  let guard = 0;
  while (stack.length && guard++ < 4000) {
    const el = stack.pop();
    let kids = [];
    try { kids = [...(el.children || [])]; } catch { continue; }
    for (const k of kids) {
      stack.push(k);
      try {
        if (k.shadowRoot) {
          if (roots.length < 60) roots.push(k.shadowRoot);
          try { for (const sk of (k.shadowRoot.children || [])) stack.push(sk); } catch {}
        }
      } catch {}
    }
  }
  return roots;
}
function ubShadowQueryAll(sel) {
  const out = [];
  const seen = (typeof Set !== "undefined") ? new Set() : null;
  const has = (el) => { try { return seen ? seen.has(el) : out.indexOf(el) >= 0; } catch { return false; } };
  const add = (el) => { try { if (seen) seen.add(el); } catch {} out.push(el); };
  for (const r of ubAllRoots()) {
    let found = [];
    try { found = [...(r.querySelectorAll ? r.querySelectorAll(sel) : [])]; } catch { continue; }
    for (const el of found) { if (!has(el)) add(el); }
    if (out.length >= 2000) break;
  }
  return out;
}
function ubSimpleSel(el) {
  try {
    const tag = ((el.tagName || "").toLowerCase()) || "*";
    if (el.id) return "#" + CSS.escape(el.id);
    const dt = el.getAttribute && el.getAttribute("data-testid");
    if (dt) return tag + '[data-testid="' + String(dt).slice(0, 60) + '"]';
    const cl = (el.className && typeof el.className === "string" ? el.className.split(/\s+/).filter(Boolean).slice(0, 2) : []).map((c) => "." + CSS.escape(c)).join("");
    if (cl) return tag + cl;
    return tag;
  } catch { return "*"; }
}
// cadeia [hostSel..., leafSel] se el está dentro de shadow; null se light DOM.
function ubShadowChain(el) {
  try {
    const chain = [];
    let node = el, guard = 0;
    while (node && guard++ < 6) {
      const root = node.getRootNode ? node.getRootNode() : document;
      if (!root || root === document) break;
      const host = root.host;
      if (!host) break;
      chain.unshift(ubSimpleSel(host));
      node = host;
    }
    if (!chain.length) return null;
    chain.push(ubSimpleSel(el));
    return chain;
  } catch { return null; }
}
function ubFindByShadowChain(chain) {
  try {
    if (!Array.isArray(chain) || !chain.length) return null;
    let scope = document;
    for (let i = 0; i < chain.length; i++) {
      const el = scope.querySelector ? scope.querySelector(chain[i]) : null;
      if (!el) return null;
      if (i < chain.length - 1) {
        scope = el.shadowRoot;
        if (!scope) return null;
      } else return el;
    }
  } catch {}
  return null;
}
// profundidade composta (atravessa shadow hosts); teto 20.
function ubDepth(el) {
  try {
    let d = 0, n = el, guard = 0;
    while (n && n !== document && n !== document.documentElement && guard++ < 40) {
      d++;
      const root = n.getRootNode ? n.getRootNode() : null;
      if (root && root !== document && root.host) n = root.host;
      else n = n.parentElement;
    }
    return Math.min(d, 20);
  } catch { return 0; }
}
// clone perfurado: cloneNode NÃO copia shadow — serializa shadow aberto p/ dentro
// de <div data-ub-shadow> (recursivo, teto 25). Leitores (distill/read) enxergam tudo.
function ubClonePierced(node, depth = 0) {
  if (!node || depth > 25) return null;
  let c = null;
  try { c = node.cloneNode(false); } catch { return null; }
  if (!c) return null;
  try {
    for (const n of (node.childNodes || [])) {
      if (n.nodeType === 3) { try { c.appendChild(n.cloneNode(false)); } catch {} }
      else if (n.nodeType === 1) { const k = ubClonePierced(n, depth + 1); if (k) { try { c.appendChild(k); } catch {} } }
    }
  } catch {}
  try {
    const sr = node.shadowRoot;
    if (sr) {
      const marker = document.createElement("div");
      try { marker.setAttribute("data-ub-shadow", "1"); } catch {}
      for (const n of (sr.childNodes || [])) {
        if (n.nodeType === 3) { try { marker.appendChild(n.cloneNode(false)); } catch {} }
        else if (n.nodeType === 1) { const k = ubClonePierced(n, depth + 1); if (k) { try { marker.appendChild(k); } catch {} } }
      }
      try { c.appendChild(marker); } catch {}
    }
  } catch {}
  return c;
}
function ubSnapshotCollectRaw(limit = 120, needBox = true) {
  const cap = Math.min(Math.max(Number(limit) || 120, 10), 120);
  // perfura shadow DOM aberto: interativos dentro de web components aparecem (antes: invisíveis).
  const els = ubShadowQueryAll('a,button,input,select,textarea,h1,h2,h3,h4,h5,h6,[role="button"],[role="link"],[role="listitem"],[role="row"],div[data-testid="cell-frame-container"],div[data-testid^="list-item-"],[onclick]').slice(0, cap);
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
      selector: (() => {
        try {
          const ch = ubShadowChain(el);
          if (ch) return "shadow:" + JSON.stringify(ch);
          return cssPath(el);
        } catch { try { return cssPath(el); } catch { return ""; } }
      })(),
      depth: ubDepth(el),
      // v11 layers: contexto de overlay por item (só adiciona chaves quando há camada — 0 bytes fora dela).
      ...(() => { try { return ubLayerMark(el); } catch { return {}; } })(),
      ...(() => {
        try {
          if (tag === "a") {
            const h = el.href || (el.getAttribute && el.getAttribute("href")) || "";
            if (h && !/^javascript:/i.test(h)) return { href: String(h).slice(0, 120) };
          }
        } catch {}
        return {};
      })(),
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
  // settle antes da 1ª coleta: snapshot de SPA recém-navegada vinha vazio/parcial.
  try { await ubSettle({ timeout: 1200, quiet: 200 }); } catch {}
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
    let clone = null;
    try { clone = ubClonePierced(root); } catch { clone = null; }
    if (!clone) clone = root.cloneNode(true);
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

// Outline: só estrutura (h1-h6 + landmarks + contagens) — triagem de página em ~1k chars.
function ubOutline() {
  const lines = [];
  const seen = new Set();
  let heads = [];
  try { heads = ubShadowQueryAll("h1,h2,h3,h4,h5,h6"); } catch { heads = []; }
  for (const h of heads.slice(0, 80)) {
    const t = (((h.textContent || "") + "").replace(/\s+/g, " ").trim().slice(0, 100));
    if (!t) continue;
    const lvl = Math.min(Math.max(Number(((h.tagName || "h2") + "").slice(1)) || 2, 1), 6);
    const k = lvl + ":" + t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    lines.push("#".repeat(lvl) + " " + t);
  }
  let links = 0, btns = 0, fields = 0;
  try {
    const all = ubShadowQueryAll("a,button,input,select,textarea");
    for (const el of all) {
      const tg = ((el.tagName || "") + "").toLowerCase();
      if (tg === "a") links++;
      else if (tg === "button") btns++;
      else fields++;
    }
  } catch {}
  lines.push(`[${links} links · ${btns} botões · ${fields} campos]`);
  const markdown = lines.join("\n").slice(0, 4000);
  return { title: document.title, url: location.href, markdown, stats: { linhas: lines.length, headings: seen.size, links, botoes: btns, campos: fields, chars: markdown.length, outline: true } };
}
// ---- distill: texto enxuto e desduplicado (opera em CLONE, nunca na página real) ----
function ubDistill(maxChars = 4000) {
  const cap = Math.min(Math.max(Number(maxChars) || 4000, 200), 12000);
  // clone perfurado: shadow DOM aberto entra no clone (cloneNode puro perderia web components).
  let clone = null;
  try { clone = ubClonePierced(document.documentElement); } catch { clone = null; }
  if (!clone) { try { clone = document.documentElement.cloneNode(true); } catch { return { title: document.title, url: location.href, markdown: "", stats: { linhas: 0, descartadas: 0, chars: 0 } }; } }
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
      const ph = ((el.getAttribute("placeholder") || el.getAttribute("aria-label") || "") + "").replace(/\s+/g, " ").trim();
      // #41: value SEPARADO do placeholder — dá p/ distinguir preenchido de vazio.
      let val = "";
      try {
        if (tag === "select") {
          const sel = el.selectedOptions && el.selectedOptions[0];
          val = ((sel && (sel.text || sel.value)) || el.value || "");
        } else if (tipo === "checkbox" || tipo === "radio") {
          val = el.checked ? "checked" : "unchecked";
        } else {
          val = (el.value || "");
        }
        val = String(val).replace(/\s+/g, " ").trim();
      } catch {}
      line = "[campo " + tipo + (ph ? " " + ph : "") + "]" + (val ? ' = "' + val.slice(0, 80) + '"' : "");
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

// ponte de alerta: mon-hook (MAIN) grita CustomEvent p/ erro; content repassa ao
// background (só isolated fala chrome.*) que empurra p/ bridge /ubpush. Fire-and-forget.
try {
  window.addEventListener("__ubMonAlert", (ev) => {
    try {
      const detail = (ev && ev.detail) || null;
      if (detail) chrome.runtime.sendMessage({ __ubMonAlert: detail });
    } catch {}
  });
} catch {}
chrome.runtime.onMessage.addListener(((myN) => (msg, _sender, reply) => {  if (myN !== globalThis.__ubLatestN) return; // injeção antiga: silenciosa (evita resposta dupla)
  (async () => {
    const a = msg.args || {};
    if (msg.cmd === "ping") { reply({ ok: true, data: { v: UB_V } }); return; }
    if (msg.cmd === "state") { reply({ ok: true, data: { title: document.title, url: location.href } }); return; }
    if (msg.cmd === "read") {
      // settle antes de coletar: SPA hidrata depois do idle; sem isso lê esqueleto (BulkMD: 60%→95%).
      try { await ubSettle({ timeout: 1500, quiet: 250 }); } catch {}
      if (a.outline) {
        const o = ubOutline();
        reply({ ok: true, data: o });
        return;
      }
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
      try { await ubSettle({ timeout: 1500, quiet: 250 }); } catch {}
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
      // v11: responde {ok:true, data:{items, overlay}} (overlay=open kinds modal/menu/popover;
      // background fatia items por offset/max). Itens carregam layer/layerLabel quando em overlay.
      // Args opcionais (todos retrocompatíveis): {pages (1-5, default 2), container (seletor), limit (hard cap 120), match}.
      // Com match: para cedo (não varre pages todas); data ganha {found, position}.
      try {
        const match = a.match ?? a.query ?? a.text ?? "";
        const data = await ubSnapshotVirtualized({ pages: a.pages, container: a.container, limit: 120, match });
        let overlay = null;
        try { overlay = ubOverlayState(); } catch { overlay = { open: false, kind: "", label: "", count: 0 }; }
        if (match && String(match).trim()) {
          const needle = String(match).toLowerCase();
          const pos = data.findIndex((it) => ((it.text || "").toLowerCase().includes(needle)));
          reply({ ok: true, data: { items: data, overlay, found: pos >= 0, position: pos } });
        } else {
          reply({ ok: true, data: { items: data, overlay } });
        }
      } catch (e) {
        // Fallback: coleta single-pass original (mesmo formato {items, overlay}).
        try {
          const fb = ubSnapshotCollectRaw(120).map((it, i) => ({ ref: i, ...it }));
          let overlayFb = null;
          try { overlayFb = ubOverlayState(); } catch { overlayFb = { open: false, kind: "", label: "", count: 0 }; }
          const matchFb = a.match ?? a.query ?? a.text ?? "";
          if (matchFb && String(matchFb).trim()) {
            const needleFb = String(matchFb).toLowerCase();
            const posFb = fb.findIndex((it) => ((it.text || "").toLowerCase().includes(needleFb)));
            reply({ ok: true, data: { items: fb, overlay: overlayFb, found: posFb >= 0, position: posFb } });
          } else {
            reply({ ok: true, data: { items: fb, overlay: overlayFb } });
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
      try {
        const el = await findElResilient(a.selector);
        if (!el) return reply({ ok: false, error: ubNotFoundError(a.selector) });
        const fresh = await elCenterFresh(a.selector);
        if (!fresh.el || !fresh.p) return reply({ ok: false, error: ubNotFoundError(a.selector, "após scroll") });
        const tgt = fresh.el || el;
        // (a) pré-clique: overlay por cima? reporta quem cobre em vez de clicar cego.
        let cover = null;
        try { cover = ubTopmostCover(tgt, fresh.p.x, fresh.p.y); } catch { cover = null; }
        if (cover && cover.covered && !a.force) {
          return reply({ ok: false, error: "COVERED por " + (cover.cover || "?") + " em (" + fresh.p.x + "," + fresh.p.y + ") — alvo: " + a.selector + " (force:true p/ clicar mesmo assim)" });
        }
        // (c) hover opt-in p/ menus e linhas que exigem estado :hover.
        if (a.hover) { try { await ubHoverBeforeClick(tgt, fresh.p.x, fresh.p.y, a.hoverMs); } catch {} }
        await ubGlide(fresh.p.x, fresh.p.y); // cursor desliza até o alvo antes de clicar
        ubPulse();
        // (b) sintético + verificação + duplo-clique; trusted é escalado no background.
        const r = await ubClickWithVerify(tgt, fresh.p.x, fresh.p.y, { noEscalate: a.noEscalate });
        // v12: asserts do caller (expectUrl/expectText/expectGone) pós-settle — delta.stop já assentou.
        let expClick = null;
        try { if (a.expectUrl || a.expectText || a.expectGone) expClick = ubExpectCheck(a); } catch { expClick = null; }
        reply({
          ok: true,
          data: {
            clicked: a.selector, x: fresh.p.x, y: fresh.p.y, title: document.title, url: location.href,
            delta: r.delta, verified: r.verified, whatChanged: r.whatChanged, method: r.method,
            ...(expClick ? { expect: expClick } : {}),
            ...ubResolveNote(fresh),
            ...(r.needsTrusted ? { needsTrusted: true } : {}),
            ...(cover && cover.childHit ? { childHit: cover.child } : {}),
          },
        });
      } catch (e) {
        try { reply({ ok: false, error: "CLICK_ERROR: " + String((e && e.message) || e).slice(0, 200) }); } catch {}
      }
    } else if (msg.cmd === "verify_arm") {
      // Arma a janela de verificação p/ clique trusted (dispatch via CDP no
      // background): captura antes + abre o delta. verify_stop coleta depois.
      try {
        let stEl = null;
        try {
          if (a.selector) stEl = findEl(a.selector);
          else if (a.x !== undefined && a.y !== undefined && document.elementFromPoint)
            stEl = document.elementFromPoint(Number(a.x) || 0, Number(a.y) || 0);
        } catch {}
        let st8 = "";
        try { st8 = stEl ? ubElementState(stEl) : ""; } catch {}
        UB_VERIFY = {
          before: { url: location.href, title: document.title, state: st8 },
          delta: ubDeltaArm(),
          el: stEl,
        };
        reply({ ok: true, data: { armed: true } });
      } catch (e) {
        try { reply({ ok: false, error: "VERIFY_ARM_ERROR: " + String((e && e.message) || e).slice(0, 150) }); } catch {}
      }
    } else if (msg.cmd === "verify_stop") {
      // Fecha a janela armada: delta + depois + veredito. Sem arm anterior, erro acionável.
      try {
        const V = UB_VERIFY;
        UB_VERIFY = null;
        if (!V) return reply({ ok: false, error: "VERIFY_EMPTY: sem verify_arm anterior" });
        let d = null;
        try { d = await V.delta.stop(); } catch { d = { added: [], removed: 0, attrs: 0, txts: 0, total: 0 }; }
        let after = null;
        try {
          const vEl = (V.el && V.el.isConnected) ? V.el : null;
          after = { url: location.href, title: document.title, state: vEl ? ubElementState(vEl) : V.before.state };
        } catch { after = V.before; }
        let v = null;
        try { v = ubClickVerifyResult(V.before, after, d); } catch { v = { verified: false, whatChanged: [] }; }
        reply({ ok: true, data: { verified: !!v.verified, whatChanged: v.whatChanged || [], delta: d } });
      } catch (e) {
        try { reply({ ok: false, error: "VERIFY_STOP_ERROR: " + String((e && e.message) || e).slice(0, 150) }); } catch {}
      }
    } else if (msg.cmd === "cursor") {
      // cursor independente: move (x,y da viewport) e opcionalmente clica no ponto
      try {
        await ubGlide(Number(a.x) || 0, Number(a.y) || 0);
        let clicked = null;
        if (a.click) {
          ubPulse();
          const el = document.elementFromPoint(ubCX, ubCY);
          if (!el) {
            return reply({ ok: true, data: { x: ubCX, y: ubCY, clicked: null, verified: false, whatChanged: [], method: "synthetic", note: "sem elemento no ponto", viewport: { w: innerWidth, h: innerHeight } } });
          }
          if (a.hover) { try { await ubHoverBeforeClick(el, ubCX, ubCY, a.hoverMs); } catch {} }
          const r = await ubClickWithVerify(el, ubCX, ubCY, { noEscalate: a.noEscalate });
          return reply({
            ok: true,
            data: {
              x: ubCX, y: ubCY, clicked: r.clickedTag, verified: r.verified, whatChanged: r.whatChanged,
              method: r.method, delta: r.delta, title: document.title, url: location.href,
              ...(r.needsTrusted ? { needsTrusted: true } : {}),
              viewport: { w: innerWidth, h: innerHeight },
            },
          });
        }
        reply({ ok: true, data: { x: ubCX, y: ubCY, clicked, viewport: { w: innerWidth, h: innerHeight } } });
      } catch (e) {
        try { reply({ ok: false, error: "CURSOR_ERROR: " + String((e && e.message) || e).slice(0, 200) }); } catch {}
      }
    } else if (msg.cmd === "cursor_sel") {
      try {
        const el = await findElResilient(a.selector);
        if (!el) return reply({ ok: false, error: ubNotFoundError(a.selector) });
        const freshCs = await elCenterFresh(a.selector);
        if (!freshCs.el || !freshCs.p) return reply({ ok: false, error: ubNotFoundError(a.selector, "após scroll") });
        const tgtCs = freshCs.el;
        // (a) pré-clique: overlay por cima? reporta quem cobre em vez de clicar cego.
        let coverCs = null;
        try { coverCs = ubTopmostCover(tgtCs, freshCs.p.x, freshCs.p.y); } catch { coverCs = null; }
        if (a.click && coverCs && coverCs.covered && !a.force) {
          return reply({ ok: false, error: "COVERED por " + (coverCs.cover || "?") + " em (" + freshCs.p.x + "," + freshCs.p.y + ") — alvo: " + a.selector + " (force:true p/ clicar mesmo assim)" });
        }
        await ubGlide(freshCs.p.x, freshCs.p.y);
        let clicked = null;
        if (a.click) {
          ubPulse();
          if (a.hover) { try { await ubHoverBeforeClick(tgtCs, freshCs.p.x, freshCs.p.y, a.hoverMs); } catch {} }
          const rCs = await ubClickWithVerify(tgtCs, freshCs.p.x, freshCs.p.y, { noEscalate: a.noEscalate });
          clicked = rCs.clickedTag;
          return reply({
            ok: true,
            data: {
              x: freshCs.p.x, y: freshCs.p.y, clicked, verified: rCs.verified, whatChanged: rCs.whatChanged,
              method: rCs.method, delta: rCs.delta, title: document.title, url: location.href,
              ...ubResolveNote(freshCs),
              ...(rCs.needsTrusted ? { needsTrusted: true } : {}),
              ...(coverCs && coverCs.childHit ? { childHit: coverCs.child } : {}),
            },
          });
        }
        await ubSettle({ timeout: 3000 });
        reply({ ok: true, data: { x: freshCs.p.x, y: freshCs.p.y, clicked } });
      } catch (e) {
        try { reply({ ok: false, error: "CURSOR_SEL_ERROR: " + String((e && e.message) || e).slice(0, 200) }); } catch {}
      }
    } else if (msg.cmd === "tooltip") {
      // hover-to-reveal v11: glide do cursor (SEM clique) + hover + settle curto +
      // leitura de nós recém-aparecidos perto do cursor + attrs (title/data-tippy/...).
      // Args: {selector} ou {x, y} (+hoverMs opcional). Responde {ok:true, data:{tooltip, source, x, y}}.
      try {
        let el = null, px = null, py = null;
        if (a.selector) {
          el = await findElResilient(a.selector);
          if (!el) return reply({ ok: false, error: ubNotFoundError(a.selector) });
          const f = await elCenterFresh(a.selector);
          el = (f && f.el) || el;
          if (f && f.p) { px = f.p.x; py = f.p.y; }
          else { try { const r0 = elRect(el); px = r0.x; py = r0.y; } catch {} }
        } else if (a.x !== undefined && a.y !== undefined) {
          px = Math.round(Number(a.x) || 0); py = Math.round(Number(a.y) || 0);
          try { el = document.elementFromPoint(px, py); } catch { el = null; }
        } else {
          return reply({ ok: false, error: "tooltip: selector ou x/y obrigatório" });
        }
        let before = [];
        try { before = ubTooltipNodes().map((n) => n.text); } catch { before = []; }
        try { await ubGlide(Number(px) || 0, Number(py) || 0); } catch {}
        try { await ubHoverBeforeClick(el, px, py, a.hoverMs); } catch {}
        try { if (el && el.focus) el.focus(); } catch {}
        try { await ubSettle({ timeout: 1200, quiet: 200 }); } catch {}
        let after = [];
        try { after = ubTooltipNodes(); } catch { after = []; }
        const isNew = (t) => { try { return before.indexOf(t) < 0; } catch { return true; } };
        let best = null;
        try {
          const near = after.filter((n) => isNew(n.text) && Number.isFinite(n.x) && Math.hypot(n.x - px, n.y - py) <= 350);
          best = near[0] || after.find((n) => isNew(n.text)) || null;
        } catch { best = null; }
        let attr = null;
        try { attr = ubTooltipText(el); } catch { attr = null; }
        const text = (best && best.text) || (attr && attr.text) || null;
        const source = (best && best.text) ? "hover" : ((attr && attr.text) ? attr.source : "");
        reply({ ok: true, data: { tooltip: text, source, x: px, y: py, ...ubResolveNote(fTip), ...(a.selector ? { selector: a.selector } : {}) } });
      } catch (e) {
        try { reply({ ok: false, error: "TOOLTIP_ERROR: " + String((e && e.message) || e).slice(0, 200) }); } catch {}
      }
    } else if (msg.cmd === "catchup") {
      // pesca transientes: fast-poll (~200ms, até ~3s, teto 15 iterações) p/ nós de
      // vida curta (role=status/alert, aria-live, .toast/.snackbar). Responde
      // {ok:true, data:{appeared, disappeared, samples, durationMs}} com texto curto.
      try {
        const res = await ubCatchup({ intervalMs: a.intervalMs, durationMs: a.durationMs });
        reply({ ok: true, data: res });
      } catch (e) {
        try { reply({ ok: false, error: "CATCHUP_ERROR: " + String((e && e.message) || e).slice(0, 200) }); } catch {}
      }
    } else if (msg.cmd === "fill") {
      const el = await findElResilient(a.selector);
      if (!el) return reply({ ok: false, error: ubNotFoundError(a.selector) });
      el.scrollIntoView({ block: "center" });
      try { const fv = await elCenterFresh(a.selector); await ubGlide(fv.p.x, fv.p.y); } catch {} // visual
      ubPulse();
      el.focus();
      // input type=color NÃO aceita "" (throw "must be a valid CSS color") — valida #rrggbb.
      try {
        if (((el.type || "") + "").toLowerCase() === "color") {
          const m = String(a.text ?? "").match(/#([0-9a-f]{6}|[0-9a-f]{3})\b/i);
          if (!m) return reply({ ok: false, error: "fill em input color exige cor #rrggbb (recebido: " + String(a.text ?? "").slice(0, 40) + ")" });
          let hex = m[1].toLowerCase();
          if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
          const _dlColor = ubDeltaArm();
          el.value = "#" + hex;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          const _dColor = await _dlColor.stop();
          reply({ ok: true, data: { filled: a.selector, via: "color", title: document.title, url: location.href, delta: _dColor } });
          return;
        }
      } catch (e) {
        return reply({ ok: false, error: "fill color falhou: " + String((e && e.message) || e).slice(0, 160) });
      }
      // #44: select-all antes de inserir — fill SUBSTITUI em vez de anexar
      // (contenteditable/divs; Monaco/CodeMirror vão pela API no background, mundo MAIN).
      try { if (typeof el.select === "function") el.select(); else document.execCommand("selectAll", false, null); } catch {}
      const _dlFill = ubDeltaArm();
      // blindagem: qualquer throw aqui (ex: input com restrição de valor) vira erro
      // acionável com contexto — nunca crash anônimo no painel da extensão.
      try {
        el.value = "";
      } catch (e) {
        try { await _dlFill.stop(); } catch {}
        return reply({ ok: false, error: "fill limpar falhou em " + a.selector + " (type=" + (((el.type || "") + "").slice(0, 20)) + "): " + String((e && e.message) || e).slice(0, 160) });
      }
      el.dispatchEvent(new Event("input", { bubbles: true }));
      document.execCommand("insertText", false, String(a.text ?? ""));
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      if (a.submit) {
        el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
        const f = el.form;
        if (f) f.submit();
      }
      const _dFill = await _dlFill.stop();
      let expFill = null;
      try { if (a.expectUrl || a.expectText || a.expectGone) expFill = ubExpectCheck(a); } catch { expFill = null; }
      reply({ ok: true, data: { filled: a.selector, title: document.title, url: location.href, delta: _dFill, ...(expFill ? { expect: expFill } : {}) } });
    } else if (msg.cmd === "type") {
      const el = await findElResilient(a.selector);
      if (!el) return reply({ ok: false, error: ubNotFoundError(a.selector) });
      el.scrollIntoView({ block: "center" });
      try { const fv = await elCenterFresh(a.selector); await ubGlide(fv.p.x, fv.p.y); } catch {} // visual
      ubPulse();
      el.focus();
      try {
        const len = (el.value || "").length;
        if (typeof el.setSelectionRange === "function") el.setSelectionRange(len, len);
      } catch {}
      const _dlType = ubDeltaArm();
      document.execCommand("insertText", false, String(a.text ?? ""));
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      const _dType = await _dlType.stop();
      let expType = null;
      try { if (a.expectUrl || a.expectText || a.expectGone) expType = ubExpectCheck(a); } catch { expType = null; }
      reply({ ok: true, data: { filled: a.selector, title: document.title, url: location.href, delta: _dType, ...(expType ? { expect: expType } : {}) } });
    } else if (msg.cmd === "select") {
      const el = await findElResilient(a.selector);
      if (!el) return reply({ ok: false, error: ubNotFoundError(a.selector) });
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
      const _dlSel = ubDeltaArm();
      el.value = target.value;
      el.selectedIndex = opts.indexOf(target);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      const _dSel = await _dlSel.stop();
      let expSel = null;
      try { if (a.expectUrl || a.expectText || a.expectGone) expSel = ubExpectCheck(a); } catch { expSel = null; }
      reply({ ok: true, data: { selected: el.value, delta: _dSel, ...(expSel ? { expect: expSel } : {}) } });
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
      const _dlPress = ubDeltaArm();
      for (const t of ["keydown", "keyup"])
        document.activeElement?.dispatchEvent(new KeyboardEvent(t, { key, bubbles: true }));
      const _dPress = await _dlPress.stop();
      reply({ ok: true, data: { pressed: key, delta: _dPress } });
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
