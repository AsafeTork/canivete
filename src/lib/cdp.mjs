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
        "--hide-scrollbars", "--mute-audio", `--remote-debugging-port=${port}`,
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
  const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
  if (!r.ok) throw new Error(`CDP /json/list HTTP ${r.status}`);
  return await r.json();
}

async function cdpNewPage(url = "about:blank") {
  const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${new URLSearchParams({ url })}`, { method: "PUT" });
  if (!r.ok) throw new Error(`CDP new page [PUT /json/new] falhou p/ ${url}: HTTP ${r.status}`);
  return await r.json();
}

function cdpSend(ws, id, method, params = {}, timeout = 25000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), timeout);
    const onMsg = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.id === id) { clearTimeout(timer); ws.removeEventListener("message", onMsg); m.error ? reject(new Error(`CDP ${method}: ${m.error.message || JSON.stringify(m.error)}`)) : resolve(m.result || {}); }
    };
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

// Abre WS na aba ativa (ou cria uma), habilita Page/Runtime e executa fn({send, target, ws}).
// Perf: reuso de aba — cache tabId+wsUrl por 60s (pula /json/list + /json/new entre chamadas próximas).
let cachedTab = null; // { id, wsUrl, ts }
const TAB_TTL_MS = 60000;

async function openWs(wsUrl, tabHint = "?") {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { const t = setTimeout(() => rej(Object.assign(new Error(`WS CDP timeout [open] na aba ${tabHint}`), { __cdpSetup: true })), 10000); ws.onopen = () => { clearTimeout(t); res(); }; ws.onerror = () => { clearTimeout(t); rej(Object.assign(new Error(`WS CDP falhou [open] na aba ${tabHint}`), { __cdpSetup: true })); }; });
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
      await send("Page.enable");
      await send("Runtime.enable");
    } catch (e) { e.__cdpSetup = true; throw e; }
    return await fn({ send, target, ws });
  } finally { try { ws.close(); } catch {} }
}

async function withCdp(fn, { url } = {}) {
  await ensureBrowser();
  // 1x retry: fecha WS (já fechado no finally do runOnWs), cria nova página e tenta de novo.
  const staleRetry = async (firstErr) => {
    let fresh;
    try {
      fresh = await cdpNewPage(url || "about:blank");
    } catch (e2) {
      throw new Error(`CDP reconexão falhou [new page] na aba ${url || "?"} (orig: ${firstErr.message}): ${e2.message}`);
    }
    const out = await runOnWs(fresh.webSocketDebuggerUrl, fresh, fn, { urlHint: url });
    cachedTab = { id: fresh.id, wsUrl: fresh.webSocketDebuggerUrl, ts: Date.now() };
    return out;
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
  const els = [...document.querySelectorAll('a,button,input,select,textarea,[role="button"],[role="link"],[onclick]')].slice(0,120);
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
  return els.map((el, i) => ({
    ref: i,
    tag: el.tagName.toLowerCase(),
    type: el.type || el.getAttribute('role') || '',
    text: (el.innerText || el.value || el.placeholder || el.getAttribute('aria-label') || '').replace(/\\s+/g,' ').trim().slice(0,100),
    selector: path(el),
  }));
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
  try {
    await new Promise((resolve) => {
      const done = () => resolve();
      const t = setTimeout(done, wait);
      // aguarda load via evento avaliado por polling simples
      (async () => {
        for (let i = 0; i < wait / 400; i++) {
          await new Promise((r) => setTimeout(r, 400));
          try {
            const s = await send("Runtime.evaluate", { expression: "document.readyState", returnByValue: true }, 5000);
            if (s.result?.value === "complete") { clearTimeout(t); resolve(); break; }
          } catch {}
        }
      })();
    });
  } catch {}
  // sem sleep final: o poll de readyState acima já garante carga (retorna cedo)
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
    try { await send("Log.enable"); } catch {}
    try { await send("Runtime.enable"); } catch {}
    await new Promise((r) => setTimeout(r, Math.min(Math.max(Number(timeoutMs) || 1500, 300), 5000)));
  } finally {
    try { ws.removeEventListener("message", onMsg); } catch {}
    try { await send("Log.disable"); } catch {}
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
async function cdpCookies(send) {
  try { await send("Network.enable"); } catch {}
  try {
    const r = await send("Storage.getCookies");
    if (Array.isArray(r.cookies)) return r.cookies;
  } catch {}
  const r = await send("Network.getCookies");
  return r.cookies || [];
}

export { ensureBrowser, withCdp, cdpGoto, cdpState, shotFile, cdpDrainConsole, cdpElementClip, cdpCookies, PAGE_SNAPSHOT_JS, RESOLVE_JS, CHROME_BIN, CDP_PORT };
