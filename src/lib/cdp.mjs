// canivete — Chrome headless próprio via CDP (zero deps, WebSocket nativo)
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { UA } from "./ctx.mjs";
import { sleep } from "../core/retry.mjs";

const CHROME_BIN = process.env.CANIVETE_CHROME_BIN || process.env.CHROME_BIN || ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find((p) => existsSync(p)) || "google-chrome";
if (/headless-shell/i.test(CHROME_BIN)) console.warn("[canivete:cdp] headless-shell detectado — imagens/screenshot degradados; use chromium/chrome full via CANIVETE_CHROME_BIN");
const BASE_CDP_PORT = Number(process.env.CANIVETE_CDP_PORT || process.env.OPENCODE_CDP_PORT) || 19322;
let CDP_PORT = BASE_CDP_PORT;
const CHROME_PROFILE = process.env.CANIVETE_CHROME_PROFILE || join(tmpdir(), "canivete-chrome-profile");
let chromeChild = null;
let lastUse = Date.now();

// LOW-MEM: flags p/ Chrome comer menos RAM parado. Desativa com CANIVETE_CHROME_LOWMEM=0.
function isLowMemEnabled() {
  return !/^(0|false|no|off)$/i.test(String(process.env.CANIVETE_CHROME_LOWMEM ?? "1"));
}
const LOWMEM_FLAGS = [
  "--renderer-process-limit=2",
  "--disable-features=Translate,OptimizationHints,MediaRouter",
  "--js-flags=--max-old-space-size=256",
];

// Timeout configurável (default mantido quando env ausente/inválido).
const CDP_TIMEOUT_MS = Number(process.env.CANIVETE_CDP_TIMEOUT) || 25000;
const WS_OPEN_TIMEOUT_MS = Number(process.env.CANIVETE_CDP_TIMEOUT) || 10000;
const RECONNECT_BACKOFF_MS = 1000;

// (sleep importado de ../core/retry.mjs — sem duplicata local)

// TEXT-FIRST: navegador em background só texto; render full só no print (screenshot/pdf).
// Desativa com CANIVETE_BROWSER_FULLRENDER=1 (retorna ao comportamento anterior, sem bloqueio).
// NOTA: imagens são cortadas SÓ via Network.setBlockedURLs (reversível por aba, full render
// via urls:[]) — NÃO usar --blink-settings=imagesEnabled=false no launch: ele corta no
// renderer e é irreversível, ou seja, o "full render" do screenshot saía sem imagens
// (página mentida na evidência visual). Sem tocar em Stylesheet (que quebraria layout p/ print).
const TEXT_BLOCK_URLS = [
  "*.png*", "*.jpg*", "*.jpeg*", "*.gif*", "*.webp*", "*.svg*", "*.ico*", "*.avif*", "*.bmp*", "*.tif*", "*.tiff*",
  "*.mp4*", "*.webm*", "*.mp3*", "*.wav*", "*.ogg*", "*.oga*", "*.ogv*", "*.flac*", "*.avi*", "*.mov*", "*.m4v*", "*.m4a*", "*.opus*",
  "*.woff*", "*.woff2*", "*.ttf*", "*.otf*", "*.eot*",
];
function isTextFirstEnabled() {
  return !/^(1|true|yes)$/i.test(String(process.env.CANIVETE_BROWSER_FULLRENDER || ""));
}
// Bloqueia Image/Media/Font por default nas navegações de TEXTO (navigate/snapshot/act). Nunca quebra: falha silenciosa → segue sem bloqueio.
async function cdpSetTextFirst(send) {
  if (!isTextFirstEnabled()) return false;
  try { await send("Network.enable"); } catch {}
  try { await send("Network.setBlockedURLs", { urls: TEXT_BLOCK_URLS }); } catch { return false; }
  return true;
}
// Remove o bloqueio antes de screenshot/pdf/shot (full render). Nunca quebra.
async function cdpSetFullRender(send) {
  if (!isTextFirstEnabled()) return false;
  try { await send("Network.enable"); } catch {}
  try { await send("Network.setBlockedURLs", { urls: [] }); } catch {}
  return true;
}
// #58: viewport REAL — o knob certo é Emulation.setDeviceMetricsOverride.
// (O fallback --window-size só dimensiona a janela; em headless-shell/outros
// ambientes o Chrome reescala depois e o PNG sai do tamanho errado.)
// Retorna o viewport EFETIVO (innerWidth/innerHeight medidos DEPOIS do override)
// p/ o caller avisar (WARN) quando divergir do pedido por >2px.
async function cdpSetViewport(send, width, height, dsf = 1) {
  const w = Math.min(Math.max(Number(width) || 1280, 320), 2560);
  const h = Math.min(Math.max(Number(height) || 800, 320), 2560);
  const s = Number(dsf) === 0.5 ? 0.5 : 1;
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: s, mobile: false });
  let rw = w, rh = h;
  try {
    const r = await send("Runtime.evaluate", { expression: "({w: window.innerWidth, h: window.innerHeight})", returnByValue: true }, 5000);
    const v = r?.result?.value || {};
    if (Number(v.w) > 0) rw = Number(v.w);
    if (Number(v.h) > 0) rh = Number(v.h);
  } catch {}
  return { width: w, height: h, scale: s, real: { width: rw, height: rh } };
}
// Solta o override depois do capture: sem isso o viewport da última screenshot
// vaza p/ atos seguintes na MESMA aba (o headless reusa 1 aba cacheada 60s).
async function cdpClearViewport(send) {
  try { await send("Emulation.clearDeviceMetricsOverride"); } catch {}
}
// Log mínimo: só falhas de conexão/reconnect (nunca em hot-path de mensagens).
const logConn = (...a) => console.warn("[canivete:cdp]", ...a);

async function cdpVersion(port = CDP_PORT) {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 2000);
    const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: ac.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// cmdline do processo dono da porta (para distinguir NOSSO chrome de OUTRO chrome).
// Retorna string ou null se indeterminado (sem /proc, sem permissão, etc).
function portOwnerCmdline(port) {
  try {
    const pids = readdirSync("/proc").filter((d) => /^\d+$/.test(d));
    for (const pid of pids) {
      try {
        const raw = readFileSync(`/proc/${pid}/cmdline`, "utf8");
        if (!raw || !raw.includes("remote-debugging-port")) continue;
        if (!raw.includes(String(port))) continue;
        return raw.replace(/\0/g, " ");
      } catch {}
    }
  } catch {}
  return null;
}

async function ensureBrowser() {
  if (chromeChild?.killed) chromeChild = null;
  if (chromeChild) {
    try { process.kill(chromeChild.pid, 0); } catch { chromeChild = null; }
  }
  // Tenta portas BASE..BASE+3: se ocupada por OUTRO chrome (sem nosso user-data-dir), pula p/ próxima.
  for (let off = 0; off < 4; off++) {
    const port = BASE_CDP_PORT + off;
    let ver = null;
    try { ver = await cdpVersion(port); } catch { ver = null; }
    if (ver) {
      const owner = portOwnerCmdline(port);
      if (owner && !owner.includes(CHROME_PROFILE)) continue; // OUTRO chrome → próxima porta
      CDP_PORT = port;
      return;
    }
    // Porta sem CDP: tenta subir nosso chrome nela.
    if (off > 0 && chromeChild) { try { chromeChild.kill(); } catch {} chromeChild = null; }
    try { mkdirSync(CHROME_PROFILE, { recursive: true }); } catch {}
    try {
      chromeChild = spawn(CHROME_BIN, [
        "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
        "--hide-scrollbars", "--mute-audio", "--disable-extensions", "--disable-background-networking",
        ...(isLowMemEnabled() ? LOWMEM_FLAGS : []),
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${CHROME_PROFILE}`, "about:blank",
      ], { stdio: "ignore", detached: true });
      chromeChild.unref?.();
    } catch { chromeChild = null; continue; }
    let ok = false;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try { if (await cdpVersion(port)) { ok = true; break; } } catch {}
      if (chromeChild && chromeChild.exitCode !== null && chromeChild.exitCode !== undefined) break; // morreu (porta ocupada por processo não-CDP?) → próxima
    }
    if (ok) { CDP_PORT = port; return; }
    try { chromeChild?.kill(); } catch {}
    chromeChild = null;
  }
  throw new Error(`chrome não respondeu nas portas ${BASE_CDP_PORT}..${BASE_CDP_PORT + 3} (${CHROME_BIN}) — base pode estar ocupada por outro chrome`);
}

async function cdpTargets() {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), WS_OPEN_TIMEOUT_MS);
  try {
    const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`, { signal: ac.signal });
    if (!r.ok) throw new Error(`CDP /json/list HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

async function cdpNewPage(url = "about:blank") {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), WS_OPEN_TIMEOUT_MS);
  try {
    const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${new URLSearchParams({ url })}`, { method: "PUT", signal: ac.signal });
    if (!r.ok) throw new Error(`CDP new page [PUT /json/new] falhou p/ ${url}: HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

function cdpSend(ws, id, method, params = {}, timeout = CDP_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { try { ws.removeEventListener("message", onMsg); } catch {} reject(new Error(`CDP timeout: ${method} (${timeout}ms)`)); }, timeout);
    const onMsg = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m?.id === id) { clearTimeout(timer); try { ws.removeEventListener("message", onMsg); } catch {} m.error ? reject(new Error(`CDP ${method}: ${m.error.message || JSON.stringify(m.error)}`)) : resolve(m.result || {}); }
    };
    ws.addEventListener("message", onMsg);
    try {
      ws.send(JSON.stringify({ id, method, params }));
    } catch (e) {
      clearTimeout(timer);
      try { ws.removeEventListener("message", onMsg); } catch {}
      reject(e);
    }
  });
}

// Abre WS na aba ativa (ou cria uma), habilita Page/Runtime e executa fn({send, target, ws}).
// Perf: reuso de aba — cache tabId+wsUrl por 60s (pula /json/list + /json/new entre chamadas próximas).
let cachedTab = null; // { id, wsUrl, ts }
const TAB_TTL_MS = 60000;

// idle-off: auto-desliga Chrome ocioso (próximo uso respawna via ensureBrowser).
// Checa a cada 60s: ocioso > CANIVETE_CHROME_IDLE_MS (default 5min) → kill + limpa cache.
const CHROME_IDLE_MS = Number(process.env.CANIVETE_CHROME_IDLE_MS) || 5 * 60 * 1000;
const idleTimer = setInterval(() => {
  try {
    if (!chromeChild) return;
    if (Date.now() - lastUse < CHROME_IDLE_MS) return;
    try { chromeChild.kill(); } catch {}
    chromeChild = null;
    cachedTab = null;
  } catch {}
}, 60000);
idleTimer.unref?.();

async function openWs(wsUrl, tabHint = "?") {
  const ws = new WebSocket(wsUrl);
  const timeout = WS_OPEN_TIMEOUT_MS;
  try {
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(Object.assign(new Error(`WS CDP timeout [open:${timeout}ms] na aba ${tabHint}`), { __cdpSetup: true })), timeout);
      ws.onopen = () => { clearTimeout(t); ws.onerror = null; res(); };
      ws.onerror = () => { clearTimeout(t); rej(Object.assign(new Error(`WS CDP falhou [open] na aba ${tabHint}`), { __cdpSetup: true })); };
    });
  } catch (e) {
    logConn(`open falhou (${tabHint}): ${e.message}`);
    try { ws.close(); } catch {}
    throw e;
  }
  return ws;
}

function isStaleTargetErr(e) {
  return /No target|Session closed|Target closed|No session/i.test(String(e?.message || ""));
}

async function runOnWs(wsUrl, target, fn, { urlHint } = {}) {
  const tabHint = target?.url || urlHint || "?";
  const ws = await openWs(wsUrl, tabHint);
  let seq = 0;
  const send = async (m, p, t) => {
    try {
      return await cdpSend(ws, ++seq, m, p, t);
    } catch (e) {
      const err = new Error(`CDP ${m} falhou na aba ${target?.url || urlHint || "?"}: ${e.message}`);
      if (e?.__cdpSetup) err.__cdpSetup = true;
      throw err;
    }
  };
  try {
    try {
      // Fusão RTT: enables independentes em paralelo (1 janela de latência em vez de 2; count igual).
      await Promise.all([send("Page.enable"), send("Runtime.enable")]);
    } catch (e) { e.__cdpSetup = true; throw e; }
    return await fn({ send, target, ws });
  } finally { try { ws.close(); } catch {} }
}

async function withCdp(fn, { url } = {}) {
  lastUse = Date.now();
  await ensureBrowser();
  // Reconnect 1x em queda/stale com backoff 1s.
  const staleRetry = async (firstErr) => {
    logConn(`queda (${url || "?"}): ${firstErr?.message || firstErr} — reconnect 1x em ${RECONNECT_BACKOFF_MS}ms`);
    await sleep(RECONNECT_BACKOFF_MS);
    let fresh;
    try {
      fresh = await cdpNewPage(url || "about:blank");
    } catch (e2) {
      logConn(`reconexão falhou [new page] (${url || "?"}): ${e2.message}`);
      throw new Error(`CDP reconexão falhou [new page] na aba ${url || "?"} (orig: ${firstErr.message}): ${e2.message}`);
    }
    try {
      const out = await runOnWs(fresh.webSocketDebuggerUrl, fresh, fn, { urlHint: url });
      cachedTab = { id: fresh.id, wsUrl: fresh.webSocketDebuggerUrl, ts: Date.now() };
      return out;
    } catch (e3) {
      logConn(`reconnect falhou (${url || "?"}): ${e3.message}`);
      throw e3;
    }
  };
  const now = Date.now();
  // fast-path: cache fresco → vai direto no wsUrl (sem /json/list, sem /json/new)
  if (cachedTab && (now - cachedTab.ts) < TAB_TTL_MS) {
    try {
      const out = await runOnWs(cachedTab.wsUrl, { id: cachedTab.id, webSocketDebuggerUrl: cachedTab.wsUrl }, fn, { urlHint: url });
      cachedTab.ts = Date.now(); // sliding window: sessão quente continua reusando
      return out;
    } catch (e) {
      if (isStaleTargetErr(e)) { cachedTab = null; return await staleRetry(e); }
      if (!e?.__cdpSetup) throw e; // erro da fn do caller → sem retry (evita duplo click/goto)
      cachedTab = null; // morta (WS fechado/target gone/enable falhou) → invalida, cai p/ slow-path
    }
  }
  let targets = await cdpTargets();
  let page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (url && page) {
    // reutiliza a aba; navegação é feita pelo caller via Page.navigate
  }
  if (!page) page = await cdpNewPage(url || "about:blank");
  try {
    const out = await runOnWs(page.webSocketDebuggerUrl, page, fn, { urlHint: url });
    cachedTab = { id: page.id, wsUrl: page.webSocketDebuggerUrl, ts: Date.now() };
    return out;
  } catch (e) {
    if (isStaleTargetErr(e)) { cachedTab = null; return await staleRetry(e); }
    if (e?.__cdpSetup) cachedTab = null; // invalide se morta
    throw e;
  }
}

const PAGE_SNAPSHOT_JS = `(() => {
  const els = [...document.querySelectorAll('a,button,input,select,textarea,h1,h2,h3,h4,h5,h6,[role="button"],[role="link"],[role="heading"],[role="checkbox"],[role="radio"],[role="switch"],[onclick]')].slice(0,120);
  const path = (el) => {
    const safe = (v) => /^[A-Za-z_][A-Za-z0-9_-]*$/.test(String(v || ''));
    const attrSel = (a, v) => '[' + a + '="' + String(v).replace(/"/g, "'") + '"]';
    if (el.id) return safe(el.id) ? '#' + el.id : '[id="' + String(el.id).replace(/"/g, "'") + '"]';
    const parts = [];
    let n = el;
    for (let d = 0; d < 5 && n && n !== document.body; d++) {
      let s = n.tagName.toLowerCase();
      // âncora estável: data-testid/data-test/name/aria-label cortam a cadeia (curto e durável)
      const anchor = ['data-testid', 'data-test', 'name', 'aria-labelledby', 'aria-label'].find((a) => { const v = n.getAttribute && n.getAttribute(a); return v && v.length <= 60; });
      if (anchor) { parts.unshift(s + attrSel(anchor, n.getAttribute(anchor))); break; }
      if (n.className && typeof n.className === 'string') {
        // só classe "limpa": Tailwind arbitrário (rounded-[24px]) sanitizado virava classe
        // inexistente e o seletor morria no act (report rmwq3nj6s)
        const c = n.className.trim().split(/\\s+/).find((x) => /^[A-Za-z_][A-Za-z0-9_-]*$/.test(x));
        if (c) s += '.' + c;
      }
      const sib = n.parentElement ? [...n.parentElement.children].filter(c => c.tagName === n.tagName) : [];
      if (sib.length > 1) s += ':nth-of-type(' + (sib.indexOf(n)+1) + ')';
      parts.unshift(s); n = n.parentElement;
    }
    return parts.join(' > ');
  };
  const implicitRole = (el) => {
    const t = el.tagName.toLowerCase();
    if (t === 'a' && el.hasAttribute('href')) return 'link';
    if (t === 'button') return 'button';
    if (t === 'h1' || t === 'h2' || t === 'h3' || t === 'h4' || t === 'h5' || t === 'h6') return 'heading';
    if (t === 'input') {
      const ty = (el.type || '').toLowerCase();
      if (ty === 'checkbox') return 'checkbox';
      if (ty === 'radio') return 'radio';
      if (ty === 'button' || ty === 'submit' || ty === 'reset' || ty === 'image') return 'button';
      if (ty === 'search') return 'searchbox';
      return 'textbox';
    }
    if (t === 'select') return 'combobox';
    if (t === 'textarea') return 'textbox';
    return '';
  };
  const accName = (el) => {
    const lb = el.getAttribute('aria-labelledby');
    if (lb) {
      const ps = lb.split(/\\s+/).map((id) => document.getElementById(id)).filter(Boolean).map((n) => (n.innerText || n.textContent || '').replace(/\\s+/g,' ').trim()).filter(Boolean);
      if (ps.length) return ps.join(' ').slice(0,100);
    }
    const al = el.getAttribute('aria-label');
    if (al) return al.replace(/\\s+/g,' ').trim().slice(0,100);
    const t = el.tagName.toLowerCase();
    if (t === 'input') {
      const ty = (el.type || '').toLowerCase();
      if (ty === 'image' && el.alt) return String(el.alt).replace(/\\s+/g,' ').trim().slice(0,100);
      if ((ty === 'button' || ty === 'submit' || ty === 'reset') && el.value) return String(el.value).replace(/\\s+/g,' ').trim().slice(0,100);
    }
    if (t === 'select' && el.selectedOptions && el.selectedOptions[0]) return (el.selectedOptions[0].textContent || '').replace(/\\s+/g,' ').trim().slice(0,100);
    const it = (el.innerText || '').replace(/\\s+/g,' ').trim();
    if (it) return it.slice(0,100);
    const tc = (el.textContent || '').replace(/\\s+/g,' ').trim();
    if (tc) return tc.slice(0,100);
    if (el.value) return String(el.value).replace(/\\s+/g,' ').trim().slice(0,100);
    if (el.placeholder) return String(el.placeholder).replace(/\\s+/g,' ').trim().slice(0,100);
    if (el.title) return String(el.title).replace(/\\s+/g,' ').trim().slice(0,100);
    return '';
  };
  const stateOf = (el, role) => {
    const st = [];
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') st.push('disabled');
    const ty = (el.type || '').toLowerCase();
    const chk = ty === 'checkbox' || ty === 'radio' || role === 'checkbox' || role === 'radio' || role === 'switch' || el.hasAttribute('aria-checked');
    if (chk) {
      const ac = el.getAttribute('aria-checked');
      if (el.checked === true || ac === 'true') st.push('checked');
      else if (ac === 'mixed') st.push('mixed');
      else st.push('unchecked');
    }
    const ae = el.getAttribute('aria-expanded');
    if (ae === 'true') st.push('expanded');
    else if (ae === 'false') st.push('collapsed');
    else if (el.tagName.toLowerCase() === 'details') st.push(el.hasAttribute('open') ? 'expanded' : 'collapsed');
    if (el.selected === true || el.getAttribute('aria-selected') === 'true') st.push('selected');
    if (el.required || el.getAttribute('aria-required') === 'true') st.push('required');
    if (el.readOnly || el.getAttribute('aria-readonly') === 'true') st.push('readonly');
    return st.join(' ');
  };
  const levelOf = (el, role) => {
    if (role !== 'heading') return 0;
    const al = parseInt(el.getAttribute('aria-level') || '', 10);
    if (al >= 1 && al <= 6) return al;
    const m = /^h([1-6])$/i.exec(el.tagName);
    if (m) return parseInt(m[1], 10);
    return 0;
  };
  return els.map((el, i) => {
    const role = el.getAttribute('role') || implicitRole(el);
    return {
      ref: i,
      tag: el.tagName.toLowerCase(),
      type: el.type || el.getAttribute('role') || '',
      text: (el.innerText || el.value || el.placeholder || el.getAttribute('aria-label') || '').replace(/\\s+/g,' ').trim().slice(0,100),
      selector: path(el),
      role: role,
      name: accName(el),
      state: stateOf(el, role),
      level: levelOf(el, role),
    };
  });
})()`;

// EXTRACT: 1 evaluate = TODA a info da página estruturada (meta/OG/JSON-LD, texto principal
// readability-lite, títulos hierárquicos, TABELAS como rows+md, listas, links dedupe, imagens
// com alt, formulários com campos/labels/opções). Caps embutidos na expressão — zero 2º RTT.
// Seletor opcional escopa tudo a um container; sem seletor, escolhe <article>/<main> quando
// tem corpo (fallback body). innerText já ignora display:none (nav/rodapé fora do escopo).
function pageExtractJs(caps) {
  const k = caps || {};
  const maxChars = Math.min(Math.max(Number(k.maxChars) || 12000, 500), 40000);
  const maxTables = Math.min(Math.max(Number(k.maxTables) || 10, 0), 30);
  const maxLists = Math.min(Math.max(Number(k.maxLists) || 8, 0), 20);
  const maxLinks = Math.min(Math.max(Number(k.maxLinks) || 50, 0), 200);
  const maxImages = Math.min(Math.max(Number(k.maxImages) || 20, 0), 100);
  const maxForms = Math.min(Math.max(Number(k.maxForms) || 10, 0), 30);
  const sel = k.selector ? String(k.selector).slice(0, 300) : "";
  const scopeJs = sel
    ? `try { var se = document.querySelector(${JSON.stringify(sel)}); if (se) { root = se; scope = 'seletor:' + ${JSON.stringify(sel)}; } } catch (e) {}`
    : `try { var cand = document.querySelector('article') || document.querySelector('main') || document.querySelector('[role=main]'); if (cand && (cand.innerText || '').trim().length > 300) { root = cand; scope = 'principal:' + cand.tagName.toLowerCase(); } } catch (e) {}`;
  return `(() => {
  var CAPT = ${maxChars}, CAPTAB = ${maxTables}, CAPLST = ${maxLists}, CAPLNK = ${maxLinks}, CAPIMG = ${maxImages}, CAPFRM = ${maxForms};
  var root = document.body, scope = 'body';
  ${scopeJs}
  var q = (s, e) => Array.from((e || root).querySelectorAll(s));
  var txt = (e) => ((e && (e.innerText || e.textContent)) || '').replace(/\\s+/g, ' ').trim();
  var cs = (s, n) => String(s || '').slice(0, n);
  var meta = (n) => { var m = document.querySelector('meta[name="' + n + '"],meta[property="' + n + '"]'); return m ? cs(m.content, 300) : ''; };
  var jsonld = [];
  Array.from(document.querySelectorAll('script[type="application/ld+json"]')).slice(0, 5).forEach(function (s) { try { jsonld.push(JSON.stringify(JSON.parse(s.textContent)).slice(0, 2500)); } catch (e) {} });
  var headings = q('h1,h2,h3,h4,h5,h6').slice(0, 60).map(function (h) { return { l: Number(h.tagName[1]), t: cs(txt(h), 160) }; }).filter(function (h) { return h.t; });
  var text = cs(root.innerText || '', CAPT);
  var tables = q('table').slice(0, CAPTAB).map(function (t) {
    var rows = q('tr', t).slice(0, 30).map(function (tr) { return q('th,td', tr).slice(0, 10).map(function (td) { return cs(txt(td), 100); }); });
    if (!rows.length || !rows[0].length) return null;
    var prev = t.previousElementSibling;
    var md = rows.slice(0, 12).map(function (r, i) { return '| ' + r.join(' | ') + ' |' + (i === 0 ? '\\n|' + r.map(function () { return '---'; }).join('|') + '|' : ''); }).join('\\n');
    return { caption: cs((t.caption && txt(t.caption)) || (prev && /^h[1-6]$/.test(prev.tagName) ? txt(prev) : '') || '', 120), rows: rows, md: md };
  }).filter(Boolean);
  var lists = q('ul,ol').slice(0, CAPLST).map(function (l) { return { items: q('li', l).slice(0, 15).map(function (li) { return cs(txt(li), 160); }).filter(Boolean) }; }).filter(function (x) { return x.items.length > 1; });
  var seen = new Set(); var links = [];
  for (var i = 0; i < q('a[href]').length && links.length < CAPLNK; i++) {
    var a = q('a[href]')[i], h = a.href, t2 = cs(txt(a), 80);
    if (!h || h.indexOf('javascript:') === 0 || seen.has(h) || !t2) continue;
    seen.add(h); links.push({ t: t2, h: h });
  }
  var images = q('img[src]').slice(0, CAPIMG).map(function (im) { return { s: cs(im.currentSrc || im.src, 300), a: cs(im.alt, 120) }; }).filter(function (im) { return im.s && im.s.indexOf('data:') !== 0; });
  var forms = q('form').slice(0, CAPFRM).map(function (f) {
    return {
      name: cs(f.name || f.id || '', 80),
      fields: q('input,select,textarea', f).slice(0, 25).map(function (el) {
        var tg = el.tagName.toLowerCase(), ty = tg === 'input' ? (el.type || 'text') : tg;
        var lbl = '';
        if (el.id) { var L = document.querySelector('label[for="' + el.id + '"]'); if (L) lbl = cs(txt(L), 100); }
        if (!lbl) { var w = el.closest('label'); if (w) lbl = cs(txt(w), 100); }
        if (!lbl) lbl = cs(el.placeholder || el.name || '', 100);
        var fl = { n: cs(el.name || el.id || '', 60), t: ty, lbl: lbl, v: cs(el.value || '', 120) };
        if (el.required || el.getAttribute('aria-required') === 'true') fl.req = 1;
        if (tg === 'select') fl.o = Array.from(el.options || []).slice(0, 8).map(function (op) { return cs(op.text, 60); });
        return fl;
      }),
    };
  });
  // GRÁFICOS/elementos visuais: svg (labels/texto = valores de gráfico SVG), canvas (gráfico
  // raster — dataURL salvo em arquivo p/ o agente VER), figcaption, background-image, mídia.
  var svg = q('svg').slice(0, 10).map(function (s) {
    var tt = s.querySelector('title,text');
    return {
      vb: s.getAttribute('viewBox') || '',
      nome: cs(s.getAttribute('aria-label') || (tt && txt(tt)) || '', 120),
      textos: q('text,tspan', s).slice(0, 20).map(function (x) { return cs(txt(x), 60); }).filter(Boolean),
      paths: s.querySelectorAll('path,rect,circle,polyline,polygon,line').length,
      fills: Array.from(new Set(Array.from(s.querySelectorAll('[fill]')).map(function (p) { return p.getAttribute('fill'); }).filter(function (f) { return f && f !== 'none'; }))).slice(0, 8),
    };
  }).filter(function (s) { return s.nome || s.textos.length || s.paths; });
  var canvas = q('canvas').slice(0, 10).map(function (cn) {
    var d = null;
    try { d = cn.width && cn.height ? cn.toDataURL('image/png') : null; } catch (e) { d = 'tainted'; }
    return { n: cs(cn.id || cn.className || '', 80), w: cn.width, h: cn.height, png: d && d !== 'tainted' ? d : null, tainted: d === 'tainted' ? 1 : undefined };
  });
  var figs = q('figure').slice(0, 10).map(function (fg) {
    var im = fg.querySelector('img'), fc = fg.querySelector('figcaption');
    return { img: im ? cs(im.currentSrc || im.src || '', 300) : '', caption: fc ? cs(txt(fc), 200) : '' };
  }).filter(function (f) { return f.img || f.caption; });
  var bgs = q('[style*="background"]').slice(0, 15).map(function (e) {
    var m = (e.getAttribute('style') || '').match(/url\\((['"]?)([^)'"]+)\\1\\)/);
    return m ? { s: cs(m[2], 300), el: e.tagName.toLowerCase() } : null;
  }).filter(Boolean);
  var midia = {
    video: q('video source,video[src]').slice(0, 6).map(function (v) { return cs(v.getAttribute('src') || v.src || v.getAttribute('poster') || '', 300); }).filter(Boolean),
    iframe: q('iframe[src]').slice(0, 6).map(function (f) { return cs(f.src, 300); }),
  };
  return {
    url: location.href, title: document.title, lang: document.documentElement.lang || '', scope: scope,
    desc: cs(meta('description') || meta('og:description'), 300), ogTitle: meta('og:title'), ogImage: meta('og:image'),
    canonical: (document.querySelector('link[rel=canonical]') || {}).href || '',
    jsonld: jsonld, headings: headings, text: text, tables: tables, lists: lists, links: links, images: images, forms: forms,
    graficos: { svg: svg, canvas: canvas, figuras: figs, backgrounds: bgs, midia: midia },
  };
})()`;
}

const RESOLVE_JS = (sel) => `(() => {
  const sel = ${JSON.stringify(sel)};
  if (sel.startsWith('text=')) {
    const t = sel.slice(5).toLowerCase();
    const all = [...document.querySelectorAll('a,button,input,select,textarea,[role="button"]')];
    const el = all.find(e => (e.innerText || e.value || '').toLowerCase().includes(t));
    return el ? 'FOUND:' + (el.id ? '#'+el.id : el.tagName.toLowerCase()) : 'NOTFOUND';
  }
  const el = document.querySelector(sel);
  if (!el) return 'NOTFOUND';
  el.scrollIntoView({block:'center'});
  return 'FOUND:' + sel;
})()`;

async function cdpGoto(send, url, waitMs = 4000) {
  await send("Page.navigate", { url });
  const wait = Math.min(Math.max(Number(waitMs) || 4000, 500), 25000);
  // Fusão RTT: 1 evaluate in-page com awaitPromise (poll de readyState DENTRO da página,
  // a cada 100ms, com teto próprio) em vez de N polls via CDP (1 send a cada 400ms).
  // Antes: 1 (navigate) + até wait/400 sends. Depois: 1 (navigate) + 1 (wait), +1 retry
  // só se o contexto foi destruído pela navegação (Unsafe: nunca lança por espera).
  const waitExpr = `new Promise((__res) => { const __t0 = Date.now(); const __wait = ${Math.floor(wait)}; const __fin = (v) => { try { __res(v); } catch {} }; const __iv = setInterval(() => { try { if (document.readyState === "complete" || (Date.now() - __t0) > __wait) { clearInterval(__iv); __fin(document.readyState); } } catch { try { clearInterval(__iv); } catch {} __fin("unknown"); } }, 100); try { if (document.readyState === "complete") { clearInterval(__iv); __fin("complete"); } } catch {} setTimeout(() => { try { clearInterval(__iv); } catch {} __fin("timeout"); }, __wait + 500); })`;
  try {
    await send("Runtime.evaluate", { expression: waitExpr, returnByValue: true, awaitPromise: true }, wait + 10000);
  } catch {
    try {
      // retry 1x: o contexto de execução pode ter caído no meio da navegação
      await send("Runtime.evaluate", { expression: waitExpr, returnByValue: true, awaitPromise: true }, wait + 10000);
    } catch {}
  }
  // sem sleep final: o wait in-page acima já garante carga (retorna cedo)
}

async function cdpState(send) {
  const r = await send("Runtime.evaluate", {
    expression: `({title: document.title, url: location.href, text: document.body ? document.body.innerText.slice(0,6000) : '', desc: (document.querySelector('meta[name="description"]')||{}).content||'', ogTitle: (document.querySelector('meta[property="og:title"]')||{}).content||'', ogDesc: (document.querySelector('meta[property="og:description"]')||{}).content||'', links: [...document.querySelectorAll('a[href]')].slice(0,40).map(a=>({text: a.innerText.replace(/\\s+/g,' ').trim().slice(0,80), href: a.href}))})`,
    returnByValue: true,
  }, 15000);
  return r.result?.value || {};
}

function shotFile() { return join(tmpdir(), `opencode-shot-${Date.now().toString(36)}.png`); }

// Drena últimos logs do console via CDP Log/Runtime (enable + escuta curta).
// LIMITE: só capta eventos emitidos após o enable, numa janela de ~1.5s;
// logs anteriores à conexão CDP não são recuperáveis (WS novo por chamada).
async function cdpDrainConsole(send, ws, { timeoutMs = 1500, limit = 30 } = {}) {
  const logs = [];
  const push = (type, text, extra = {}) => {
    if (logs.length >= 200) logs.shift();
    logs.push({ type, text: String(text ?? "").slice(0, 1000), ...extra });
  };
  const onMsg = (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    if (m.method === "Runtime.consoleAPICalled") {
      const args = (m.params?.args || []).map((a) => a.value ?? a.description ?? (a.untranslatedValue !== undefined ? String(a.untranslatedValue) : JSON.stringify(a).slice(0, 500)));
      push(m.params?.type || "log", args.join(" "), { source: "consoleAPI" });
    } else if (m.method === "Runtime.exceptionThrown") {
      push("error", m.params?.exceptionDetails?.text || m.params?.exceptionDetails?.exception?.description || "exception", { source: "exception" });
    } else if (m.method === "Log.entryAdded") {
      push(m.params?.entry?.level || "log", m.params?.entry?.text || "", { source: m.params?.entry?.source || "log" });
    }
  };
  ws.addEventListener("message", onMsg);
  try {
    // Fusão RTT (3→1): só Log.enable aqui. Sem Runtime.enable redundante (runOnWs já
    // habilitou Runtime antes de fn — eventos consoleAPICalled/exceptionThrown exigem isso)
    // e sem Log.disable no fim (a sessão WS fecha no finally do runOnWs; disable seria
    // 1 roundtrip jogado fora).
    try { await send("Log.enable"); } catch {}
    await new Promise((r) => setTimeout(r, Math.min(Math.max(Number(timeoutMs) || 1500, 300), 5000)));
  } finally {
    try { ws.removeEventListener("message", onMsg); } catch {}
  }
  return logs.slice(-Math.max(1, Math.min(Number(limit) || 30, 100)));
}

// Retorna clip {x,y,width,height,scale} do elemento via DOM.getBoxModel.
async function cdpElementClip(send, selector) {
  try {
    await send("DOM.enable");
    const doc = await send("DOM.getDocument", { depth: 1 });
    const q = await send("DOM.querySelector", { nodeId: doc.root.nodeId, selector });
    if (!q.nodeId) throw new Error(`elemento não encontrado: ${selector}`);
    const box = await send("DOM.getBoxModel", { nodeId: q.nodeId });
    const quad = box.content || box.border;
    if (!quad) throw new Error("quad vazio — cai pro fallback DOM-vivo");
    const xs = [quad[0], quad[2], quad[4], quad[6]];
    const ys = [quad[1], quad[3], quad[5], quad[7]];
    const x = Math.max(0, Math.min(...xs));
    const y = Math.max(0, Math.min(...ys));
    const width = Math.max(1, Math.max(...xs) - x);
    const height = Math.max(1, Math.max(...ys) - y);
    try { await send("DOM.scrollIntoViewIfNeeded", { nodeId: q.nodeId }); } catch {}
    await new Promise((r) => setTimeout(r, 300));
    return { x, y, width, height, scale: 1 };
  } catch {
    // Fallback DOM-vivo (Chrome 156: getBoxModel devolve quad vazio em certas sessões —
    // getBoundingClientRect no DOM vivo é imune ao estado do DOM domain; mesma convenção de coords).
    const r = await send("Runtime.evaluate", { expression: `(() => { const e = document.querySelector(${JSON.stringify(String(selector))}); if (!e) return null; e.scrollIntoView({ block: "center", inline: "center" }); const b = e.getBoundingClientRect(); return { x: b.x + window.scrollX, y: b.y + window.scrollY, width: b.width, height: b.height }; })()`, returnByValue: true }, 8000);
    const v = r?.result?.value;
    if (!v || !v.width) throw new Error(`elemento não encontrado ou sem caixa: ${selector}`);
    return { x: Math.max(0, v.x), y: Math.max(0, v.y), width: Math.max(1, v.width), height: Math.max(1, v.height), scale: 1 };
  }
}

// Cookies da página via CDP (Storage.getCookies, fallback Network.getCookies).
// Fusão RTT (2→1 no caminho feliz): Storage.getCookies NÃO exige nenhum domain enable
// (Storage não tem enable), então tenta direto; Network.enable só no fallback, que é o
// único que precisa dele.
async function cdpCookies(send) {
  try {
    const r = await send("Storage.getCookies");
    if (Array.isArray(r.cookies)) return r.cookies;
  } catch {}
  try { await send("Network.enable"); } catch {}
  const r = await send("Network.getCookies");
  return r.cookies || [];
}

// ---- CDP do Chrome do DONO (porta 9222): ver/editar/ler na aba logada, SEM banner ----
// Fonte: toggle "Remote debugging" do chrome://inspect OU --remote-debugging-port no
// launcher (política RemoteDebuggingAllowed reabilita a flag no perfil default; Chrome 136+).
// Chrome 156 desligou a descoberta HTTP (/json/* → 404): fontes = DevToolsActivePort (porta
// + path do browser com UUID) e Target.getTargets SOBRE o WS do browser. O consentimento do
// toggle é POR CONEXÃO → UMA conexão persistente compartilhada (dono permite 1×; a flag no
// launcher é RECUSADA no perfil default do 156 — "requires a non-default data directory").
// MODO EM EFEITO (escolha do dono): toggle OFF — extensão responde tudo (zero cliques); 9222
// só quando o dono arma o toggle. Indisponibilidade carrega __ownerDown → caller
// (tools-owner) cai p/ tab.cdp da extensão (chrome.debugger, banner).
const OWNER_PORT = Number(process.env.CANIVETE_CDP_OWNER_PORT) || 9222;
const OWNER_DIR = process.env.CANIVETE_CDP_OWNER_DIR || join(homedir(), ".config", "google-chrome");
let ownerWs = null;
const ownerPend = new Map();
let ownerId = 0;
function ownerDown(msg) { const e = new Error(msg); e.__ownerDown = true; return e; }
function ownerActivePort() {
  try {
    const [port, path] = readFileSync(join(OWNER_DIR, "DevToolsActivePort"), "utf8").trim().split("\n");
    if (!port || !path) return null;
    return { port: Number(port) || OWNER_PORT, path: path.trim() };
  } catch { return null; }
}
function ownerWsDead() {
  try { ownerWs?.close(); } catch {}
  ownerWs = null;
  for (const [, p] of ownerPend) { clearTimeout(p.t); p.rej(ownerDown("conexão CDP do dono caiu")); }
  ownerPend.clear();
}
async function ownerConnect() {
  if (ownerWs && ownerWs.readyState === 1) return ownerWs;
  const ap = ownerActivePort();
  if (!ap) throw ownerDown(`DevToolsActivePort não encontrado em ${OWNER_DIR} — Chrome do dono sem remote debugging (toggle do chrome://inspect ou flag no launcher)`);
  const ws = new WebSocket(`ws://127.0.0.1:${ap.port}${ap.path}`);
  try {
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(ownerDown(`WS do Chrome do dono não abriu (${WS_OPEN_TIMEOUT_MS}ms) — dialog "Permitir a depuração remota" pendente? Permita 1× (a conexão fica permanente pela sessão do Chrome)`)), WS_OPEN_TIMEOUT_MS);
      ws.onopen = () => { clearTimeout(t); res(); };
      ws.onerror = () => { clearTimeout(t); rej(ownerDown(`porta ${ap.port} do dono recusou a conexão — toggle OFF (modo zero dialogs do dono); p/ 9222, o dono arma o toggle em chrome://inspect e permite 1×`)); };
    });
  } catch (e) { try { ws.close(); } catch {}; ownerWs = null; throw e; }
  ws.onclose = ownerWsDead;
  ws.onerror = ownerWsDead;
  ownerWs = ws;
  return ws;
}
function ownerRaw(method, params = {}, sessionId, timeout = CDP_TIMEOUT_MS) {
  return new Promise((res, rej) => {
    const ws = ownerWs;
    if (!ws || ws.readyState !== 1) return rej(ownerDown("CDP do dono desconectado"));
    const i = ++ownerId;
    const t = setTimeout(() => { ownerPend.delete(i); rej(new Error(`CDP timeout: ${method} (${timeout}ms)`)); }, timeout);
    ownerPend.set(i, { res, rej, t });
    try { ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) })); }
    catch (e) { clearTimeout(t); ownerPend.delete(i); rej(ownerDown(String(e.message || e))); }
  });
}
// Comando CDP em aba do DONO: casa trecho de URL/título em Target.getTargets → attach
// (flatten, invisível ao dono) → send → detach. match: trecho de URL/título ("" = erro
// ambíguo se >1 aba — caller cai p/ extensão, que resolve por tabId).
async function ownerCdpSend(match, method, params = {}) {
  const trecho = String(match || "").toLowerCase().trim();
  const t0 = Date.now();
  await ownerConnect();
  let sessionId = null;
  try {
    let targetInfos;
    try {
      ({ targetInfos } = await ownerRaw("Target.getTargets", {}, undefined, 6000)); // descoberta rápida: pendência de consentimento não trava o caller
    } catch (e) {
      if (/timeout/i.test(String(e.message))) throw ownerDown(`Chrome do dono não respondeu getTargets — dialog "Permitir a depuração remota" pendente? Permita 1× (a conexão do serviço fica permanente pela sessão do Chrome)`);
      throw e;
    }
    const pages = (targetInfos || []).filter((t) => t.type === "page");
    let hit = pages;
    if (trecho) {
      hit = pages.filter((t) => String(t.url || "").toLowerCase().includes(trecho) || String(t.title || "").toLowerCase().includes(trecho));
      if (!hit.length) throw ownerDown(`nenhuma aba do dono casa "${trecho.slice(0, 40)}" (abas: ${pages.map((p) => String(p.url).slice(0, 40)).join(" · ") || "nenhuma"})`);
      if (hit.length > 1) throw ownerDown(`"${trecho.slice(0, 40)}" casa ${hit.length} abas — afine o trecho (${hit.map((p) => String(p.url).slice(0, 45)).join(" · ")})`);
    } else if (pages.length > 1) {
      throw ownerDown(`sem tab:"trecho" e há ${pages.length} abas — passe tab:"trecho" da URL/título (${pages.map((p) => String(p.url).slice(0, 40)).join(" · ")})`);
    }
    ({ sessionId } = await ownerRaw("Target.attachToTarget", { targetId: hit[0].targetId, flatten: true }));
    const result = await ownerRaw(method, params, sessionId);
    return { ok: true, method, result: result ?? null, ms: Date.now() - t0 };
  } finally { if (sessionId) { try { await ownerRaw("Target.detachFromTarget", { sessionId }); } catch {} } }
}
function ownerCdpAvailable() { return !!ownerActivePort(); }

export { ensureBrowser, withCdp, cdpGoto, cdpState, shotFile, cdpDrainConsole, cdpElementClip, cdpCookies, cdpSetTextFirst, cdpSetFullRender, cdpSetViewport, cdpClearViewport, isTextFirstEnabled, TEXT_BLOCK_URLS, PAGE_SNAPSHOT_JS, RESOLVE_JS, pageExtractJs, CHROME_BIN, CDP_PORT, ownerCdpSend, ownerCdpAvailable };
