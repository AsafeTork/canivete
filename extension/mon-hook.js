// ubrowser — hook de observabilidade (mundo MAIN, idempotente).
// Captura console (5 níveis) + erros JS + fetch/XHR (status+corpo capado).
// Injetado via executeScript (world MAIN) no ensureContent — sem permissão nova.
// Limites: só vê o que acontece DEPOIS da 1ª injeção (load inicial escapa);
// headers/cookies NUNCA logados (sem segredo no buffer); corpos capados em 1500 chars.
(function () {
  if (window.__ubMon && window.__ubMon.v === 1) return;
  const log = [];
  const push = (e) => {
    try {
      log.push({ t: Date.now(), ...e });
      if (log.length > 120) log.splice(0, log.length - 120);
      // push proativo: erro pula na hora p/ content (→ background → bridge → MCP),
      // sem esperar poll. Só erro (js-error/promise/console.error/net-fail).
      const k = e.kind, lv = e.level;
      const isErr = k === "js-error" || k === "promise" || lv === "error" || (k === "net" && (e.status === 0 || e.status >= 400));
      if (isErr) {
        try { window.dispatchEvent(new CustomEvent("__ubMonAlert", { detail: { t: Date.now(), ...e } })); } catch {}
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
  for (const lvl of ["log", "info", "warn", "error", "debug"]) {
    try {
      const orig = console[lvl].bind(console);
      console[lvl] = function () {
        try {
          push({ kind: "console", level: lvl, text: Array.prototype.map.call(arguments, argStr).join(" ").slice(0, 2000) });
        } catch {}
        return orig.apply(null, arguments);
      };
    } catch {}
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
  window.__ubMon = { v: 1,
    read(n) { try { return log.slice(-Math.min(Math.max(Number(n) || 30, 1), 120)); } catch { return []; } },
    count() { try { return log.length; } catch { return 0; } },
    clear() { try { log.length = 0; } catch {} },
  };
})();
