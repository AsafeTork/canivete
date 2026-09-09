// UBrowser Bridge — content script (mundo isolado).
// Executa leitura e ações simples no DOM da página logada.
function cssPath(el) {
  if (el.id) return "#" + el.id;
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
      ) || null
    );
  }
  try {
    return document.querySelector(sel);
  } catch {
    return null;
  }
}

// ---- cursor INDEPENDENTE (overlay roxo: não rouba o mouse do dono) ----
// PERSISTENTE: registrado via scripting.registerContentScripts (toda página http/https,
// desde o document_start) + posição salva em chrome.storage.session → sobrevive a F5/navegação.
let ubCursor = null, ubCX = 0, ubCY = 0;
const UB_V = "4";
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
  Object.assign(ubCursor.style, { position: "fixed", zIndex: "2147483647", width: "34px", height: "34px", pointerEvents: "none", left: ubCX - 4 + "px", top: ubCY - 2 + "px", transition: "left .3s ease-out, top .3s ease-out" });
  ubCursor._arrow = ubCursor.firstChild;
  document.documentElement.appendChild(ubCursor);
  return ubCursor;
}
function ubGlide(x, y) {
  const c = ubShowCursor();
  ubCX = Math.max(0, Math.round(x)); ubCY = Math.max(0, Math.round(y));
  c.style.left = ubCX - 4 + "px"; c.style.top = ubCY - 2 + "px"; // ponta da seta no alvo
  try { chrome.storage.session.set({ ubCursor: { x: ubCX, y: ubCY } }).catch(() => {}); } catch {}
  return Promise.resolve(); // animação corre sozinha via transition — não bloqueia a resposta
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
function elCenter(el) {
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    const a = msg.args || {};
    if (msg.cmd === "ping") { reply({ ok: true, data: { v: UB_V } }); return; }
    if (msg.cmd === "state") { reply({ ok: true, data: { title: document.title, url: location.href } }); return; }
    if (msg.cmd === "read") {
      const mc = Math.min(Math.max(Number(a.maxChars) || 2500, 200), 6000);
      const ml = Math.min(Math.max(Number(a.maxLinks) || 15, 0), 40);
      reply({
        ok: true,
        data: {
          title: document.title,
          url: location.href,
          text: (document.body ? document.body.innerText : "").slice(0, mc),
          links: [...document.querySelectorAll("a[href]")]
            .slice(0, ml)
            .map((x) => ({ text: (x.innerText || "").replace(/\s+/g, " ").trim().slice(0, 80), href: x.href })),
        },
      });
    } else if (msg.cmd === "snapshot") {
      const els = [...document.querySelectorAll('a,button,input,select,textarea,[role="button"],[role="link"],[onclick]')].slice(
        0,
        120
      );
      reply({
        ok: true,
        data: els.map((el, i) => ({
          ref: i,
          tag: el.tagName.toLowerCase(),
          type: el.type || el.getAttribute("role") || "",
          text: (((el.textContent || el.value || el.placeholder || el.getAttribute("aria-label") || "") + "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 60)),
          selector: cssPath(el),
          ...elCenter(el),
        })),
      });
    } else if (msg.cmd === "click") {
      const el = findEl(a.selector);
      if (!el) return reply({ ok: false, error: "NOTFOUND: " + a.selector });
      el.scrollIntoView({ block: "center" });
      await ubGlide(...Object.values(elCenter(el))); // cursor desliza até o alvo antes de clicar
      ubPulse();
      el.click();
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
      const el = findEl(a.selector);
      if (!el) return reply({ ok: false, error: "NOTFOUND: " + a.selector });
      el.scrollIntoView({ block: "center" });
      const { x, y } = elCenter(el);
      await ubGlide(x, y);
      let clicked = null;
      if (a.click) { ubPulse(); el.click(); clicked = el.tagName.toLowerCase(); }
      reply({ ok: true, data: { x, y, clicked } });
    } else if (msg.cmd === "fill") {
      const el = findEl(a.selector);
      if (!el) return reply({ ok: false, error: "NOTFOUND: " + a.selector });
      el.scrollIntoView({ block: "center" });
      await ubGlide(...Object.values(elCenter(el))); // cursor desliza até o campo antes de digitar
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
      reply({ ok: true, data: { filled: a.selector, title: document.title, url: location.href } });
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
    } else {
      reply({ ok: false, error: "cmd desconhecido no content: " + msg.cmd });
    }
  })();
  return true; // resposta assíncrona
});
