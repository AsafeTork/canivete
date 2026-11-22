// canivete core/snapshot — primitivos compartilhados de ranking (puros, zero deps).
// As funções de score final ficam nos donos (headless vs ubrowser têm entradas
// diferentes: geometria CDP vs box x/y/w/h), mas label/role/box/viewport/bytes
// passam a ter UMA implementação — fim da divergência silenciosa.
export function snapLabel(el) {
  return String(el?.name ?? "").trim() || String(el?.text ?? "").trim();
}
export function snapRole(el) {
  return String(el?.role ?? "").trim().toLowerCase();
}
export function snapHasBox(el) {
  return (Number(el?.w) || 0) > 0 && (Number(el?.h) || 0) > 0;
}
export function snapInViewport(el, max = 4000) {
  if (!snapHasBox(el)) return false;
  const x = Number(el.x) || 0, y = Number(el.y) || 0, w = Number(el.w) || 0, h = Number(el.h) || 0;
  return x > -w && y > -h && x < max && y < max;
}
export function snapIsEditable(el) {
  if (!el) return false;
  if (el.tag === "input" || el.tag === "textarea") return true;
  if (el.contentEditable === "true" || el.contentEditable === true) return true;
  try {
    return Array.isArray(el.attributes) && el.attributes.some((x) => x && x.name === "contenteditable");
  } catch {
    return false;
  }
}
export function snapIsDisabled(el) {
  return String(el?.state || "").includes("disabled");
}
export function snapBytes(els) {
  try {
    return JSON.stringify(els).length;
  } catch {
    return 0;
  }
}
export function snapFoldKey(el) {
  return `${String(el?.role || "")}|${String(el?.text || el?.name || "").slice(0, 24).toLowerCase()}`;
}
// Dobra runs consecutivos idênticos (mcprune-style). Puro; refs preservadas.
export function snapFold(els, minRun = 6) {
  const out = [];
  let i = 0, folded = 0;
  while (i < els.length) {
    const k = snapFoldKey(els[i]);
    let j = i + 1;
    while (j < els.length && snapFoldKey(els[j]) === k) j++;
    const run = j - i;
    if (run >= minRun && k.split("|")[0]) {
      folded++;
      const refs = els.slice(i, j).map((e) => e.ref).filter((r) => r !== undefined);
      const first = els[i];
      out.push({ ...first, text: `${first.text || first.name || ""} … +${run - 1} similares`, folded: run, foldRefs: refs });
    } else {
      for (let m = i; m < j; m++) out.push(els[m]);
    }
    i = j;
  }
  return { elements: out, folded };
}
// Dedup de links pelo par (texto, href COMPLETO). Puro.
// Fragmentos (#s1, #s2) são alvos DIFERENTES: cortar o "#" transformava 40 links de
// navegação em 1 e o snapshot max=30 devolvia 2 elementos (bench).
export function snapDedupLinks(els) {
  const seen = new Set();
  const out = [];
  let dupes = 0;
  for (const el of els) {
    const h = el && el.role === "link" ? String(el.href || "") : "";
    if (h) {
      const k = `${String(el.text || el.name || "")}\u0000${h}`;
      if (seen.has(k)) {
        dupes++;
        continue;
      }
      seen.add(k);
    }
    out.push(el);
  }
  return { elements: out, dupes };
}
// Overview compacto (default): o payload da extensão trazia selector+name repetidos,
// headings com selector e href em cada link — 12,3KB p/ 35 controles (~3k tokens).
// Mantém o que decide a ação (sel/name/role/type/state) e corta o resto; detail:"full" = legado.
export function ubOverviewSlim(d, { detail = "compact", headingsMax = 15 } = {}) {
  try {
    if (detail === "full") return d;
    const src = d && typeof d === "object" ? d : {};
    const page = src.page && typeof src.page === "object" ? src.page : {};
    const slimPage = { title: page.title || "", url: page.url || "", ...(page.readyState && page.readyState !== "complete" ? { readyState: page.readyState } : {}) };
    const heads = Array.isArray(src.headings) ? src.headings : [];
    const capH = Math.max(0, Math.floor(Number(headingsMax) || 0)) || 15;
    // tuplas [nível, texto]: 30 títulos caem de ~990B p/ ~600B (chaves repetidas somem).
    const headings = heads.slice(0, capH).map((h) => [Number(h?.level) || 0, String(h?.text || "").slice(0, 100)]);
    const controls = (Array.isArray(src.controls) ? src.controls : []).map((c) => {
      const name = String(c?.name || c?.text || "").slice(0, 100);
      const sel = String(c?.selector || "");
      const out = { ...(sel ? { sel } : {}) };
      if (name && sel !== `text=${name}`) out.name = name; // text=NAME já carrega o nome
      if (c?.role) out.role = String(c.role);
      else if (c?.tag) out.tag = String(c.tag);
      // type só quando distingue o controle (email/search/checkbox); button/select/textarea
      // já dizem o tipo pelo role/tag — repetir "submit" em 30 botões era ~600B de ruído.
      const tag = String(c?.tag || "").toLowerCase();
      if (c?.type && c.type !== "text" && !["button", "select", "textarea"].includes(tag)) out.type = String(c.type);
      if (c?.state) out.state = String(c.state).slice(0, 60);
      if (c?.inViewport === false) out.off = true;
      return out;
    });
    // "role: nome" em string: mesma informação, sem 2 chaves por landmark.
    const landmarks = (Array.isArray(src.landmarks) ? src.landmarks : []).map((l) => {
      const role = String(l?.role || "");
      const name = String(l?.name || "").slice(0, 80);
      return name ? `${role}: ${name}` : role;
    }).filter(Boolean);
    const forms = (Array.isArray(src.forms) ? src.forms : []).map((f) => ({ name: String(f?.name || "").slice(0, 80), fields: Number(f?.fields) || 0 }));
    return {
      page: slimPage,
      headings,
      ...(heads.length > headings.length ? { headingsOmitted: heads.length - headings.length } : {}),
      landmarks,
      forms,
      controls,
      controlsTotal: Number(src.controlsTotal) || controls.length,
      // offset 0 é o caso comum; controlsOmitted é derivável de total-offset-length.
      ...(Number(src.controlsOffset) ? { controlsOffset: Number(src.controlsOffset) } : {}),
      ...(src.nextOffset != null ? { nextOffset: src.nextOffset } : {}),
      // overlay fechado é ruído fixo (~45B/call): só vai quando há camada bloqueando.
      ...(src.overlays && src.overlays.open ? { overlays: src.overlays } : {}),
    };
  } catch { return d; }
}
