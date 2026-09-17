#!/usr/bin/env node
// scripts/gen-catalog.mjs — gera docs/TOOLS.md a partir do código (parse estático).
//
// Por que NÃO importar TOOLS de src/server.mjs?
// - importar src/server.mjs registra tudo e mantém o processo vivo
//   (readline stdio + sweep + modo --http), além de risco de duplo registro.
// - test/smoke.mjs já evita importar o server pelo mesmo motivo.
// Por isso: parse estático via regex `reg("n_*", { description: ... })`
// em src/lib/*.mjs + src/server.mjs, gerando tabela nome|arquivo|1ª frase.
// SEM importar código do servidor (só node:fs/path/url).
//
// Uso: node scripts/gen-catalog.mjs  (gera docs/TOOLS.md)
// Validação: node --check scripts/gen-catalog.mjs
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LIB_DIR = join(ROOT, "src", "lib");
const SERVER_FILE = join(ROOT, "src", "server.mjs");
const OUT_FILE = join(ROOT, "docs", "TOOLS.md");

// reg("n_xxx", { description: "..." | '...' | `...` })
// - nome sempre aspas duplas hoje (suporta simples p/ futuro)
// - description é a 1ª chave do objeto; captura até a aspa de fechamento
//   respeitando escapes (\" \\ \n etc.), com flag s p/ suportar `...` multilinha.
const REG_RE =
  /reg\(\s*["'](n_[A-Za-z0-9_]+)["']\s*,\s*\{\s*description\s*:\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`)/gs;

function decodeDouble(inner) {
  try {
    return JSON.parse(`"${inner}"`);
  } catch {
    return decodeGeneric(inner);
  }
}

function decodeGeneric(inner) {
  // unescape mínimo p/ single/backtick + fallback do double
  return String(inner).replace(/\\(n|r|t|b|f|v|0|'|"|`|\\|u[0-9a-fA-F]{4})/g, (m, seq) => {
    if (seq === "n") return "\n";
    if (seq === "r") return "\r";
    if (seq === "t") return "\t";
    if (seq === "b") return "\b";
    if (seq === "f") return "\f";
    if (seq === "v") return "\v";
    if (seq === "0") return "\0";
    if (seq.startsWith("u")) {
      try {
        return String.fromCharCode(parseInt(seq.slice(1), 16));
      } catch {
        return m;
      }
    }
    return seq;
  });
}

function firstSentence(desc) {
  const collapsed = String(desc ?? "").replace(/\s+/g, " ").trim();
  if (!collapsed) return "";
  // 1ª frase = até o 1º [.!?] seguido de espaço/fim (evita cortar em
  // package.json, SKILL.md, ip-api.com ou "anônima?," — o naive /^[^.!?]+[.!?]/
  // usado no n_tools_info quebra nesses casos).
  const m = collapsed.match(/^(.*?[.!?])(?=\s|$)/);
  return (m?.[1] ?? collapsed).trim();
}

function escCell(s) {
  return String(s).replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

function collectFromFile(absPath) {
  const rel = relative(ROOT, absPath).replace(/\\/g, "/");
  const src = readFileSync(absPath, "utf8");
  const found = [];
  REG_RE.lastIndex = 0;
  let m;
  while ((m = REG_RE.exec(src)) !== null) {
    const name = m[1];
    // grupos: 2=double, 3=single, 4=backtick
    const raw = m[2] ?? m[3] ?? m[4] ?? "";
    const quote = m[2] !== undefined ? '"' : m[3] !== undefined ? "'" : "`";
    const desc = quote === '"' ? decodeDouble(raw) : decodeGeneric(raw);
    found.push({ name, file: rel, description: desc, first: firstSentence(desc) });
  }
  return found;
}

function main() {
  const libFiles = readdirSync(LIB_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".mjs"))
    .map((e) => join(LIB_DIR, e.name))
    .sort();
  const sources = [SERVER_FILE, ...libFiles];

  const byName = new Map(); // nome -> {name,file,first} (último vence, como TOOLS.set)
  for (const f of sources) {
    for (const t of collectFromFile(f)) {
      if (byName.has(t.name)) {
        console.warn(`warn: duplicado ${t.name} (antes ${byName.get(t.name).file}, agora ${t.file}) — mantendo último`);
      }
      byName.set(t.name, t);
    }
  }
  const tools = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  const date = new Date().toISOString().slice(0, 10);
  const lines = [
    "# TOOLS — catálogo gerado a partir do código",
    "",
    "> GERADO AUTOMATICAMENTE por `node scripts/gen-catalog.mjs` — NÃO EDITE MANUALMENTE.",
    `> Fonte: parse estático de \`reg("n_*", { description: ... })\` em \`src/lib/*.mjs\` + \`src/server.mjs\` (sem importar o servidor — importar \`src/server.mjs\` registra tudo e mantém o processo vivo via watch/readline).`,
    `> Total: ${tools.length} tools. Gerado em ${date}.`,
    "",
    "| nome | arquivo | descrição (1ª frase) |",
    "|---|---|---|",
    ...tools.map((t) => `| \`${t.name}\` | \`${escCell(t.file)}\` | ${escCell(t.first)} |`),
    "",
    "_Regenerar: `node scripts/gen-catalog.mjs` · Validar: `node --check scripts/gen-catalog.mjs`_",
    "",
  ];
  writeFileSync(OUT_FILE, lines.join("\n"), "utf8");
  console.log(`catalog: ${tools.length} tools -> docs/TOOLS.md`);
}

main();
