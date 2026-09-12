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

const UB_EXPECTED = "7"; // versão do content.js — mismatch = AUTO-REINJETA do disco (sem reload, sem tela)
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

// robustez: aba pode fechar no meio da ação — traduz "No tab with id" p/ erro claro
function isNoTabErr(e) {
  return /no tab with id/i.test(String(e?.message || e || ""));
}
async function getTabOrThrow(id) {
  try {
    return await chrome.tabs.get(id);
  } catch (e) {
    if (isNoTabErr(e)) throw new Error("aba fechou no meio da ação — reliste tabs");
    throw e;
  }
}

async function ensureContent(tabId) {
  // hot-update: disco é a verdade; mismatch de versão = reinjeta sozinho (nunca pede F5/reload)
  let lastErr = "sem resposta";
  let stale = false;
  for (let i = 0; i < 4; i++) {
    try {
      const r = await withTimeout(chrome.tabs.sendMessage(tabId, { cmd: "ping" }), 4000, "content ping");
      if (r?.ok && r?.data?.v === UB_EXPECTED) return;
      if (r?.ok) { stale = true; lastErr = "conteúdo v" + (r?.data?.v || "?") + " (reinjetando v" + UB_EXPECTED + ")"; break; }
      throw new Error(r?.error || "sem content");
    } catch (e) {
      lastErr = e.message || String(e);
      if (/chrome:\/\/|cannot access|no tab/i.test(lastErr)) throw new Error(lastErr);
      await new Promise((r) => setTimeout(r, 250)); // espaçamento entre retries, não espera de processo
    }
  }
  injectedTabs.delete(tabId); // garante reinjeção (mesmo se já injetado antes)
  try {
    await withTimeout(chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] }), 12000, "injetar content");
    injectedTabs.add(tabId);
    await new Promise((r) => setTimeout(r, 250)); // espaçamento p/ content inicializar após injeção
    const r = await withTimeout(chrome.tabs.sendMessage(tabId, { cmd: "ping" }), 4000, "content ping2");
    if (r?.ok) return; // aceita a versão do disco (verdade atual)
  } catch (e) { lastErr = e.message || String(e); }
  throw new Error("página sem responder (" + lastErr.slice(0, 100) + ") — recarregue a página (F5)");
}

async function ask(tabId, cmd, args) {  await ensureContent(tabId);
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
    const rawUrl = String(a.url).trim();
    if (!/^(https?:\/\/|about:)/i.test(rawUrl))
      throw new Error(`url inválida "${rawUrl.slice(0, 120)}" — use http(s):// ou about: (navegação bloqueada antes de navegar)`);
    const id = a.tabId || (await activeTabId());
    await getTabOrThrow(id);
    const max = normWait(a);
    const t0 = Date.now();
    const loadedP = waitLoad(id, max); // listener antes de navegar p/ não perder o evento
    try {
      await chrome.tabs.update(id, { url: rawUrl }); // erro de navegação retorna na hora
    } catch (e) {
      if (isNoTabErr(e)) throw new Error("aba fechou no meio da ação — reliste tabs");
      throw e;
    }
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
  if (cmd === "tab.scroll" && a.text) {
    // rola até elemento com texto (via MAIN): encontra por innerText includes, scrollIntoView
    const id = a.tabId || (await activeTabId());
    const [sr] = await withTimeout(chrome.scripting.executeScript({
      target: { tabId: id },
      world: "MAIN",
      func: (q) => {
        const needle = String(q).toLowerCase();
        const els = [...document.querySelectorAll("*")].filter((e) => {
          const t = (e.innerText || "").toLowerCase();
          return t && t.includes(needle);
        });
        if (!els.length) return { scrolled: false, found: false };
        els.sort((x, y) => (x.innerText.length || 0) - (y.innerText.length || 0));
        const el = els[0];
        try { el.scrollIntoView({ block: "center", behavior: "instant" }); } catch { el.scrollIntoView(); }
        return { scrolled: true, found: true };
      },
      args: [String(a.text)],
    }), 15000, "content tab.scroll");
    return sr?.result || { scrolled: false, found: false };
  }
  if (["tab.read", "tab.snapshot", "tab.click", "tab.fill", "tab.press", "tab.scroll"].includes(cmd)) {
    const id = a.tabId || (await activeTabId());
    // gate de senha REMOVIDO a pedido do dono: fill/type em type=password liberado (risco segue classificado no MCP)
    // destilado por padrão (só-necessário); raw opt-out
    if (cmd === "tab.read" && (a.mode || "distill") === "distill") {
      const d = await ask(id, "distill", a);
      if (a.headingsOnly === true && d && typeof d.markdown === "string") {
        const kept = d.markdown.split("\n").filter((ln) => /^#\s/.test(ln) || /\[.+?\]\(.+?\)/.test(ln));
        const md = kept.join("\n").slice(0, 2000); // <500 tokens: só h1-h6 + links p/ mapear página gigante
        return { ...d, markdown: md, stats: { ...(d.stats || {}), linhas: kept.length, headingsOnly: true, chars: md.length } };
      }
      return d;
    }
    if (cmd === "tab.read" && a.links === false) a.maxLinks = 0; // dica p/ content pular coleta
    const map = {
      "tab.read": "read", "tab.snapshot": "snapshot", "tab.click": "click",
      "tab.fill": "fill", "tab.press": "press", "tab.scroll": "scroll", "tab.html": "html",
    };
    const data = await ask(id, map[cmd], a); // content já faz settle antes de responder — sem sleep
    if (cmd === "tab.read" && a.links === false && data && typeof data === "object" && !Array.isArray(data)) {
      const { links, ...rest } = data; // raw sem links: só título+texto (~40% menos)
      return rest;
    }
    if (cmd === "tab.snapshot" && Array.isArray(data)) {
      const off = Math.max(Number(a.offset) || 0, 0);
      const page = data.slice(off, off + Math.min(Math.max(Number(a.max) || 50, 5), 120));
      if (a.compact === true) return page.map((it) => ({ ref: it.ref, tag: it.tag, text: it.text, x: it.x, y: it.y })); // sem selector/type/w/h (~60% menos, espelha headless)
      return page;
    }
    if (cmd === "tab.click" || cmd === "tab.fill") return await ask(id, "state", {}); // dieta: sem texto
    return data;
  }
  if (cmd === "tab.cursor") {
    // cursor INDEPENDENTE: {x,y} na viewport (+click opcional) ou {selector} (+click)
    const id = a.tabId || (await activeTabId());
    await getTabOrThrow(id);
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
  // ---- WhatsApp Web dedicado (seletores data-testid estáveis; sem classes minificadas) ----
  // ---- Store interno do WhatsApp (padrão venom/wppconnect): funcs estáticas, sem eval ----
  // (waExec legado com func inline removido — tudo via wa-hook.js + waStore)
  async function waStore(id, op, args = {}) {
    await withTimeout(chrome.scripting.executeScript({ target: { tabId: id }, world: "MAIN", files: ["wa-hook.js"] }), 15000, "injetar wa-hook");
    const [r] = await withTimeout(
      chrome.scripting.executeScript({ target: { tabId: id }, world: "MAIN", func: (o, a) => (window.__ubWA ? window.__ubWA.cmd(o, a) : { error: "hook-off" }), args: [op, args] }),
      25000,
      "wa store " + op
    );
    if (!r) throw new Error("wa sem resposta");
    if (r.error) throw new Error(r.error);
    return r.result;
  }
  async function waTab(a) {
    if (a.tabId) return a.tabId;
    if (a.tab) {
      const needle = String(a.tab).toLowerCase();
      const all = await chrome.tabs.query({});
      const f = all.find((t) => ((t.title || "") + " " + (t.url || "")).toLowerCase().includes(needle) || (t.url || "").includes("web.whatsapp.com"));
      if (f) return f.id;
    }
    const all = await chrome.tabs.query({ url: ["*://web.whatsapp.com/*"] });
    if (all.length) return all[0].id;
    return await activeTabId();
  }
  if (["tab.wa_state", "tab.wa_chats", "tab.wa_open", "tab.wa_read", "tab.wa_send", "tab.wa_ids"].includes(cmd)) {
    // Store interno primeiro (padrão venom/wppconnect: sem eval, sem clique); DOM como fallback
    const id = await waTab(a);
    const sub = { "tab.wa_state": "wa_state", "tab.wa_chats": "wa_chats", "tab.wa_open": "wa_open", "tab.wa_read": "wa_read", "tab.wa_send": "wa_send", "tab.wa_ids": "wa_ids" }[cmd];
    const op = { "tab.wa_state": "state", "tab.wa_chats": "chats", "tab.wa_open": "open", "tab.wa_read": "read", "tab.wa_send": "send", "tab.wa_ids": "ids" }[cmd];
    try {
      const r = await waStore(id, op, { name: a.name, text: a.text, limit: a.limit, chatName: a.name });
      if (r && !r.error) return r;
    } catch (e) {
      diag.lastError = "wa-store: " + String(e.message || e).slice(0, 100);
    }
    return await ask(id, sub, a);
  }
  if (cmd === "tab.reinject") {
    // hot-update forçado: reinjeta content.js do disco e retorna a versão ativa (sem reload, sem tela)
    const id = a.tabId || (await activeTabId());
    injectedTabs.delete(id);
    await withTimeout(chrome.scripting.executeScript({ target: { tabId: id }, files: ["content.js"] }), 12000, "reinjetar content");
    await new Promise((r) => setTimeout(r, 300));
    const r = await withTimeout(chrome.tabs.sendMessage(id, { cmd: "ping" }), 4000, "content ping-reinject");
    return { reinjected: true, v: r?.data?.v || "?" };
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
    const t = await getTabOrThrow(id);
    const url = await chrome.tabs.captureVisibleTab(t.windowId, { format: "png" });
    return { dataUrl: url, tab: { id, title: t.title, url: t.url } };
  }
  if (cmd === "tab.count") {
    if (!a.selector) throw new Error("selector obrigatório");
    const id = a.tabId || (await activeTabId());
    const [sr] = await withTimeout(chrome.scripting.executeScript({
      target: { tabId: id },
      world: "MAIN",
      func: (sel) => document.querySelectorAll(sel).length,
      args: [String(a.selector)],
    }), 15000, "content tab.count");
    return { count: sr?.result ?? 0 };
  }
  if (cmd === "tab.attr") {
    if (!a.selector) throw new Error("selector obrigatório");
    if (!a.name) throw new Error("name obrigatório");
    const id = a.tabId || (await activeTabId());
    const [sr] = await withTimeout(chrome.scripting.executeScript({
      target: { tabId: id },
      world: "MAIN",
      func: (sel, name) => {
        const el = document.querySelector(sel);
        if (!el) return { found: false, value: null };
        let v = null;
        if (name === "text") v = el.innerText ?? el.textContent ?? "";
        else if (name === "html") v = (el.outerHTML || "").slice(0, 4000);
        else if (name === "value" && "value" in el) v = el.value;
        else v = el.getAttribute(name) ?? el[name] ?? null;
        if (typeof v === "string") v = v.slice(0, 4000);
        return { found: true, value: v };
      },
      args: [String(a.selector), String(a.name)],
    }), 15000, "content tab.attr");
    return sr?.result || { found: false, value: null };
  }
  // flow: sequência atômica numa só ida-volta (eficiente: 1 poll, 1 tab, N passos)
  if (cmd === "tab.flow") {
    const steps = Array.isArray(a.steps) ? a.steps.slice(0, 12) : [];
    if (!steps.length) throw new Error("steps: array não-vazio (máx 12)");
    const id = a.tabId || (await activeTabId());
    const out = [];
    for (const s of steps) {
      try {
        const r = await handle(s.cmd, { ...a, ...s, tabId: id });
        out.push({ cmd: s.cmd, ok: true, data: r });
        if (s.stopOn && JSON.stringify(r).includes(s.stopOn)) break;
      } catch (e) {
        return { steps: out, failedStep: s.cmd, error: String(e.message || e).slice(0, 300) };
      }
    }
    return { steps: out };
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
