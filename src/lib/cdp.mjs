// canivete — Chrome headless próprio via CDP (zero deps, WebSocket nativo)
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { UA } from "./ctx.mjs";

const CHROME_BIN = process.env.CANIVETE_CHROME_BIN || ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find((p) => existsSync(p)) || "google-chrome";
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// TEXT-FIRST: navegador em background só texto; render full só no print (screenshot/pdf).
// Desativa com CANIVETE_BROWSER_FULLRENDER=1 (retorna ao comportamento anterior, sem bloqueio).
// NOTA: --blink-settings=imagesEnabled=false (launch) já corta imagens no renderer;
// o bloqueio via Network.setBlockedURLs abaixo é reversível por aba (full render via urls:[]),
// sem tocar em Stylesheet (que quebraria layout p/ print).
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
        "--blink-settings=imagesEnabled=false",
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
    if (el.id) return '#' + el.id;
    const parts = [];
    let n = el;
    for (let d = 0; d < 4 && n && n !== document.body; d++) {
      let s = n.tagName.toLowerCase();
      if (n.className && typeof n.className === 'string') { const c = n.className.trim().split(/\\s+/)[0]; if (c) s += '.' + c.replace(/[^a-zA-Z0-9_-]/g,''); }
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
    expression: `({title: document.title, url: location.href, text: document.body ? document.body.innerText.slice(0,6000) : '', links: [...document.querySelectorAll('a[href]')].slice(0,40).map(a=>({text: a.innerText.replace(/\\s+/g,' ').trim().slice(0,80), href: a.href}))})`,
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
  await send("DOM.enable");
  const doc = await send("DOM.getDocument", { depth: 1 });
  const q = await send("DOM.querySelector", { nodeId: doc.root.nodeId, selector });
  if (!q.nodeId) throw new Error(`elemento não encontrado: ${selector}`);
  const box = await send("DOM.getBoxModel", { nodeId: q.nodeId });
  const quad = box.content || box.border;
  if (!quad) throw new Error(`sem box model p/ ${selector}`);
  const xs = [quad[0], quad[2], quad[4], quad[6]];
  const ys = [quad[1], quad[3], quad[5], quad[7]];
  const x = Math.max(0, Math.min(...xs));
  const y = Math.max(0, Math.min(...ys));
  const width = Math.max(1, Math.max(...xs) - x);
  const height = Math.max(1, Math.max(...ys) - y);
  try { await send("DOM.scrollIntoViewIfNeeded", { nodeId: q.nodeId }); } catch {}
  await new Promise((r) => setTimeout(r, 300));
  return { x, y, width, height, scale: 1 };
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

export { ensureBrowser, withCdp, cdpGoto, cdpState, shotFile, cdpDrainConsole, cdpElementClip, cdpCookies, cdpSetTextFirst, cdpSetFullRender, isTextFirstEnabled, TEXT_BLOCK_URLS, PAGE_SNAPSHOT_JS, RESOLVE_JS, CHROME_BIN, CDP_PORT };
