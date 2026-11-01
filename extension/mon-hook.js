// ubrowser — hook de observabilidade (mundo MAIN, idempotente).
// Captura console (5 níveis) + erros JS + fetch/XHR (status+corpo capado).
// Injetado via executeScript (world MAIN) no ensureContent — sem permissão nova.
// Limites: só vê o que acontece DEPOIS da 1ª injeção (load inicial escapa);
// headers/cookies NUNCA logados (sem segredo no buffer); corpos capados em 1500 chars.
// v4: tags de contexto (window.__ubTags → area/agent/app) anexadas ao alert+clip;
// replay opt-in: __ubReplay=true + window.rrweb presente → grava janela rolling de
// 2400 eventos e, no erro (1 por 45s), dispara __ubReplayClip p/ a ponte /replay.
(function () {
  // v4: sempre wrap console, MAS o mute é consultado AO VIVO em __ubMon.quiet —
  // o background pode flipar a qualquer momento (ensureContent injeta o setter
  // DEPOIS do mon-hook: mount roubado por reinício de SW se autocorrige sem F5).
  // Buffer push SEMPRE (diagnóstico completo); o console só re-emit quando !quiet
  // (com dedupe 60s/assinatura). Miten error/unhandledrejection/fetch/XHR intactos.
  if (window.__ubMon && window.__ubMon.v >= 4) return;
  const EVENTS_MAX = 2400; // janela rolling do replay (cap de memória do clipe)
  const log = [];
  // tags de contexto: só area/agent/app, String ≤40, valores truthy (a página/agente seta __ubTags)
  function ubTags() {
    try {
      const t = window.__ubTags;
      if (!t || typeof t !== "object") return undefined;
      const o = {};
      for (const k of ["area", "agent", "app"]) if (t[k]) o[k] = String(t[k]).slice(0, 40);
      return Object.keys(o).length ? o : undefined;
    } catch { return undefined; }
  }
  const push = (e) => {
    try {
      log.push({ t: Date.now(), ...e });
      if (log.length > 120) log.splice(0, log.length - 120);
      // push proativo: erro pula na hora p/ content (→ background → bridge → MCP),
      // sem esperar poll. Só erro (js-error/promise/console.error/net-fail).
      const k = e.kind, lv = e.level;
      const isErr = k === "js-error" || k === "promise" || lv === "error" || (k === "net" && (e.status === 0 || e.status >= 400));
      if (isErr) {
        const tags = ubTags();
        try { window.dispatchEvent(new CustomEvent("__ubMonAlert", { detail: { t: Date.now(), ...e, ...(tags ? { tags } : {}) } })); } catch {}
        try { clipSend(e); } catch {} // v4: clipe de replay do erro (opt-in, ver clipSend)
      }
    } catch {}
  };
  const capStr = (s, n) => String(s === undefined || s === null ? "" : s).slice(0, n || 2000);
  const argStr = (a) => {
    try {
      if (typeof a === "string") return a;
      return JSON.stringify(a);
    } catch {
      return String(a);
    }
  };
  // Wrapper ÚNICO com mute ao vivo (quiet em __ubMon.quiet, flipável por setter):
  // quiet → engole o re-emit (o inspector não vê NADERIA atribuído) e segue p/ buffer;
  // !quiet → dedupe (1ª ocorrência por assinatura/60s passa, re-emissões silenciam).
  {
    const dedupe = new Map(); // sig -> ms da 1ª emissão
    const DEDUPE_MS = 60000, DEDUPE_MAX = 60;
    for (const lvl of ["log", "info", "warn", "error", "debug"]) {
      try {
        const orig = console[lvl].bind(console);
        console[lvl] = function () {
          let text = "";
          try {
            text = Array.prototype.map.call(arguments, argStr).join(" ").slice(0, 2000);
            push({ kind: "console", level: lvl, text }); // buffer: sempre
          } catch {}
          try {
            const muted = window.__ubMon && window.__ubMon.quiet === true; // AO VIVO
            const now = Date.now();
            if (!muted) {
              const first = dedupe.get(lvl + "|" + text);
              if (first !== undefined && now - first < DEDUPE_MS) return undefined;
              if (dedupe.size >= DEDUPE_MAX) { const k0 = dedupe.keys().next().value; try { dedupe.delete(k0); } catch {} }
              dedupe.set(lvl + "|" + text, now);
            }
            if (muted) return undefined; // colapsa layers velhos por baixo (v2 montados a mais)
            return orig.apply(null, arguments);
          } catch {}
          return orig.apply(null, arguments);
        };
      } catch {}
    }
  }
  window.addEventListener("error", (e) => {
    try { push({ kind: "js-error", text: capStr(e.message, 500), src: capStr(e.filename, 200), line: e.lineno || 0 }); } catch {}
  }, true);
  window.addEventListener("unhandledrejection", (e) => {
    try {
      const r = e.reason;
      push({ kind: "promise", text: capStr((r && (r.message || r)) || r, 500) });
    } catch {}
  }, true);
  try {
    const nf = window.fetch.bind(window);
    window.fetch = async function () {
      const args = Array.prototype.slice.call(arguments);
      let url = "", method = "GET";
      try {
        const first = args[0];
        url = String((first && (first.url || first)) || "").slice(0, 300);
        method = String((args[1] && args[1].method) || "GET").toUpperCase();
      } catch {}
      const t0 = Date.now();
      try {
        const res = await nf.apply(null, args);
        let body = "";
        try { body = await res.clone().text(); } catch {}
        push({ kind: "net", method, url, status: res.status || 0, ms: Date.now() - t0, body: body.slice(0, 1500) });
        return res;
      } catch (e) {
        push({ kind: "net", method, url, status: 0, ms: Date.now() - t0, error: capStr(e && e.message, 300) });
        throw e;
      }
    };
  } catch {}
  try {
    const XO = window.XMLHttpRequest;
    if (XO && XO.prototype) {
      const origOpen = XO.prototype.open, origSend = XO.prototype.send;
      XO.prototype.open = function (m, u) {
        try { this.__ubM = String(m || "GET").toUpperCase(); this.__ubU = String(u || "").slice(0, 300); } catch {}
        return origOpen.apply(this, arguments);
      };
      XO.prototype.send = function () {
        const self = this, t0 = Date.now();
        const done = () => {
          try {
            let body = "";
            try { body = String(self.responseText || "").slice(0, 1500); } catch {}
            push({ kind: "net", method: self.__ubM || "?", url: self.__ubU || "?", status: self.status || 0, ms: Date.now() - t0, body });
          } catch {}
        };
        try { self.addEventListener("loadend", done); } catch {}
        return origSend.apply(this, arguments);
      };
    }
  } catch {}
  // — replay opt-in (v4) — janela rolling de eventos rrweb p/ o erro ter "como rodou".
  // Exige AMBOS: window.__ubReplay === true (opt-in da página/tag) E window.rrweb
  // (a página que quer replay carrega /assets/rrweb.umd.min.js da ponte — script tag).
  // Sem rrweb ou sem opt-in: ZERO custo (nada é gravado).
  let rec = null; // função stop do record ativo (ou null = não gravando)
  const buf = []; // eventos rolling (cap EVENTS_MAX, shift do mais velho)
  let lastClipAt = 0; // 1 clipe por janela de 45s (evita enxurrada de POSTs)
  function recStart() {
    try {
      if (rec || buf.length) return; // já gravando (ou buffer vivo — stop só zera rec, não o buf)
      if (!(window.rrweb && typeof window.rrweb.record === "function") || window.__ubReplay !== true) return;
      rec = window.rrweb.record(document, {
        emit(e) {
          try { buf.push(e); if (buf.length > EVENTS_MAX) buf.splice(0, buf.length - EVENTS_MAX); } catch {}
        },
        inlineStylesheet: false, recordCanvas: false, blockClass: "ub-block",
        sampling: { mousemove: 180, scroll: 250, input: "last" },
      });
    } catch { rec = null; }
  }
  function recStop() {
    try { if (rec) rec(); } catch {}
    rec = null; // buffer fica (o próximo clipe ainda sela o trecho capturado)
  }
  function clipSend(errEntry) {
    try {
      if (window.__ubReplay !== true) return; // opt-in fechado
      if (buf.length < EVENTS_MAX) return; // buffer cheio = sessão coberta de cá; antes disso o trecho é curto demais
      if (Date.now() - lastClipAt < 45000) return; // 1 clipe por 45s
      lastClipAt = Date.now();
      const tags = ubTags();
      window.dispatchEvent(new CustomEvent("__ubReplayClip", {
        detail: { t: Date.now(), url: String(location.href).slice(0, 300), ...(tags ? { tags } : {}), err: errEntry, rrweb: buf.slice(-EVENTS_MAX) },
      }));
    } catch {}
  }
  // start/stop no meio da vida da página (painel/agente comanda via evaluate+dispatchEvent)
  window.addEventListener("ub-replay-on", () => { try { recStart(); } catch {} });
  window.addEventListener("ub-replay-off", () => { try { recStop(); } catch {} });
  window.__ubMon = { v: 4, quiet: window.__ubMonQuiet === true, replay: window.__ubReplay === true,
    read(n) { try { return log.slice(-Math.min(Math.max(Number(n) || 30, 1), 120)); } catch { return []; } },
    count() { try { return log.length; } catch { return 0; } },
    clear() { try { log.length = 0; } catch {} },
    setQuiet(q) { try { window.__ubMonQuiet = q === true; window.__ubMon.quiet = q === true; } catch {} },
    setReplay(q) { try { window.__ubReplay = q === true; window.__ubMon.replay = q === true; window.dispatchEvent(new Event(q ? "ub-replay-on" : "ub-replay-off")); } catch {} },
  };
  if (window.__ubReplay === true) recStart(); // opt-in setado antes da injeção → já grava
})();
