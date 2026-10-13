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
// Dedup de links pelo href (sem fragmento). Puro.
export function snapDedupLinks(els) {
  const seenHref = new Set();
  const out = [];
  let dupes = 0;
  for (const el of els) {
    const h = el && el.role === "link" ? String(el.href || "") : "";
    if (h) {
      const k = h.split("#")[0];
      if (seenHref.has(k)) {
        dupes++;
        continue;
      }
      seenHref.add(k);
    }
    out.push(el);
  }
  return { elements: out, dupes };
}
