// canivete — filesystem + execução (read/list/write/edit/patch/bash/glob/grep)
import { mkdir, writeFile, unlink, stat, rename } from "node:fs/promises";
import { readFileSync, readdirSync, statSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
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
  return `ERRO ${tool}: ${msg} | dica: ${hint}`;
}

function listDir(p, depth, maxLines = 1500, sort = "name") {
  const lines = [];
  const rec = (dir, lv) => {
    let ents;
    try {
      ents = readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      lines.push(`${"  ".repeat(lv)}! ${e.message}`);
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
  const total = lines.length;
  if (total > maxLines) {
    lines.length = maxLines;
    lines.push(`...[truncated ${total - maxLines} lines — reduce depth or use n_glob/n_grep]`);
  }
  return out(lines.join("\n") || "(empty)");
}

reg("n_read", {
  description: "Lê arquivo texto com números de linha (offset/limit, raw, maxChars até 100k) ou lista diretório simples. Quando usar: inspecionar código/config antes de editar. Retorna corpo numerado (raw tira números); binário/ausente retorna isError; grande trunca com marker explícito (nunca silent).",
  inputSchema: {
    type: "object",
    properties: {
      filePath: { type: "string", description: "Absolute or project-relative path" },
      offset: { type: "number", description: "First line (1-based)" },
      limit: { type: "number", description: "Max lines" },
      raw: { type: "boolean", description: "Content without line numbers" },
      maxChars: { type: "number", description: "Max chars to return (default 100000)" },
      tail: { type: "number", description: "Últimas N linhas (p/ logs)" },
      grep: { type: "string", description: "Filtro regex inline (só linhas matching, numeradas)" },
    },
    required: ["filePath"],
  },
  run: async ({ filePath, offset, limit, raw, maxChars, tail, grep }) => {
    const p = fpath(filePath);
    let st;
    try {
      st = await stat(p);
    } catch (e) {
      return out(fail("n_read", `not found: ${e.message}`, "confira o filePath; use n_glob/n_list p/ achar o caminho"), true);
    }
    if (st.isDirectory()) return listDir(p, 1);
    const buf = readFileSync(p);
    if (buf.indexOf(0) >= 0) return out(`binary file (${buf.length} bytes) — use n_bash to handle it`);
    let text = buf.toString("utf8");
    let lines = text.split("\n");
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
      if (!kept.length) return out(`no matches for /${grep || ""}/ in ${p} (${lines.length} lines)`);
      const cap = Math.max(1000, Number(maxChars) || 100000);
      let body = raw ? kept.map((e) => e.l).join("\n") : kept.map((e) => `${String(e.n).padStart(5)}: ${e.l}`).join("\n");
      if (body.length > cap) body = body.slice(0, cap) + `\n...[truncated — refine tail/grep]`;
      const mode = `${hasTail ? `tail=${Number(tail)} ` : ""}${hasGrep ? `grep=/${grep}/ ` : ""}`;
      return out(`${p} (${mode}${kept.length}/${lines.length} lines)\n${body}`);
    }
    const cap = Math.max(1000, Number(maxChars) || 100000);
    if (text.length > cap) text = text.slice(0, cap) + `\n...[truncated ${text.length} chars — use offset/limit to read the rest]`;
    if (raw) return out(text);
    lines = text.split("\n");
    const start = Math.max(1, Number(offset) || 1);
    const end = Math.min(lines.length, start + (Number(limit) || 4000) - 1);
    const body = lines
      .slice(start - 1, end)
      .map((l, i) => `${String(start + i).padStart(5)}: ${l}`)
      .join("\n");
    if (offset == null && limit == null) return out(`${p} (${lines.length} lines)\n${body}`);
    return out(`${p} lines ${start}-${end} of ${lines.length}\n${body}`);
  },
});

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

reg("n_write", {
  description: "Cria/sobrescreve arquivo (cria pastas). Quando usar: arquivo novo ou rewrite total; para troca pontual prefira n_edit/n_apply_semantic_patch (AST). Retorna bytes escritos. Ex: {filePath:\"/tmp/x.txt\", content:\"...\"}.",
  inputSchema: {
    type: "object",
    properties: {
      filePath: { type: "string", description: "Caminho do arquivo" },
      content: { type: "string", description: "Conteúdo a gravar/anexar" },
      mkdirs: { type: "boolean", description: "Cria pastas (default true; false desliga)" },
      append: { type: "boolean", description: "Anexa ao fim em vez de sobrescrever" },
    },
    required: ["filePath", "content"],
  },
  run: async ({ filePath, content, mkdirs, append }) => {
    const p = fpath(filePath);
    try {
      if (mkdirs !== false) await mkdir(dirname(p), { recursive: true });
      if (append) await writeFile(p, content, { encoding: "utf8", flag: "a" });
      else await writeFile(p, content, "utf8");
      return out(`${append ? "appended" : "wrote"} ${p} (${Buffer.byteLength(content)} bytes)`);
    } catch (e) {
      return out(fail("n_write", `write failed: ${e.message}`, "confira permissões e o filePath; use n_list p/ validar a pasta"), true);
    }
  },
});

reg("n_edit", {
  description: "Troca texto exato (oldString→newString, replaceAll default true, dryRun conta matches). Quando usar: edição pontual com contexto; para validar sintaxe use n_apply_semantic_patch. Limite: default substitui TODAS as ocorrências; ambíguo só falha com replaceAll=false; 0 matches sempre falha.",
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

reg("n_bash", {
  description: "Executa shell (bash -lc) no repo root: git, npm, node, opencode, curl. Retorna exit + stdout (cap 20k, ampliável via maxOutput) + stderr (4k). Quando usar: comandos, validação, git; para ler arquivos prefira n_read/n_grep (economiza tokens). exit!=0 → isError. Ex: {command:\"git status --porcelain\"}. Timeout default 120s (use longo p/ installs/builds). Suporta env extra, retries (0-2) e workdir (alias de cwd).",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string" },
      cwd: { type: "string", description: "Working directory (default: repo root)" },
      workdir: { type: "string", description: "Alias de cwd — Working directory (default: repo root)" },
      env: { type: "object", description: "Vars extras de ambiente (merge com process.env). Ex: {\"NODE_ENV\":\"test\"}" },
      retries: { type: "number", description: "0-2, re-tenta se exit!=0. Ex: 1 p/ comandos flaky" },
      timeout: { type: "number", description: "Timeout ms (default 120000). Ex: 30000 p/ comandos rápidos, 600000 p/ npm install/build" },
      maxOutput: { type: "number", description: "Max chars of stdout (default 20000; raise for big outputs)" },
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
    let r;
    let attempt = 0;
    for (; attempt <= tries; attempt++) {
      r = await exec("bash", ["-lc", command], { timeout: timeout || 120000, cwd: base, env: extraEnv });
      if (r.error || r.killed) break;
      if (r.code === 0) break;
      if (attempt === tries) break;
    }
    const cap = Math.min(Math.max(Number(maxOutput) || 20000, 1000), 200000);
    const capErr = 4000;
    const so = r.so.length > cap ? r.so.slice(0, cap) + `\n...[truncated ${r.so.length - cap} chars; run again with maxOutput=${cap * 2} or use n_read/n_grep for files]` : r.so;
    const se = r.se.length > capErr ? r.se.slice(0, capErr) + `\n...[truncated ${r.se.length - capErr} chars]` : r.se;
    let msg = `exit=${r.error ? "spawn-error" : r.killed ? "timeout" : r.code}\n--- stdout ---\n${so}\n--- stderr ---\n${se}`;
    if (tries > 0) msg += `\n(tentativa ${attempt + 1}/${tries + 1})`;
    if (r.killed && r.so.length) msg += `\n--- timeout parcial (últimos 500 chars do stdout) ---\n${r.so.slice(-500)}`;
    const isErr = !!(r.error || r.killed || r.code !== 0);
    return out(isErr ? fail("n_bash", msg, "confira comando/cwd; p/ arquivos use n_read/n_grep; amplie timeout p/ installs (ex: 600000)") : msg, isErr);
  },
});

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

reg("n_grep", {
  description: "Busca regex no conteúdo (path:line:trecho ≤300 chars, maxResults 100, include glob, ignoreCase). Quando usar: localizar símbolo/uso antes de n_analyze_change_impact; achar config/erro. Para causa raiz com ranking use n_investigate_issue (12→1). Ex: {pattern:\"syncAll\", path:\"src\"}.",
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
    const hits = [];
    const paths = new Set();
    let matchCount = 0;
    const scan = (file, rel) => {
      if (matchCount >= cap) return;
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
      if (files_with_matches) {
        for (let i = 0; i < lines.length; i++) {
          if (rx.test(lines[i])) {
            paths.add(norm);
            matchCount++;
            break;
          }
        }
        return;
      }
      const idx = [];
      for (let i = 0; i < lines.length && matchCount < cap; i++) {
        if (rx.test(lines[i])) {
          idx.push(i);
          matchCount++;
        }
      }
      if (!idx.length) return;
      if (!ctx) {
        for (const i of idx) hits.push(`${norm}:${i + 1}: ${lines[i].slice(0, 300)}`);
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
      for (let r = 0; r < ranges.length; r++) {
        if (r > 0) hits.push("--");
        for (let i = ranges[r][0]; i <= ranges[r][1]; i++) hits.push(`${norm}:${i + 1}${hitSet.has(i) ? ":" : "-"} ${lines[i].slice(0, 300)}`);
      }
    };
    if (st.isFile()) {
      scan(p, basename(p));
    } else {
      const files = [];
      walkFiles(p, files);
      for (const f of files) scan(join(p, f), f);
    }
    if (files_with_matches) return out(paths.size ? [...paths].slice(0, cap).join("\n") : `no matches for ${pattern}`);
    return out(hits.length ? hits.join("\n") : `no matches for ${pattern}`);
  },
});

