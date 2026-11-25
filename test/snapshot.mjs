// Testes puros de src/core/snapshot.mjs — sem rede, sem extensão, <1s.
// Cobrem os bugs que custaram tokens/latência no bench: dedup de fragmentos, overview slim, fold.
import { snapDedupLinks, ubOverviewSlim, snapFold, snapFoldKey } from "../src/core/snapshot.mjs";
import { toolsHashOf } from "../src/core/tool-version.mjs";
import { isMonNoise } from "../src/core/mon-noise.mjs";

let fail = 0;
const t = (label, cond, extra = "") => {
  if (!cond) fail++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${cond || !extra ? "" : ` :: ${extra}`}`);
};

// 1) Fragmentos distintos são links distintos (bug: split("#") colapsava 40 → 1).
{
  const els = Array.from({ length: 5 }, (_, i) => ({ ref: i, role: "link", tag: "a", text: `Seção ${i}`, href: `#s${i}` }));
  const r = snapDedupLinks(els);
  t("dedup mantém fragmentos distintos", r.elements.length === 5 && r.dupes === 0, `len=${r.elements.length} dupes=${r.dupes}`);
}
// 2) Mesmo texto + mesmo href deduplica (ícone + rótulo apontando pro mesmo destino).
{
  const els = [
    { ref: 0, role: "link", tag: "a", text: "Home", href: "https://x.test/" },
    { ref: 1, role: "link", tag: "a", text: "Home", href: "https://x.test/" },
    { ref: 2, role: "link", tag: "a", text: "Sobre", href: "https://x.test/sobre" },
  ];
  const r = snapDedupLinks(els);
  t("dedup colapsa texto+href idênticos", r.elements.length === 2 && r.dupes === 1, `len=${r.elements.length} dupes=${r.dupes}`);
}
// 3) Mesmo href com textos diferentes fica (link "Home" e "Início" podem ser regiões diferentes).
{
  const els = [
    { ref: 0, role: "link", tag: "a", text: "Home", href: "https://x.test/" },
    { ref: 1, role: "link", tag: "a", text: "Início", href: "https://x.test/" },
  ];
  const r = snapDedupLinks(els);
  t("dedup preserva textos diferentes", r.elements.length === 2, `len=${r.elements.length}`);
}
// 4) Overview compact: sem type/state vazios, sem duplicar nome em text=NAME, headings limitados.
{
  const raw = {
    page: { title: "T", url: "https://x.test/", readyState: "complete" },
    headings: Array.from({ length: 40 }, (_, i) => ({ level: 2, text: `H${i}`, selector: "#h" + i, href: "#" + i })),
    landmarks: [{ role: "main", name: "Conteúdo" }],
    forms: [{ name: "Busca", fields: 1 }],
    controls: [
      { selector: "text=Entrar", name: "Entrar", tag: "button", role: "button", type: "submit", state: "", inViewport: true },
      { selector: "#q", name: "Buscar", tag: "input", role: "textbox", type: "search", state: "enabled", inViewport: false },
    ],
    controlsTotal: 2,
  };
  const d = ubOverviewSlim(raw);
  t("overview compact corta headings", d.headings.length === 15 && d.headingsOmitted === 25, `h=${d.headings.length} omit=${d.headingsOmitted}`);
  const d30 = ubOverviewSlim(raw, { headingsMax: 30 });
  t("overview headingsMax respeita override", d30.headings.length === 30 && d30.headingsOmitted === 10, `h=${d30.headings.length} omit=${d30.headingsOmitted}`);
  t("overview compact não repete text=NAME", d.controls[0].sel === "text=Entrar" && d.controls[0].name === undefined, JSON.stringify(d.controls[0]));
  t("overview compact omite state vazio", !("state" in d.controls[0]));
  t("overview compact omite type redundante de button", !("type" in d.controls[0]));
  t("overview compact mantém type/state úteis", d.controls[1].type === "search" && d.controls[1].state === "enabled" && d.controls[1].off === true);
  t("overview compact mantém headings em tuplas [nível,texto]", Array.isArray(d.headings[0]) && d.headings[0].length === 2 && d.headings[0][1] === "H0");
  t("overview compact achata landmarks em string", d.landmarks[0] === "main: Conteúdo");
  const full = ubOverviewSlim(raw, { detail: "full" });
  t("overview detail=full devolve payload cru", full === raw);
}
// 5) Fold só dobra runs >= 6 e preserva refs.
{
  const els = Array.from({ length: 8 }, (_, i) => ({ ref: i, role: "link", tag: "a", text: "Item", href: "#" + i }));
  const f = snapFold(els);
  t("fold dobra run de 8 em 1", f.elements.length === 1 && f.elements[0].folded === 8, JSON.stringify(f.elements[0]));
  t("fold preserva refs", Array.isArray(f.elements[0].foldRefs) && f.elements[0].foldRefs.length === 8);
  const small = snapFold(els.slice(0, 3));
  t("fold ignora run < 6", small.elements.length === 3);
  t("foldKey usa role+texto", snapFoldKey({ role: "button", text: "OK" }) === "button|ok");
}

// 5) hash do catálogo muda quando uma tool entra/sai e ignora ordem de registro.
{
  const a = new Map([["cv_b", { public: true }], ["cv_a", { public: true }], ["cv_hidden", { public: false }]]);
  const b = new Map([["cv_a", { public: true }], ["cv_b", { public: true }]]);
  const c = new Map([["cv_a", { public: true }], ["cv_b", { public: true }], ["cv_c", { public: true }]]);
  t("toolsHash estável e muda com o catálogo", toolsHashOf(a) === toolsHashOf(b) && toolsHashOf(c) !== toolsHashOf(a));
}

// 6) filtro de ruído do mon-hook: site barulhento fora, erro real dentro.
{
  t("Statsig/CSP/telemetria são ruído",
    isMonNoise({ kind: "console", level: "warn", text: "[Statsig] Caught error in _writeToCache" }) &&
    isMonNoise({ kind: "console", level: "error", text: "Creating a worker from 'blob:https://x.test/abc' violates the following Content Security Policy directive" }) &&
    isMonNoise({ kind: "net", status: 0, url: "/forms/x/naLogImpressions?id=1" }) &&
    isMonNoise({ kind: "js-error", text: "" }));
  t("erro real não é ruído",
    !isMonNoise({ kind: "js-error", text: "TypeError: Cannot read properties of null" }) &&
    !isMonNoise({ kind: "net", status: 500, url: "/api/checkout", text: "internal" }));
}

if (fail) {
  console.log(`\n${fail} falha(s)`);
  process.exit(1);
}
console.log("\nsnapshot puro OK");
