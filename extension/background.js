// UBrowser Bridge — service worker.
// Conecta no bridge local (MCP) via long-poll HTTP e executa comandos NESTE Chrome logado.
// Kill switch: enabled=false pausa tudo (popup).
const DEFAULT_URL = "http://127.0.0.1:19422";
let settings = { token: "", enabled: true, url: DEFAULT_URL };
let running = false;

async function load() {
  const s = await chrome.storage.local.get(["token", "enabled", "url"]);
  settings = { token: s.token || "", enabled: s.enabled !== false, url: s.url || DEFAULT_URL };
}
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== "local") return;
  if (ch.token) settings.token = ch.token.newValue || "";
  if (ch.enabled) settings.enabled = ch.enabled.newValue !== false;
  if (ch.url) settings.url = ch.url.newValue || DEFAULT_URL;
});

const UB_EXPECTED = "6"; // versão do content.js — mismatch = F5 na página
const injectedTabs = new Set(); // fallback manual 1x por aba/sessão (registro cobre o resto)

// registra content.js permanente: injeta sozinho em toda página http/https (sobrevive a F5/navegação)
(async () => {
  try {
    await chrome.scripting.unregisterContentScripts({ ids: ["ub-main"] }).catch(() => {});
    await chrome.scripting.registerContentScripts([
      { id: "ub-main", matches: ["http://*/*", "https://*/*"], js: ["content.js"], runAt: "document_start", persistAcrossSessions: true },
    ]);
  } catch (e) { diag.lastError = "regcs: " + String(e.message || e).slice(0, 100); }
})();

async function activeTabId() {
  const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!t) throw new Error("sem aba ativa");
  return t.id;
}

function withTimeout(p, ms, what) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(what + " (timeout " + ms / 1000 + "s — recarregue a página)")), ms)),
  ]);
}

async function ensureContent(tabId) {
  // 1) ping (registro permanente cobre http/https); 2) fallback: injeção manual 1x/sessão; 3) erro claro
  let lastErr = "sem resposta";
  for (let i = 0; i < 4; i++) {
    try {
      const r = await withTimeout(chrome.tabs.sendMessage(tabId, { cmd: "ping" }), 4000, "content ping");
      if (r?.ok && r?.data?.v === UB_EXPECTED) return;
      if (r?.ok) throw new Error("conteúdo v" + (r?.data?.v || "?") + " desatualizado — F5 na página");
      throw new Error(r?.error || "sem content");
    } catch (e) {
      lastErr = e.message || String(e);
      if (/desatualizado|chrome:\/\/|cannot access|no tab|F5/i.test(lastErr)) throw new Error(lastErr);
      await new Promise((r) => setTimeout(r, 250)); // espaçamento entre retries, não espera de processo
    }
  }
  if (!injectedTabs.has(tabId)) {
    try {
      await withTimeout(chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] }), 12000, "injetar content");
      injectedTabs.add(tabId);
      await new Promise((r) => setTimeout(r, 250)); // espaçamento p/ content inicializar após injeção
      const r = await withTimeout(chrome.tabs.sendMessage(tabId, { cmd: "ping" }), 4000, "content ping2");
      if (r?.ok) return;
    } catch (e) { lastErr = e.message || String(e); }
  }
  throw new Error("página sem responder (" + lastErr.slice(0, 100) + ") — recarregue a página (F5)");
}

async function ask(tabId, cmd, args) {
  await ensureContent(tabId);
  const r = await withTimeout(chrome.tabs.sendMessage(tabId, { cmd, args }), 15000, "content " + cmd);
  if (!r?.ok) throw new Error(r?.error || "content falhou");
  return r.data;
}

function normWait(a) {
  return Math.min(Math.max(Number(a?.waitMs) || 1800, 500), 15000);
}

// aguarda EVENTO de load (onUpdated complete) com teto; retorna elapsed ms. Erro de navegação propaga na hora.
function waitLoad(tabId, maxMs) {
  const t0 = Date.now();
  return new Promise((res) => {
    const to = setTimeout(() => { chrome.tabs.onUpdated.removeListener(fn); res(Date.now() - t0); }, maxMs);
    const fn = (tid, info) => {
      if (tid === tabId && info.status === "complete") {
        clearTimeout(to); chrome.tabs.onUpdated.removeListener(fn); res(Date.now() - t0);
      }
    };
    chrome.tabs.onUpdated.addListener(fn);
  });
}

async function handle(cmd, a = {}) {
  // resolução de aba por nome: vale p/ todos os comandos que aceitam tabId
  if (a && a.tab && !a.tabId) {
    const needle = String(a.tab).toLowerCase();
    const all = await chrome.tabs.query({});
    const found = all.find((t) => ((t.title || "") + " " + (t.url || "")).toLowerCase().includes(needle));
    if (!found) throw new Error(`aba "${a.tab}" não encontrada — veja n_ubrowser_tabs`);
    a.tabId = found.id;
  }
  if (cmd === "ping") return { pong: true, url: settings.url };
  if (cmd === "tab.diag") return { ...diag, enabled: settings.enabled, hasToken: !!settings.token, url: settings.url };
  if (cmd === "tabs.list") {
    const [tabs, wins, incog] = await Promise.all([
      chrome.tabs.query({}),
      chrome.windows.getAll({}),
      chrome.extension.isAllowedIncognitoAccess().catch(() => false),
    ]);
    const byWin = {};
    for (const t of tabs) byWin[t.windowId] = (byWin[t.windowId] || 0) + 1;
    return {
      tabs: tabs.slice(0, 50).map((t) => ({ id: t.id, windowId: t.windowId, incognito: !!t.incognito, pinned: !!t.pinned, title: (t.title || "").slice(0, 100), url: t.url || "", active: !!t.active })),
      windows: wins.map((w) => ({ id: w.id, focused: !!w.focused, incognito: !!w.incognito, state: w.state, tabs: byWin[w.id] || 0 })),
      incognitoAllowed: !!incog,
    };
  }
  if (cmd === "tab.focus") {
    throw new Error("ROUBAR FOCO É PROIBIDO pelo dono (removido do MCP)");
  }
  if (cmd === "tab.goto") {
    if (!a.url) throw new Error("url obrigatória");
    const id = a.tabId || (await activeTabId());
    const max = normWait(a);
    const t0 = Date.now();
    const loadedP = waitLoad(id, max); // listener antes de navegar p/ não perder o evento
    await chrome.tabs.update(id, { url: a.url }); // erro de navegação retorna na hora
    await loadedP; // evento complete ou teto
    const resto = max - (Date.now() - t0);
    if (resto > 0) await ask(id, "settle", { timeoutMs: resto }).catch(() => {}); // aquieta DOM, best-effort
    return await ask(id, "state", {}); // dieta: só título+url (leia explícito se precisar do texto)
  }
  if (cmd === "tab.new") {
    // aba INDEPENDENTE: SEMPRE em fundo (active:false) — nunca rouba foco
    const t = await chrome.tabs.create({ url: a.url || "about:blank", active: false });
    // espera carregar (por evento) pra já sair usável
    if (a.url) {
      await new Promise((res) => {
        const to = setTimeout(() => { chrome.tabs.onUpdated.removeListener(fn); res(); }, 12000);
        const fn = (tid, info) => {
          if (tid === t.id && info.status === "complete") {
            clearTimeout(to); chrome.tabs.onUpdated.removeListener(fn); res();
          }
        };
        chrome.tabs.onUpdated.addListener(fn);
      });
    }
    return { id: t.id, url: t.url || a.url, background: !t.active };
  }
  if (cmd === "tab.close") {
    throw new Error("FECHAR ABAS É PROIBIDO pelo dono (removido do MCP)");
  }
  if (cmd === "tab.back" || cmd === "tab.forward" || cmd === "tab.reload") {
    const id = a.tabId || (await activeTabId());
    const max = normWait(a);
    const t0 = Date.now();
    const loadedP = waitLoad(id, max); // listener antes de navegar
    if (cmd === "tab.back") await chrome.tabs.goBack(id).catch(() => { throw new Error("sem histórico p/ voltar"); });
    if (cmd === "tab.forward") await chrome.tabs.goForward(id).catch(() => { throw new Error("sem histórico p/ avançar"); });
    if (cmd === "tab.reload") await chrome.tabs.reload(id); // erro retorna na hora
    await loadedP; // evento complete ou teto
    const resto = max - (Date.now() - t0);
    if (resto > 0) await ask(id, "settle", { timeoutMs: resto }).catch(() => {});
    return await ask(id, "state", {}); // dieta: só título+url
  }
  if (["tab.read", "tab.snapshot", "tab.click", "tab.fill", "tab.press", "tab.scroll"].includes(cmd)) {    const id = a.tabId || (await activeTabId());
    // destilado por padrão (só-necessário); raw opt-out
    if (cmd === "tab.read" && (a.mode || "distill") === "distill") return await ask(id, "distill", a);
    const map = {
      "tab.read": "read", "tab.snapshot": "snapshot", "tab.click": "click",
      "tab.fill": "fill", "tab.press": "press", "tab.scroll": "scroll",
    };
    const data = await ask(id, map[cmd], a); // content já faz settle antes de responder — sem sleep
    if (cmd === "tab.snapshot" && Array.isArray(data)) {
      const off = Math.max(Number(a.offset) || 0, 0);
      return data.slice(off, off + Math.min(Math.max(Number(a.max) || 50, 5), 120));
    }
    if (cmd === "tab.click" || cmd === "tab.fill") return await ask(id, "state", {}); // dieta: sem texto
    return data;
  }
  if (cmd === "tab.cursor") {
    // cursor INDEPENDENTE: {x,y} na viewport (+click opcional) ou {selector} (+click)
    const id = a.tabId || (await activeTabId());
    if (a.selector) return await ask(id, "cursor_sel", a);
    const data = await ask(id, "cursor", a); // content já faz settle antes de responder — sem sleep
    if (a.click) return { ...data, ...(await ask(id, "state", {})) };
    return data;
  }
  if (cmd === "tab.scan") {
    // varre lista virtualizada (ex: WhatsApp) com scroll coletando snapshot
    const { container, tabId, pages = 4 } = a;
    const pagesReq = Math.min(Math.max(Number(pages) || 4, 1), 10);
    const id = tabId || (await activeTabId());
    const scanJob = (async () => {
      const seen = new Map();
      let lastY = null;
      let same = 0;
      let reachedEnd = false;
      let executed = 0;
      for (let i = 0; i < pagesReq; i++) {
        executed = i + 1;
        const snap = await ask(id, "snapshot");
        const arr = Array.isArray(snap) ? snap : [];
        for (const it of arr) {
          const key = (it?.selector || "") + "|" + (it?.text || "");
          if (!seen.has(key)) seen.set(key, it);
        }
        if (i === pagesReq - 1) break;
        const [sr] = await chrome.scripting.executeScript({
          target: { tabId: id },
          world: "MAIN",
          func: (sel) => {
            const el = sel ? document.querySelector(sel) : (document.scrollingElement || document.body);
            if (!el) return { y: 0, max: 0 };
            const isDoc = !sel || el === document.scrollingElement || el === document.body || el === document.documentElement;
            if (isDoc) {
              window.scrollBy(0, window.innerHeight * 0.9);
              return { y: window.scrollY, max: document.documentElement.scrollHeight - window.innerHeight };
            }
            el.scrollBy(0, (el.clientHeight || window.innerHeight) * 0.9);
            return { y: el.scrollTop, max: el.scrollHeight - el.clientHeight };
          },
          args: [container || null],
        });
        const y = sr?.result?.y;
        if (typeof y === "number") {
          if (y === lastY) {
            same++;
            if (same >= 2) { reachedEnd = true; break; }
          } else {
            same = 0;
            lastY = y;
          }
        }
        // verificação por evento: novo snapshot; se contagem/último item mudou, segue IMEDIATO
        const prevCount = arr.length;
        const prevLast = arr.length ? ((arr[arr.length - 1]?.selector || "") + "|" + (arr[arr.length - 1]?.text || "")) : "";
        const pollT0 = Date.now();
        while (Date.now() - pollT0 < 1500) { // teto por página; total 60s mantido via withTimeout
          const s2 = await ask(id, "snapshot");
          const a2 = Array.isArray(s2) ? s2 : [];
          for (const it of a2) {
            const key = (it?.selector || "") + "|" + (it?.text || "");
            if (!seen.has(key)) seen.set(key, it);
          }
          const last2 = a2.length ? ((a2[a2.length - 1]?.selector || "") + "|" + (a2[a2.length - 1]?.text || "")) : "";
          if (a2.length !== prevCount || last2 !== prevLast) break; // mudou → segue imediato
          await new Promise((r) => setTimeout(r, 150)); // espaçamento entre verificações, não sleep cego
        }
      }
      const items = [...seen.values()];
      const yx = (it) => {
        if (!it || typeof it !== "object") return null;
        if (typeof it.y === "number" && typeof it.x === "number") return [it.y, it.x];
        if (typeof it.top === "number" && typeof it.left === "number") return [it.top, it.left];
        for (const k of ["coords", "rect", "bbox", "box", "pos"]) {
          const c = it[k];
          if (!c || typeof c !== "object") continue;
          if (typeof c.y === "number" && typeof c.x === "number") return [c.y, c.x];
          if (typeof c.top === "number" && typeof c.left === "number") return [c.top, c.left];
        }
        return null;
      };
      if (items.some((it) => yx(it))) items.sort((p, q) => {
        const a = yx(p), b = yx(q);
        if (!a && !b) return 0;
        if (!a) return 1;
        if (!b) return -1;
        return (a[0] - b[0]) || (a[1] - b[1]);
      });
      return { items: items.slice(0, 150), pages: executed, reachedEnd };
    })();
    return await withTimeout(scanJob, 60000, "tab.scan");
  }
  if (cmd === "tab.evaluate") {
    if (!a.js) throw new Error("js obrigatório");
    const id = a.tabId || (await activeTabId());
    let r;
    try {
      [r] = await withTimeout(chrome.scripting.executeScript({ target: { tabId: id }, world: "MAIN", func: (code) => eval(code), args: [String(a.js)] }), 20000, "evaluate (página pode estar ocupada/bloqueando script)");
    } catch (e) {
      throw new Error("evaluate falhou: " + String(e.message || e).slice(0, 200) + " (CSP pode bloquear eval)");
    }
    const ex = r?.exceptionDetails || r?.error;
    if (ex) {
      let msg = ex.message || ex.description || (ex.exception && ex.exception.description);
      if (!msg) {
        try { msg = JSON.stringify(ex).slice(0, 300); } catch { msg = String(ex); }
      }
      throw new Error("evaluate falhou: " + String(msg).slice(0, 300) + " (CSP pode bloquear eval)");
    }
    const v = r?.result;
    if (typeof v === "undefined") return { value: null, note: "expressão não retornou valor — termine o JS com o valor desejado" };
    return { value: typeof v === "string" ? v.slice(0, 4000) : v };
  }
  if (cmd === "tab.shot") {
    // NUNCA troca de aba: só fotografa a aba VISÍVEL (fundo = sem print, use read)
    const id = a.tabId || (await activeTabId());
    const cur = await activeTabId().catch(() => null);
    if (cur && cur !== id) throw new Error("print só na aba VISÍVEL (fundo: use read/snapshot) — foco é intocável");
    const t = await chrome.tabs.get(id);
    const url = await chrome.tabs.captureVisibleTab(t.windowId, { format: "png" });
    return { dataUrl: url, tab: { id, title: t.title, url: t.url } };
  }
  if (cmd.startsWith("tab.")) {
    const id = a.tabId || (await activeTabId());
    return await ask(id, cmd.slice(4), a);
  }
  throw new Error("cmd desconhecido: " + cmd);
}

async function pollOnce() {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 30000);
  try {
    const r = await fetch(settings.url + "/poll?token=" + encodeURIComponent(settings.token), { signal: ctl.signal });
    if (r.status === 204) return null;
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } catch (e) {
    if (e.name === "AbortError") return null;
    throw e;
  } finally {
    clearTimeout(t);
  }
}

async function result(id, ok, data, error) {
  await fetch(settings.url + "/result?token=" + encodeURIComponent(settings.token), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, ok, data, error: error ? String(error).slice(0, 500) : undefined }),
  }).catch(() => {});
}

async function hello() {
  try {
    const tabs = await chrome.tabs.query({});
    await fetch(settings.url + "/hello?token=" + encodeURIComponent(settings.token), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ info: { tabs: tabs.length, ua: navigator.userAgent.slice(0, 80) } }),
    });
    diag.helloOk = new Date().toLocaleTimeString();
  } catch (e) { diag.lastError = "hello: " + (e.message || e); }
  saveDiag();
}

// diagnóstico visível no popup
const diag = { polls: 0, lastPollOk: "-", lastError: "-", helloOk: "-", startedAt: new Date().toLocaleTimeString() };
let diagT = 0, loopBeat = 0;
function saveDiag() {
  const now = Date.now();
  if (now - diagT < 2000) return;
  diagT = now;
  chrome.storage.local.set({ diag }).catch(() => {});
}

async function loop() {
  if (running) return;
  running = true;
  try { await load(); } catch (e) { diag.lastError = "load: " + String(e.message || e).slice(0, 100); }
  try { await hello(); } catch (e) { diag.lastError = "hello: " + String(e.message || e).slice(0, 100); }
  let backoff = 1000;
  while (true) {
    loopBeat = Date.now();
    try { await load(); } catch {}
    if (!settings.enabled || !settings.token) {
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    try {
      const job = await pollOnce();
      backoff = 1000;
      diag.polls++;
      diag.lastPollOk = new Date().toLocaleTimeString();
      diag.lastError = "-";
      saveDiag();
      if (!job) { await new Promise((r) => setTimeout(r, 1000)); continue; }
      try {
        const data = await handle(job.cmd, job.args || {});
        await result(job.id, true, data);
      } catch (e) {
        await result(job.id, false, null, e.message);
      }
    } catch (e) {
      diag.lastError = new Date().toLocaleTimeString() + " " + (e.message || e).slice(0, 120);
      saveDiag();
      await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, 15000);
    }
  }
}

// status p/ popup
chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (msg.cmd === "status") reply({ enabled: settings.enabled, hasToken: !!settings.token, url: settings.url });
  if (msg.cmd === "diag") reply({ ...diag, enabled: settings.enabled, hasToken: !!settings.token });
  if (msg.cmd === "pingBridge") {
    (async () => {
      try {
        const r = await fetch(settings.url + "/health", { signal: AbortSignal.timeout(5000) });
        reply({ ok: r.ok, http: r.status, body: (await r.text()).slice(0, 120) });
      } catch (e) { reply({ ok: false, error: String(e.message || e).slice(0, 160) }); }
    })();
    return true;
  }
  return false;
});

chrome.alarms.create("keepalive", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(() => {
  // cão de guarda: se o loop travou há >90s, reinicia
  try {
    if (!loopBeat || Date.now() - loopBeat > 90000) { running = false; loop().catch(() => {}); }
    else loop().catch(() => {});
  } catch {}
});
chrome.runtime.onStartup.addListener(() => loop());
chrome.runtime.onInstalled.addListener(() => loop());
loop().catch(() => { running = false; setTimeout(() => { try { loop().catch(() => {}); } catch {} }, 5000); });
