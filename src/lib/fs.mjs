// canivete — filesystem + execução (read/list/write/edit/patch/bash/glob/grep)
// Índice (tools neste arquivo):
// - n_read: lê arquivo texto numerado ou lista diretório simples.
// - n_list: lista árvore de diretório com tamanhos.
// - n_write: cria/sobrescreve (ou anexa) arquivo.
// - n_edit: troca texto exato oldString→newString.
// - n_apply_patch: aplica unified diff via git apply no repo root.
// - n_bash: executa shell (bash -lc) no repo root.
// - n_glob: acha arquivos por glob.
// - n_grep: busca regex no conteúdo com rank.
import { mkdir, writeFile, unlink, stat, rename } from "node:fs/promises";
import { readFileSync, readdirSync, statSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { userInfo } from "node:os";
import { reg, out, trimOut, fpath, exec, walkFiles, humanSize, escapeRe, CWD, SKIP_DIRS } from "./ctx.mjs";

function globToRegex(pattern) {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        re += ".*";
        i++;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (c === "{") {
      const end = pattern.indexOf("}", i);
      if (end > i) {
        re += "(" + pattern.slice(i + 1, end).split(",").map(escapeRe).join("|") + ")";
        i = end;
      } else {
        re += escapeRe(c);
      }
    } else {
      re += escapeRe(c);
    }
  }
  return new RegExp("^" + re + "$");
}

function fail(tool, msg, hint) {
  return hint ? `ERRO ${tool}: ${msg} | dica: ${hint}` : `ERRO ${tool}: ${msg}`;
}

// Identidade de execução (auditoria: split de usuário indocumentado). Cache no load.
let RUN_AS = "?";
try { RUN_AS = userInfo().username || "?"; } catch {}

// --- custo: symbols/rank/collapse. Custo zero quando opt-in ausente (fast-path) ---
const SYM_KW = new Set(["if", "for", "while", "switch", "catch", "with", "else", "do", "try", "finally", "return", "import", "export", "function", "class", "const", "let", "var", "new", "typeof", "await", "async", "yield", "case", "break", "continue", "throw", "delete", "in", "of", "instanceof", "void"]);
function extractSymbols(text, rel) {
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

const BASH_TAIL_KEEP = 15; // tail integral: últimas N linhas de conteúdo nunca entram no RLE
const PROG_RE = /(\d+\s*%|\bdownloading\b|\bdownloaded\b|\bprogress\b|█|▓|▒|░|■|□|◆|◇|\b\d+\s*\/\s*\d+\b)/i;
const ERR_RE = /\berror\b|\bfailed?\b|\bfail\b|exception|traceback|\bpanic\b|\bfatal\b|\bdenied\b|\brefused\b/i; // erro = sinal: nunca colapsa
function progTemplate(s) {
  return s.replace(/\d[\d.,]*/g, "#").replace(/[█▓▒░■□◆◇#=~_*\-─—|\\/]{3,}/g, "<BAR>").slice(0, 160);
}
function collapseBash(so) {
  const src = String(so);
  if (!src) return { text: src, saved: 0 };
  let t = src.replace(/\r+\n/g, "\n"); // \r\n vira \n
  if (t.indexOf("\r") >= 0) t = t.split("\n").map((l) => (l.indexOf("\r") >= 0 ? l.slice(l.lastIndexOf("\r") + 1) : l)).join("\n"); // overwrite \r: terminal mostra só o último segmento
  const raw = t.split("\n");
  const hasTrailNl = t.endsWith("\n");
  const body = hasTrailNl ? raw.slice(0, -1) : raw;
  if (body.length <= 1) return { text: src, saved: 0 };
  // 1) progresso em qualquer posição (head+tail): first + marker + last VERBATIM (last = estado final)
  const prog = [];
  let i = 0;
  while (i < body.length) {
    const cur = body[i];
    if (cur.trim() !== "" && !ERR_RE.test(cur) && PROG_RE.test(cur)) {
      const tpl = progTemplate(cur);
      let k = i + 1;
      while (k < body.length && body[k].trim() !== "" && !ERR_RE.test(body[k]) && PROG_RE.test(body[k]) && progTemplate(body[k]) === tpl) k++;
      if (k - i > 2) {
        const marker = `...[progress x${k - i}]`;
        const groupLen = body.slice(i, k).join("\n").length;
        if (cur.length + marker.length + body[k - 1].length + 2 < groupLen) { prog.push(cur, marker, body[k - 1]); i = k; continue; }
      }
    }
    prog.push(cur);
    i++;
  }
  // 2) RLE de idênticas no head; tail integral verbatim (erros nunca colapsam)
  const tail = prog.slice(-BASH_TAIL_KEEP);
  const head = prog.slice(0, Math.max(0, prog.length - tail.length));
  if (!head.length) {
    const joined = prog.join("\n") + (hasTrailNl ? "\n" : "");
    const saved = src.length - joined.length;
    return saved > 0 ? { text: joined, saved } : { text: src, saved: 0 };
  }
  const outH = [];
  i = 0;
  while (i < head.length) {
    const cur = head[i];
    if (cur.trim() === "" || ERR_RE.test(cur)) { outH.push(cur); i++; continue; } // blank/erro: verbatim
    let j = i + 1;
    while (j < head.length && head[j] === cur) j++;
    const run = j - i;
    if (run >= 2) {
      const cand = `${cur} [x${run}]`;
      // nunca expandir: micro-linha x2 sai verbatim
      if (cand.length < cur.length * run + (run - 1)) outH.push(cand);
      else for (let k = i; k < j; k++) outH.push(head[k]);
      i = j;
      continue;
    }
    outH.push(cur);
    i++;
  }
  const collapsed = [...outH, ...tail].join("\n") + (hasTrailNl ? "\n" : "");
  const saved = src.length - collapsed.length;
  return saved > 0 ? { text: collapsed, saved } : { text: src, saved: 0 };
}

function listDir(p, depth, maxLines = 1500, sort = "name") {
  const lines = [];
  let hitCap = false;
  const rec = (dir, lv) => {
    if (lines.length >= maxLines) {
      hitCap = true;
      return;
    } // para cedo: antes montava a árvore inteira e truncava no fim (pico de RAM em pastas gigantes)
    let ents;
    try {
      ents = readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      lines.push(`${"  ".repeat(lv)}! ${e.message} | dica: confira permissões; use n_glob p/ caminho alternativo`);
      return;
    }
    const meta = new Map();
    const stOf = (e) => {
      if (meta.has(e.name)) return meta.get(e.name);
      let m = { size: 0, mtimeMs: 0 };
      try {
        const s = statSync(join(dir, e.name));
        m = { size: s.size, mtimeMs: s.mtimeMs };
      } catch {
        /* mantém default */
      }
      meta.set(e.name, m);
      return m;
    };
    if (sort === "size") ents.sort((a, b) => stOf(b).size - stOf(a).size || a.name.localeCompare(b.name));
    else if (sort === "mtime") ents.sort((a, b) => stOf(b).mtimeMs - stOf(a).mtimeMs || a.name.localeCompare(b.name));
    else
      ents.sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    for (const e of ents) {
      if (lines.length >= maxLines) {
        hitCap = true;
        return;
      }
      if (lv === 0 && SKIP_DIRS.has(e.name)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        lines.push(`${"  ".repeat(lv)}${e.name}/`);
        if (lv < depth) rec(full, lv + 1);
      } else {
        let sz = "";
        try {
          sz = " " + humanSize(statSync(full).size);
        } catch {
          /* stat may fail for race-deleted entries */
        }
        lines.push(`${"  ".repeat(lv)}${e.name}${sz}`);
      }
    }
  };
  rec(p, 0);
  const head = `${p} (${lines.length}${hitCap ? "+" : ""} entries, depth=${depth}, sort=${sort})`;
  if (hitCap) {
    lines.push(`...[truncated at ${maxLines} lines — next: n_list({path:${JSON.stringify(p)}, depth:${depth}, maxLines:${maxLines * 2}}) ou filtre com n_glob/n_grep]`);
  }
  return out(`${head}\n${lines.join("\n") || "(empty)"}`);
}

// ---- n_read ----
reg("n_read", {
  description: "Lê arquivo texto com números de linha (offset/limit, raw, maxChars até 100k) ou lista diretório simples. Roda como o usuário do servidor (EACCES = confira `as:` do n_bash). Quando usar: inspecionar código/config antes de editar. Retorna corpo numerado (raw tira números); binário/ausente retorna isError; grande trunca com marker explícito (nunca silent). symbols:true = outline (funções/classes/tools+linha, navegação sem ler tudo).",
  inputSchema: {
    type: "object",
    properties: {
      filePath: { type: "string", description: "Absolute or project-relative path" },
      offset: { type: "number", description: "First line (1-based)" },
      limit: { type: "number", description: "Max lines (default 4000)" },
      raw: { type: "boolean", description: "Content without line numbers" },
      maxChars: { type: "number", description: "Max chars to return (default 100000, máx 100000)" },
      tail: { type: "number", description: "Últimas N linhas (p/ logs)" },
      grep: { type: "string", description: "Filtro regex inline (só linhas matching, numeradas)" },
      symbols: { type: "boolean", description: "Outline: funções/classes/tools + nº linha (opt-in; default false, leitura normal intacta)" },
      mode: { type: "string", description: "Alias: mode='symbols' equivale a symbols:true" },
    },
    required: ["filePath"],
  },
  run: async ({ filePath, offset, limit, raw, maxChars, tail, grep, symbols, mode }) => {
    const p = fpath(filePath);
    let st;
    try {
      st = await stat(p);
    } catch (e) {
      return out(fail("n_read", `not found: ${e.message}`, "confira o filePath; use n_glob/n_list p/ achar o caminho"), true);
    }
    if (st.isDirectory()) return listDir(p, 1);
    const buf = readFileSync(p);
    const nul = buf.indexOf(0);
    if (nul >= 0) return out(fail("n_read", `binary file ${p} (${humanSize(buf.length)}, ${buf.length} bytes, NUL at offset ${nul}) — conteúdo omitido`, "use n_list p/ confirmar tipo/tamanho; p/ texto use n_grep com include; bytes só via n_bash (ex: file/head) se preciso"), true);
    const cutLong = (s) => (s.length > 2000 ? s.slice(0, 2000) + `…[+${s.length - 2000} chars]` : s);
    const fp = JSON.stringify(filePath);
    const cap = Math.max(1000, Number(maxChars) || 100000);
    const text = buf.toString("utf8");
    const lines = text.split("\n");
    const total = lines.length;
    const wantSymbols = symbols === true || mode === "symbols"; // opt-in: default (falsy) cai no fluxo normal intacto
    if (wantSymbols) {
      let syms = extractSymbols(text, filePath);
      const g = typeof grep === "string" && grep.length ? grep : null;
      if (g) {
        let grx;
        try {
          grx = new RegExp(g);
        } catch (e) {
          return out(fail("n_read", `invalid grep regex: ${e.message}`, "valide a regex; escape caracteres especiais"), true);
        }
        syms = syms.filter((s) => grx.test(`${s.kind} ${s.name}`));
      }
      if (tail != null && Number(tail) > 0) syms = syms.slice(-Math.max(1, Number(tail)));
      if (!syms.length) return out(`no symbols${g ? ` for /${g}/` : ""} in ${p} (${total} lines)`);
      const sStart = Math.max(1, Number(offset) || 1);
      const sLim = Number(limit) || syms.length;
      if (sStart > syms.length) return out(fail("n_read", `offset ${sStart} beyond symbols ${syms.length} (total ${total} lines)`, `use offset 1-${syms.length} com limit`), true);
      const sEnd = Math.min(syms.length, sStart + sLim - 1);
      const sHead = `${p} (symbols: ${syms.length} in ${total} lines, showing ${sStart}-${sEnd})`;
      let sUsed = sHead.length + 1;
      const sBody = [];
      for (let si = sStart - 1; si < sEnd; si++) {
        const s = `${syms[si].n}: [${syms[si].kind}] ${syms[si].name}`;
        if (sUsed + s.length + 1 > cap && sBody.length) break;
        sBody.push(s);
        sUsed += s.length + 1;
      }
      if (sStart + sBody.length - 1 < syms.length) sBody.push(`...[truncated — next: n_read({filePath:${fp}, symbols:true, offset:${sStart + sBody.length}, limit:${sLim}})]`);
      return out(`${sHead}\n${sBody.join("\n")}`);
    }
    const fmt = (n, l) => (raw ? cutLong(l) : `${n}: ${cutLong(l)}`);
    const hasTail = tail != null && Number(tail) > 0;
    const hasGrep = typeof grep === "string" && grep.length > 0;
    if (hasTail || hasGrep) {
      let kept = lines.map((l, i) => ({ n: i + 1, l }));
      if (hasTail) kept = kept.slice(-Math.max(1, Number(tail)));
      if (hasGrep) {
        let grx;
        try {
          grx = new RegExp(grep);
        } catch (e) {
          return out(fail("n_read", `invalid grep regex: ${e.message}`, "valide a regex; escape caracteres especiais"), true);
        }
        kept = kept.filter((e) => grx.test(e.l));
      }
      if (!kept.length) return out(`no matches for /${grep || ""}/ in ${p} (${total} lines)`);
      const start = Math.max(1, Number(offset) || 1);
      const lim = Number(limit) || kept.length;
      if (start > kept.length) return out(fail("n_read", `offset ${start} beyond filtered ${kept.length} lines (total ${total})`, `use offset 1-${kept.length} com limit; sem filtro o arquivo tem ${total} lines`), true);
      const endIdx = Math.min(kept.length, start + lim - 1);
      const mode = `${hasTail ? `tail=${Number(tail)} ` : ""}${hasGrep ? `grep=/${grep}/ ` : ""}`;
      const head = `${p} (${mode}${kept.length}/${total} lines, showing filtered ${start}-${endIdx})`;
      let used = head.length + 1;
      const body = [];
      let shown = 0;
      for (let i = start - 1; i < endIdx; i++) {
        const s = fmt(kept[i].n, kept[i].l);
        if (used + s.length + 1 > cap && body.length) break;
        if (!body.length && used + s.length + 1 > cap) {
          body.push(s.slice(0, Math.max(0, cap - used)) + `\n...[truncated — next: n_read({filePath:${fp}, offset:${start + 1}, limit:${lim}})]`);
          shown = 1;
          return out(`${head}\n${body.join("\n")}`);
        }
        body.push(s);
        used += s.length + 1;
        shown++;
      }
      const nextOff = start + shown;
      if (nextOff <= kept.length) body.push(`...[truncated — next: n_read({filePath:${fp}, offset:${nextOff}, limit:${lim}})]`);
      return out(`${head}\n${body.join("\n")}`);
    }
    const start = Math.max(1, Number(offset) || 1);
    if (start > total) return out(fail("n_read", `offset ${start} beyond EOF (${total} lines in ${p})`, `use offset 1-${total} com limit; ex: {offset:${Math.max(1, total - 50)}, limit:50} p/ o fim ou tail:100 p/ logs`), true);
    const lim = Number(limit) || 4000;
    const end = Math.min(total, start + lim - 1);
    const head = offset == null && limit == null ? `${p} (${total} lines)` : `${p} lines ${start}-${end} of ${total}`;
    let used = head.length + 1;
    const body = [];
    let shown = 0;
    for (let i = start; i <= end; i++) {
      const s = fmt(i, lines[i - 1]);
      if (used + s.length + 1 > cap && body.length) break;
      if (!body.length && used + s.length + 1 > cap) {
        body.push(s.slice(0, Math.max(0, cap - used)) + `\n...[truncated — next: n_read({filePath:${fp}, offset:${start + 1}, limit:${lim}})]`);
        shown = 1;
        return out(`${head}\n${body.join("\n")}`);
      }
      body.push(s);
      used += s.length + 1;
      shown++;
    }
    const lastShown = start + shown - 1;
    if (lastShown < total) body.push(`...[truncated — next: n_read({filePath:${fp}, offset:${lastShown + 1}, limit:${lim}})]`);
    return out(`${head}\n${body.join("\n")}`);
  },
});

// ---- n_list ----
reg("n_list", {
  description: "Lista árvore de diretório com tamanhos (depth 1-6, maxLines 1500). Quando usar: mapear módulo/pasta antes de glob/read; ver features, functions, arquivos grandes. Retorna 'nome/ + arquivo + tamanho'. Ex: {path:\"src/features\", depth:1}. Para topologia sem varrer, prefira n_get_architecture_summary (~85% tokens).",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Directory (default: repo root)" },
      depth: { type: "number", description: "Recursion depth (default 2, max 6)" },
      maxLines: { type: "number", description: "Max output lines (default 1500)" },
      sort: { type: "string", description: "Ordem: name|size|mtime (default name)" },
    },
    required: [],
  },
  run: async ({ path, depth, maxLines, sort }) => listDir(fpath(path || CWD), Math.min(Number(depth) || 2, 6), Math.max(1, Number(maxLines) || 1500), ["name", "size", "mtime"].includes(sort) ? sort : "name"),
});

// ---- n_write ----
reg("n_write", {
  description: "Cria/sobrescreve arquivo (cria pastas) como o usuário do servidor (veja `as:` no output; confira com `as:` do n_bash antes de misturar com shell). Quando usar: arquivo novo ou rewrite total; para troca pontual prefira n_edit/n_apply_semantic_patch (AST). Retorna bytes escritos. Ex: {filePath:\"/tmp/x.txt\", content:\"...\"}.",
  inputSchema: {
    type: "object",
    properties: {
      filePath: { type: "string", description: "Caminho do arquivo" },
      content: { type: "string", description: "Conteúdo a gravar/anexar" },
      mkdirs: { type: "boolean", description: "Cria pastas (default true; false desliga)" },
      append: { type: "boolean", description: "Anexa ao fim em vez de sobrescrever" },
      backup: { type: "boolean", description: "Salva .bak antes de gravar" },
      dryRun: { type: "boolean", description: "Não grava; retorna bytes/preview" },
      owner: { type: "string", description: "Dono pós-escrita via chown (ex: \"tork\" ou \"tork:tork\"). Útil quando outro usuário precisa mexer via shell. Falha de chown vira aviso, não erro." },
    },
    required: ["filePath", "content"],
  },
  run: async ({ filePath, content, mkdirs, append, backup, dryRun, owner }) => {
    const p = fpath(filePath);
    const bytes = Buffer.byteLength(content);
    if (dryRun) return out(`dryRun ${append ? "append" : "write"} ${p} (${bytes} bytes) preview: ${content.slice(0, 500)}${content.length > 500 ? `...[+${content.length - 500} chars]` : ""}`);
    try {
      if (mkdirs !== false) await mkdir(dirname(p), { recursive: true });
      if (backup && existsSync(p)) await writeFile(`${p}.bak`, readFileSync(p));
      if (append) await writeFile(p, content, { encoding: "utf8", flag: "a" });
      else await writeFile(p, content, "utf8");
      let ownNote = "";
      if (owner) {
        const cr = await exec("chown", [String(owner), p], { timeout: 15000 });
        ownNote = cr.code === 0 ? ` owner=${owner}` : ` (owner ${owner} falhou: ${(cr.se || cr.error || `exit ${cr.code}`).trim().slice(0, 120)})`;
      }
      return out(`${append ? "appended" : "wrote"} ${p} (${bytes} bytes, as ${RUN_AS})${backup ? " backup=.bak" : ""}${ownNote}`);
    } catch (e) {
      return out(fail("n_write", `write failed: ${e.message}`, "confira permissões e o filePath; use n_list p/ validar a pasta"), true);
    }
  },
});

// ---- n_edit ----
reg("n_edit", {
  description: "Troca texto exato (oldString→newString, replaceAll default true, dryRun conta matches). Roda como o usuário do servidor (EACCES = confira `as:` do n_bash; n_write tem `owner` p/ ajustar dono). Quando usar: edição pontual com contexto; para validar sintaxe use n_apply_semantic_patch. Limite: default substitui TODAS as ocorrências; ambíguo só falha com replaceAll=false; 0 matches sempre falha.",
  inputSchema: {
    type: "object",
    properties: {
      filePath: { type: "string" },
      oldString: { type: "string", description: "Texto exato ou regex (se regex:true)" },
      newString: { type: "string", description: "Substituto (aceita $1 se regex:true)" },
      replaceAll: { type: "boolean", description: "Troca todas (default true)" },
      dryRun: { type: "boolean", description: "Só conta matches, não grava" },
      regex: { type: "boolean", description: "oldString como regex (usa $1 no newString)" },
      backup: { type: "boolean", description: "Salva .bak antes de gravar" },
    },
    required: ["filePath", "oldString", "newString"],
  },
  run: async ({ filePath, oldString, newString, replaceAll, dryRun, regex, backup }) => {
    const p = fpath(filePath);
    let text;
    try {
      text = readFileSync(p, "utf8");
    } catch (e) {
      return out(fail("n_edit", `edit failed: ${e.message}`, "confira filePath/permissões; leia antes com n_read"), true);
    }
    let count;
    let updated;
    if (regex) {
      let rxG;
      try {
        rxG = new RegExp(oldString, "g");
      } catch (e) {
        return out(fail("n_edit", `invalid regex: ${e.message}`, "valide a regex de oldString; escape caracteres especiais"), true);
      }
      count = (text.match(rxG) || []).length;
      if (count === 0) return out(fail("n_edit", `oldString not found in ${p}`, "leia com n_read e copie o trecho exato; confira espaços/quebras"), true);
      if (count > 1 && replaceAll === false)
        return out(fail("n_edit", `oldString found ${count} times — use replaceAll=true or more context`, "passe replaceAll=true ou amplie o contexto de oldString"), true);
      const rx = new RegExp(oldString, replaceAll === false ? "" : "g");
      updated = text.replace(rx, newString);
    } else {
      count = text.split(oldString).length - 1;
      if (count === 0) return out(fail("n_edit", `oldString not found in ${p}`, "leia com n_read e copie o trecho exato; confira espaços/quebras"), true);
      if (count > 1 && replaceAll === false)
        return out(fail("n_edit", `oldString found ${count} times — use replaceAll=true or more context`, "passe replaceAll=true ou amplie o contexto de oldString"), true);
      updated = replaceAll === false ? text.replace(oldString, newString) : text.split(oldString).join(newString);
    }
    if (dryRun) return out(`matches=${count} count=${count}`);
    try {
      if (backup) await writeFile(`${p}.bak`, text, "utf8");
      await writeFile(p, updated, "utf8");
    } catch (e) {
      return out(fail("n_edit", `edit failed: ${e.message}`, "confira permissões/disco; use n_read p/ validar o arquivo"), true);
    }
    return out(`edited ${p} (${count} occurrence${count > 1 ? "s" : ""}) count=${count}`);
  },
});

// ---- n_apply_patch ----
reg("n_apply_patch", {
  description: "Aplica unified diff via `git apply` NO REPO ROOT (multi-arquivo, reverse opcional). Quando usar: patch gerado por agente/review. Limite: só paths relativos ao repo; fora do repo falha; usa temp file interno.",
  inputSchema: {
    type: "object",
    properties: {
      patch: { type: "string", description: "Diff unificado" },
      reverse: { type: "boolean", description: "Reverte o patch (-R)" },
      check: { type: "boolean", description: "Dry-run: só valida (--check), não aplica" },
      stat: { type: "boolean", description: "Retorna resumo dos arquivos (--stat)" },
    },
    required: ["patch"],
  },
  run: async ({ patch, reverse, check, stat }) => {
    const norm = String(patch).trimEnd() + "\n";
    const tmp = join("/tmp", `native-patch-${Date.now()}.diff`);
    const rev = reverse ? ["-R"] : [];
    try {
      await writeFile(tmp, norm, "utf8");
      if (check) {
        const r = await exec("git", ["apply", "--check", "--whitespace=nowarn", ...rev, tmp], { cwd: CWD });
        return r.code === 0
          ? out(`patch check ok (${Buffer.byteLength(patch)} bytes)`)
          : out(fail("n_apply_patch", `patch check failed (exit ${r.code}):\n${trimOut(r.se, 3000)}`, "rode com stat:true p/ ver arquivos; confira paths relativos ao repo"), true);
      }
      let summary = "";
      if (stat) {
        const s = await exec("git", ["apply", "--stat", ...rev, tmp], { cwd: CWD });
        if (s.code === 0) summary = `${trimOut(s.so, 2000)}\n`;
      }
      const r = await exec("git", ["apply", "--whitespace=nowarn", ...rev, tmp], { cwd: CWD });
      return r.code === 0
        ? out(`${summary}patch applied (${Buffer.byteLength(patch)} bytes)`)
        : out(fail("n_apply_patch", `${summary}git apply failed (exit ${r.code}):\n${trimOut(r.se, 3000)}`, "confira o diff (paths relativos, contexto); rode check:true antes"), true);
    } finally {
      try {
        await unlink(tmp);
      } catch {
        /* temp file already gone */
      }
    }
  },
});

// ---- n_bash ----
reg("n_bash", {
  description: "Executa shell (bash -lc) no repo root: git, npm, node, curl. Roda como o usuário do servidor (veja `as:` no output; file tools rodam como o mesmo usuário — confira `as:` em n_write). Retorna exit+stdout (cap 20k, até 100k via maxOutput)+stderr. Colapsa repetições consecutivas ([xN]) e barras de progresso (tail/stderr integrais; sem repetição sai idêntico). Quando usar: comandos/validação/git; p/ ler arquivos prefira n_read/n_grep. Timeout 120s (até 600s); tarefa longa use n_manage_background_process. Suporta env/retries/workdir.",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string" },
      cwd: { type: "string", description: "Working directory (default: repo root)" },
      workdir: { type: "string", description: "Alias de cwd (mesma coisa; prefira cwd). Working directory (default: repo root)" },
      env: { type: "object", description: "Vars extras de ambiente (merge com process.env). Ex: {\"NODE_ENV\":\"test\"}" },
      retries: { type: "number", description: "0-2, re-tenta se exit!=0. Ex: 1 p/ comandos flaky" },
      timeout: { type: "number", description: "Timeout ms (default 120000, máx 600000). Ex: 30000 p/ comandos rápidos, 600000 p/ npm install/build; p/ mais que isso rode em background com n_manage_background_process" },
      maxOutput: { type: "number", description: "Max chars of stdout (default 20000, máx 100000). Ex: 100000 p/ saídas grandes (diff, logs)" },
    },
    required: ["command"],
  },
  run: async ({ command, cwd, workdir, env, retries, timeout, maxOutput }) => {
    if (typeof command !== "string" || !command.trim())
      return out(fail("n_bash", "command is required (string, non-empty)", "passe um comando shell válido; ex: {command:\"git status --porcelain\"}"), true);
    const dirArg = workdir ?? cwd;
    let base;
    try {
      base = dirArg ? fpath(dirArg) : CWD;
    } catch (e) {
      return out(fail("n_bash", `invalid workdir/cwd: ${e.message}`, "use caminho relativo ao repo ou absoluto válido"), true);
    }
    const extraEnv =
      env && typeof env === "object" && !Array.isArray(env)
        ? Object.fromEntries(Object.entries(env).map(([k, v]) => [String(k), String(v)]))
        : {};
    const tries = Math.min(Math.max(Number.parseInt(retries) || 0, 0), 2);
    const timeoutMs = Math.min(Math.max(Number(timeout) || 120000, 1000), 600000);
    let r;
    let attempt = 0;
    let t0 = Date.now();
    for (; attempt <= tries; attempt++) {
      t0 = Date.now();
      r = await exec("bash", ["-lc", command], { timeout: timeoutMs, cwd: base, env: extraEnv });
      if (r.error || r.killed) break;
      if (r.code === 0) break;
      if (attempt === tries) break;
    }
    const elapsed = Math.round((Date.now() - t0) / 1000);
    const cap = Math.min(Math.max(Number(maxOutput) || 20000, 1000), 100000);
    const capErr = 4000;
    const collapsed = collapseBash(r.so); // RLE [xN] + progresso→last; tail/stderr integrais; sem repetição = idêntico
    const soSrc = collapsed.text;
    const collapseNote = collapsed.saved > 0 ? `, collapsed ${r.so.length}→${soSrc.length}` : "";
    const so = soSrc.length > cap ? soSrc.slice(0, cap) + `\n...[truncated ${soSrc.length - cap} chars; run again with maxOutput=${cap} (máx 100000) ou use n_read/n_grep p/ arquivos]` : soSrc;
    const se = r.se.length > capErr ? r.se.slice(0, capErr) + `\n...[truncated ${r.se.length - capErr} chars]` : r.se;
    let msg = `exit=${r.error ? `spawn-error: ${r.error} (cwd=${base})` : r.killed ? "timeout" : r.code} (as ${RUN_AS}, ${elapsed}s, ${r.so.length} chars stdout${collapseNote})\n--- stdout ---\n${so}\n--- stderr ---\n${se}`;
    if (tries > 0) msg += `\n(tentativa ${attempt + 1}/${tries + 1})`;
    if (r.killed) {
      msg += `\n--- progresso antes do timeout (${elapsed}s / ${Math.round(timeoutMs / 1000)}s, ${r.so.length} chars) ---\n${r.so.length ? r.so.slice(-800) : "(sem stdout)"}`;
      msg += `\ntimeout em ${Math.round(timeoutMs / 1000)}s — aumente com timeout até 600000 (10min) ou rode a tarefa longa em background sem bloquear: n_manage_background_process({action:"start", command:"..."}) e acompanhe com {action:"read_logs"}/{action:"stop"}; encadeie comandos dependentes com &&`;
    }
    const isErr = !!(r.error || r.killed || r.code !== 0);
    // dica curta e só em falha (nunca em sucesso; no timeout o bloco acima já orienta — sem duplicar)
    return out(isErr ? fail("n_bash", msg, r.killed ? "" : "timeout até 600000 p/ tarefa longa ou background via n_manage_background_process; && p/ dependentes; p/ arquivos use n_read/n_grep") : msg, isErr);
  },
});

// ---- n_glob ----
reg("n_glob", {
  description: "Acha arquivos por glob (** suportado, até 500). Quando usar: descobrir arquivos de um módulo/teste antes de n_read. Ex: {pattern:\"src/**/*.test.js\"}. Para topologia geral prefira n_get_architecture_summary.",
  inputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "e.g. src/**/*.jsx" },
      cwd: { type: "string" },
      maxResults: { type: "number", default: 500 },
      ignore: { type: "string", description: "Globs CSV p/ excluir (ex \"*.min.js,**/dist/**\")" },
      only_files: { type: "boolean", description: "false inclui diretórios (com / no final)" },
    },
    required: ["pattern"],
  },
  run: async ({ pattern, cwd, maxResults, ignore, only_files }) => {
    const root = fpath(cwd || CWD);
    const rx = globToRegex(pattern);
    const ignores = String(ignore || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map(globToRegex);
    const skipped = (rel) => ignores.some((r) => r.test(rel.replace(/\\/g, "/")));
    const files = [];
    walkFiles(root, files);
    let matched = files.filter((f) => rx.test(f.replace(/\\/g, "/")) && !skipped(f));
    if (only_files === false) {
      const dirs = [];
      const rec = (rel) => {
        let ents;
        try {
          ents = readdirSync(join(root, rel), { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of ents) {
          if (!e.isDirectory()) continue;
          if (SKIP_DIRS.has(e.name)) continue;
          const r = rel ? join(rel, e.name) : e.name;
          if (!skipped(r)) dirs.push(r.replace(/\\/g, "/") + "/");
          rec(r);
        }
      };
      rec("");
      matched = [...dirs.filter((d) => rx.test(d) && !skipped(d)), ...matched];
    }
    matched.sort();
    const cap = maxResults || 500;
    const shown = matched.slice(0, cap).map((f) => f.replace(/\\/g, "/"));
    const extra = matched.length - shown.length;
    return out(shown.length ? `${shown.join("\n")}${extra > 0 ? `\n... plus ${extra} more` : ""}` : `no matches for ${pattern}`);
  },
});

// ---- n_grep ----
reg("n_grep", {
  description: "Busca regex no conteúdo (path:line:trecho ≤300 chars, maxResults 100, include glob, ignoreCase). Quando usar: localizar símbolo/uso antes de n_analyze_change_impact; achar config/erro. Rank por relevância: nome do arquivo > conteúdo, match exato > parcial (mesmo nº de hits, melhores primeiro). Para causa raiz com ranking use n_investigate_issue (12→1). Ex: {pattern:\"syncAll\", path:\"src\"}.",
  inputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Regular expression" },
      path: { type: "string", description: "File or directory (default: repo root)" },
      include: { type: "string", description: "Filename glob filter" },
      ignoreCase: { type: "boolean" },
      maxResults: { type: "number", default: 100 },
      context: { type: "number", description: "Linhas ao redor do match (default 0, máx 10)" },
      files_with_matches: { type: "boolean", description: "Só paths (economiza tokens)" },
    },
    required: ["pattern"],
  },
  run: async ({ pattern, path, include, ignoreCase, maxResults, context, files_with_matches }) => {
    let rx;
    try {
      rx = new RegExp(pattern, ignoreCase ? "i" : "");
    } catch (e) {
      return out(fail("n_grep", `invalid regex: ${e.message}`, "valide a regex; escape caracteres especiais"), true);
    }
    const p = fpath(path || CWD);
    let st;
    try {
      st = await stat(p);
    } catch (e) {
      return out(fail("n_grep", `path not found: ${e.message}`, "confira o path; use n_glob/n_list p/ achar o caminho"), true);
    }
    const cap = maxResults || 100;
    const ctx = Math.min(Math.max(Number(context) || 0, 0), 10);
    const fileRx = include ? globToRegex(include) : null;
    // rank: tokens literais do pattern (regex vira substring p/ score; o match continua regex puro)
    const toks = [...new Set((String(pattern).match(/[A-Za-z0-9_$]{2,}/g) || [String(pattern)]).map((t) => t.toLowerCase()))].slice(0, 8);
    const exactRxs = toks.map((t) => { try { return new RegExp(`\\b${escapeRe(t)}\\b`, ignoreCase ? "i" : ""); } catch { return null; } });
    const subRxs = toks.map((t) => { try { return new RegExp(escapeRe(t), ignoreCase ? "i" : ""); } catch { return null; } });
    const fileScore = (norm) => {
      const nl = norm.toLowerCase();
      const base = nl.slice(nl.lastIndexOf("/") + 1);
      let s = 0;
      for (const t of toks) {
        if (base.includes(t)) s += 100; // nome do arquivo >> conteúdo
        else if (nl.includes(t)) s += 20;
      }
      return s;
    };
    const lineScore = (ln) => {
      const L = String(ln);
      let s = 0;
      for (let k = 0; k < toks.length; k++) {
        if (exactRxs[k] && exactRxs[k].test(L)) s += 20; // exato > parcial
        else if (subRxs[k] && subRxs[k].test(L)) s += 5;
      }
      s += Math.max(0, 8 - L.length / 60); // desempate: linha concisa primeiro
      return s;
    };
    const POOL = Math.max(cap * 5, 500); // teto de RAM do rank (saída continua = cap)
    const PRUNE_AT = POOL + 500;
    let seq = 0;
    const byScore = (a, b) => b.score - a.score || a.idx - b.idx; // estável: empate mantém ordem de walk
    const scored = []; // {text, score, idx} — sem ctx: 1/match; com ctx: 1 bloco/range
    const paths = new Map(); // norm -> score (files_with_matches)
    let matchCount = 0; // total p/ truncMsg (mesma semântica de antes)
    const pushScored = (text, score) => {
      scored.push({ text, score, idx: seq++ });
      if (scored.length >= PRUNE_AT) { scored.sort(byScore); scored.length = POOL; }
    };
    const scan = (file, rel) => {
      const norm = rel.replace(/\\/g, "/");
      if (fileRx && !fileRx.test(norm)) return;
      let text;
      try {
        text = readFileSync(file, "utf8");
        if (text.indexOf("\0") >= 0) return; // binário: pula (culpa do dev se varrer lixo)
      } catch {
        return;
      }
      const lines = text.split("\n");
      const fs = fileScore(norm);
      if (files_with_matches) {
        for (let i = 0; i < lines.length; i++) {
          if (rx.test(lines[i])) {
            const sc = fs + 10;
            if (paths.get(norm) == null || sc > paths.get(norm)) paths.set(norm, sc);
            matchCount++;
            break;
          }
        }
        return;
      }
      const idx = [];
      const perFile = Math.max(cap, 200); // janela/arquivo (saída global continua = cap)
      for (let i = 0; i < lines.length && idx.length < perFile; i++) {
        if (rx.test(lines[i])) {
          idx.push(i);
          matchCount++;
        }
      }
      if (!idx.length) return;
      if (!ctx) {
        for (const i of idx) pushScored(`${norm}:${i + 1}: ${lines[i].slice(0, 300)}`, fs + lineScore(lines[i]));
        return;
      }
      const ranges = [];
      for (const i of idx) {
        const s = Math.max(0, i - ctx);
        const e = Math.min(lines.length - 1, i + ctx);
        const last = ranges[ranges.length - 1];
        if (last && s <= last[1] + 1) last[1] = Math.max(last[1], e);
        else ranges.push([s, e]);
      }
      const hitSet = new Set(idx);
      for (const [rs, re] of ranges) {
        let best = 0;
        const buf = [];
        for (let i = rs; i <= re; i++) {
          if (hitSet.has(i) && lineScore(lines[i]) > best) best = lineScore(lines[i]);
          buf.push(`${norm}:${i + 1}${hitSet.has(i) ? ":" : "-"} ${lines[i].slice(0, 300)}`);
        }
        pushScored(buf.join("\n"), fs + best);
      }
    };
    if (st.isFile()) {
      scan(p, basename(p));
    } else {
      const files = [];
      walkFiles(p, files);
      for (const f of files) scan(join(p, f), f); // sem early-break: rank global (teto = POOL, saída = cap)
    }
    const truncMsg = matchCount >= cap ? `\n...[truncated at maxResults=${cap} — refine pattern/path/include ou aumente maxResults]` : "";
    if (files_with_matches) {
      if (!paths.size) return out(`no matches for ${pattern}`);
      const ranked = [...paths.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, cap).map(([n]) => n);
      return out(ranked.join("\n") + truncMsg);
    }
    if (!scored.length) return out(`no matches for ${pattern}`);
    scored.sort(byScore);
    // sem ctx: 1 entrada = 1 match → fatia cap; com ctx: acumula blocos até cap matches
    let body;
    if (!ctx) {
      body = scored.slice(0, cap).map((e) => e.text).join("\n");
    } else {
      const buf = [];
      let shown = 0;
      for (const e of scored) {
        const nMatch = (e.text.match(/^.*:\d+:/gm) || []).length;
        if (shown >= cap) break;
        if (buf.length) buf.push("--");
        buf.push(e.text);
        shown += Math.max(1, nMatch);
      }
      body = buf.join("\n");
    }
    return out(body + truncMsg);
  },
});

