// canivete core/symbols — extração de símbolos (zero deps, puro).
// Duas formas com propósitos diferentes (NÃO unificar o formato — mudaria resultados):
// - extractFileSymbols(text, rel): estilo fs.mjs p/ n_read (linha n + kind + name; JS/TS/Py/Md + reg("n_")).
// - indexSymbols(text, rel): estilo devengine.mjs p/ índice (name + file + line).
const SYM_KW = new Set(["if", "for", "while", "switch", "catch", "with", "else", "do", "try", "finally", "return", "import", "export", "function", "class", "const", "let", "var", "new", "typeof", "await", "async", "yield", "case", "break", "continue", "throw", "delete", "in", "of", "instanceof", "void"]);

export function extractFileSymbols(text, rel) {
  const syms = [];
  const rp = String(rel || "");
  const isPy = /\.py$/i.test(rp);
  const isMd = /\.md$/i.test(rp);
  const lines = String(text).split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    let m;
    if ((m = /^\s*reg\(\s*["']([A-Za-z0-9_\-]+)["']/.exec(l))) syms.push({ n: i + 1, kind: "tool", name: m[1] });
    else if (!isPy && (m = /^\s*(?:export\s+default\s+|export\s+)?class\s+([A-Za-z_$][\w$]*)/.exec(l))) syms.push({ n: i + 1, kind: "class", name: m[1] });
    else if (!isPy && (m = /^\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/.exec(l))) syms.push({ n: i + 1, kind: "function", name: m[1] });
    else if (!isPy && (m = /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>|function\b)/.exec(l))) syms.push({ n: i + 1, kind: /=>/.test(l) ? "arrow" : "function", name: m[1] });
    else if (isPy && (m = /^\s*(def|class)\s+([A-Za-z_]\w*)/.exec(l))) syms.push({ n: i + 1, kind: m[1] === "class" ? "class" : "function", name: m[2] });
    else if (!isPy && !isMd && (m = /^\s*(?:static\s+)?(?:async\s+)?(?:get\s+|set\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/.exec(l))) {
      if (!SYM_KW.has(m[1])) syms.push({ n: i + 1, kind: "method", name: m[1] });
    } else if (isMd && (m = /^\s*(#{1,6})\s+(.{1,120})\s*$/.exec(l))) syms.push({ n: i + 1, kind: "h" + m[1].length, name: m[2] });
  }
  return syms;
}

export function indexSymbols(text, rel) {
  const syms = [];
  const re = /(?:export\s+(?:async\s+)?(?:function|const|let|var|class)\s+(\w+))|(?:function\s+(\w+)\s*\()|(?:class\s+(\w+))/g;
  let m;
  while ((m = re.exec(text))) {
    const name = m[1] || m[2] || m[3];
    if (name) syms.push({ name, file: rel, line: text.slice(0, m.index).split("\n").length });
  }
  const compRe = /(?:export\s+default\s+function\s+(\w+))/g;
  while ((m = compRe.exec(text))) syms.push({ name: m[1], file: rel, line: text.slice(0, m.index).split("\n").length });
  return syms;
}
