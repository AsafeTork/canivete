// canivete·uierr — shim de evidência visual de erros nas páginas ~homolog.
// Uso (no app/aba de teste, ANTES do código da página):
//   <script src="http://127.0.0.1:19422/uierr.js"></script>
//   window.__ubTags = { area: "autenticacao", agent: "agente-x" }; // nomeia a sessão
//   window.__UB_UIERR_LABEL = "Homolog · autenticação";            // chip do badge
//   window.__ubReplay = true; // (opt-in p/ o clipe rrweb sair junto no erro)
// NÃO faz NENHUM POST: observabilidade na ponte é papel do mon-hook da extensão
// (ele já vê error/rede e empurra /ubpush e /replay). Este shim é só a evidência
// VISUAL na página — badge de leitura, sem chave, sem rede, sem segredo.
(function () {
  "use strict";
  if (window.__ubUIerr) return; // idempotente
  if (window.__UB_UIERR_OFF === true) return; // kill switch da página
  const MAX = 6, BODY_CAP = 800, URL_CAP = 60;
  const lista = []; // mais novo primeiro; cap MAX
  // Token Ledger: card+hairline+raio único 6px; mono SÓ no status; sem sombra.
  const css = document.createElement("style");
  css.textContent = [
    "#ub-uierr{position:fixed;right:13px;bottom:13px;z-index:2147483647;background:#14161a;",
    "color:#e8eaed;border:1px solid #23262c;border-radius:6px;padding:8px 13px;",
    "font:450 13px/20px system-ui,'Segoe UI',sans-serif;max-width:340px}",
    "#ub-uierr .lb{color:#9aa1ab;font-size:11px}",
    "#ub-uierr ul{list-style:none;margin:6px 0 0;padding:0;display:grid;gap:6px}",
    "#ub-uierr li{border-top:1px solid #23262c;padding-top:6px}",
    "#ub-uierr .st{font:500 11px/16px ui-monospace,SFMono-Regular,Menlo,monospace}",
    "#ub-uierr .st.e{color:#ff8a7a}.st.w{color:#e7c266}",
    "#ub-uierr pre{margin:4px 0 0;background:#0d0e11;border:1px solid #23262c;border-radius:6px;",
    "padding:6px;overflow-x:auto;font:400 11px/16px ui-monospace,Menlo,monospace;color:#9aa1ab}",
    "#ub-uierr summary{cursor:pointer;color:#e8eaed}",
  ].join("");
  document.documentElement.appendChild(css);
  const root = document.createElement("div");
  root.id = "ub-uierr";
  const label = String(window.__UB_UIERR_LABEL || "uierr").slice(0, 40);
  root.innerHTML =
    '<span class="lb">' + label.replace(/[<>&]/g, " ") + "</span> " +
    '<span class="st" data-st>sem erro ainda</span>' +
    '<details data-lista><summary>Ver últimos</summary><ul></ul></details>';
  // badge pode montar no <head> — se body ainda não existe, adia p/ DOMContentLoaded
  const montar = () => { try { document.body.appendChild(root); } catch {} };
  if (document.body) montar(); else document.addEventListener("DOMContentLoaded", montar);
  const st = root.querySelector("[data-st]");
  const volta = root.querySelector("[data-lista]");
  const ul = root.querySelector("ul");
  volta.hidden = true;
  function grade(e) { // 5xx/desconexão = erro; 4xx = aviso
    return (e.status === 0 || e.status >= 500) ? "e" : "w";
  }
  // rótulo do colchete: http usa o número; rede=0 vira "rede"; js/promise nomeiam a si
  function rotula(e) {
    if (e.metodo === "js-error") return "js";
    if (e.metodo === "promise") return "promise";
    if (e.status === 0) return "rede";
    return e.status;
  }
  function pinta() {
    const u = lista[0];
    if (!u) { st.textContent = "sem erro ainda"; volta.hidden = true; return; }
    st.innerHTML = ""; // reconstrói: status mono + resumo
    const b = document.createElement("b");
    b.className = "st " + grade(u);
    b.textContent = "[" + rotula(u) + "]";
    st.appendChild(b);
    st.appendChild(document.createTextNode(" " + u.resumo));
    volta.hidden = lista.length <= 1;
    ul.innerHTML = "";
    lista.slice(0, MAX).forEach(function (e) {
      const li = document.createElement("li");
      const c = document.createElement("b");
      c.className = "st " + grade(e);
      c.textContent = "[" + rotula(e) + "] " + e.metodo + " " + e.url;
      const p = e.corpo;
      li.appendChild(c);
      li.appendChild(document.createTextNode(" " + e.resumo));
      if (p) {
        const pre = document.createElement("pre");
        pre.textContent = p;
        li.appendChild(pre);
      }
      ul.appendChild(li);
    });
  }
  function reg(status, metodo, url, resumo, corpo) {
    // mais novo primeiro, cap MAX; resumo/corpo capados; sem segredo (só o que a página já vê)
    lista.unshift({ status: status | 0, metodo: String(metodo || "?"), url: String(url || "").slice(0, URL_CAP), resumo: String(resumo || "").slice(0, 160), corpo: corpo ? String(corpo).slice(0, BODY_CAP) : "" });
    if (lista.length > MAX) lista.length = MAX;
    pinta();
  }
  // — fetch: status ≥400 OU rejeição é registrada; o fluxo original NUNCA muda —
  try {
    const of = window.fetch.bind(window);
    window.fetch = function () {
      const args = arguments;
      let url = "";
      try { const f = args[0]; url = String((f && (f.url || f)) || "").slice(0, URL_CAP); } catch {}
      let metodo = "GET";
      try { metodo = String((args[1] && args[1].method) || "GET").toUpperCase(); } catch {}
      return of.apply(null, args).then(function (res) {
        try {
          if (res.status >= 400) {
            res.clone().text().then(function (t) { reg(res.status, metodo, url, "", t); }).catch(function () { reg(res.status, metodo, url, "", ""); });
          }
        } catch {}
        return res;
      }, function (e) {
        try { reg(0, metodo, url, "rede falhou: " + String(e && e.message || e).slice(0, 120), ""); } catch {}
        throw e; // o erro corre ORIGINAL — sempre propagado (o shim só observa)
      });
    };
  } catch {}
  // — XHR: status ≥400 no loadend; nada interceptado no caminho —
  try {
    const XO = window.XMLHttpRequest;
    if (XO && XO.prototype) {
      const os = XO.prototype.send;
      XO.prototype.send = function () {
        const self = this;
        try {
          this.addEventListener("loadend", function () {
            try {
              if (self.status >= 400) {
                let corpo = "";
                try { corpo = String(self.responseText || ""); } catch {}
                reg(self.status, String(self.__uiM || "?").toUpperCase(), String(self.__uiU || ""), "", corpo);
              }
            } catch {}
          });
        } catch {}
        return os.apply(this, arguments);
      };
      const oo = XO.prototype.open;
      XO.prototype.open = function (m, u) {
        try { this.__uiM = m; this.__uiU = String(u || "").slice(0, URL_CAP); } catch {}
        return oo.apply(this, arguments);
      };
    }
  } catch {}
  // — erros JS: window.error + unhandledrejection (status 0 = cor erro) —
  try {
    window.addEventListener("error", function (e) {
      try { reg(0, "js-error", (e && e.filename) || "", String((e && e.message) || "erro na página").slice(0, 160), ""); } catch {}
    }, true);
    window.addEventListener("unhandledrejection", function (e) {
      try {
        const r = (e && e.reason) || {};
        reg(0, "promise", "", String(r.message || r || "promise rejeitada").slice(0, 160), "");
      } catch {}
    }, true);
  } catch {}  window.__ubUIerr = { v: 1, read: function () { return lista.slice(); } };
})();
