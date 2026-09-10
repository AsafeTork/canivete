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

function listDir(p, depth, maxLines = 1500) {
  const lines = [];
  const rec = (dir, lv) => {
    let ents;
    try {
      ents = readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      lines.push(`${"  ".repeat(lv)}! ${e.message}`);
      return;
    }
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
  description: "Lê arquivo texto com números de linha (offset/limit, raw, maxChars até 100k) ou lista diretório. Quando usar: inspecionar código/config antes de editar; ler resto após truncation marker. Retorna 'path (N lines)' + corpo numerado; binário avisa usar n_bash; grande trunca com marker explícito (nunca silent). Ex: {filePath:\"src/lib/sync.js\", offset:1, limit:80}.",
  inputSchema: {
    type: "object",
    properties: {
      filePath: { type: "string", description: "Absolute or project-relative path" },
      offset: { type: "number", description: "First line (1-based)" },
      limit: { type: "number", description: "Max lines" },
      raw: { type: "boolean", description: "Content without line numbers" },
      maxChars: { type: "number", description: "Max chars to return (default 100000)" },
    },
    required: ["filePath"],
  },
  run: async ({ filePath, offset, limit, raw, maxChars }) => {
    const p = fpath(filePath);
    let st;
    try {
      st = await stat(p);
    } catch (e) {
      return out(`not found: ${e.message}`, true);
    }
    if (st.isDirectory()) return listDir(p, 1);
    const buf = readFileSync(p);
    if (buf.indexOf(0) >= 0) return out(`binary file (${buf.length} bytes) — use n_bash to handle it`);
    let text = buf.toString("utf8");
    const cap = Math.max(1000, Number(maxChars) || 100000);
    if (text.length > cap) text = text.slice(0, cap) + `\n...[truncated ${text.length} chars — use offset/limit to read the rest]`;
    if (raw) return out(text);
    const lines = text.split("\n");
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
    },
    required: [],
  },
  run: async ({ path, depth, maxLines }) => listDir(fpath(path || CWD), Math.min(Number(depth) || 2, 6), Math.max(1, Number(maxLines) || 1500)),
});

reg("n_write", {
  description: "Cria/sobrescreve arquivo (cria pastas). Quando usar: arquivo novo ou rewrite total; para troca pontual prefira n_edit/n_apply_semantic_patch (AST). Retorna bytes escritos. Ex: {filePath:\"/tmp/x.txt\", content:\"...\"}.",
  inputSchema: {
    type: "object",
    properties: {
      filePath: { type: "string" },
      content: { type: "string" },
    },
    required: ["filePath", "content"],
  },
  run: async ({ filePath, content }) => {
    const p = fpath(filePath);
    try {
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, content, "utf8");
      return out(`wrote ${p} (${Buffer.byteLength(content)} bytes)`);
    } catch (e) {
      return out(`write failed: ${e.message}`, true);
    }
  },
});

reg("n_edit", {
  description: "Troca texto exato (oldString→newString, replaceAll default true, dryRun conta matches). Falha segura se 0 ou ambíguo sem contexto. Quando usar: edição pontual com contexto; para validar sintaxe use n_apply_semantic_patch. Ex: {filePath, oldString, newString}.",
  inputSchema: {
    type: "object",
    properties: {
      filePath: { type: "string" },
      oldString: { type: "string", description: "Exact existing text" },
      newString: { type: "string" },
      replaceAll: { type: "boolean", description: "Replace all occurrences (default true)" },
      dryRun: { type: "boolean", description: "Only report the match count" },
    },
    required: ["filePath", "oldString", "newString"],
  },
  run: async ({ filePath, oldString, newString, replaceAll, dryRun }) => {
    const p = fpath(filePath);
    let text;
    try {
      text = readFileSync(p, "utf8");
    } catch (e) {
      return out(`edit failed: ${e.message}`, true);
    }
    const count = text.split(oldString).length - 1;
    if (count === 0) return out(`oldString not found in ${p}`, true);
    if (count > 1 && replaceAll === false)
      return out(`oldString found ${count} times — use replaceAll=true or more context`, true);
    const updated = replaceAll === false ? text.replace(oldString, newString) : text.split(oldString).join(newString);
    if (dryRun) return out(`matches=${count}`);
    try {
      await writeFile(p, updated, "utf8");
    } catch (e) {
      return out(`edit failed: ${e.message}`, true);
    }
    return out(`edited ${p} (${count} occurrence${count > 1 ? "s" : ""})`);
  },
});

reg("n_apply_patch", {
  description: "Aplica unified diff via `git apply` (multi-arquivo, reverse opcional). Quando usar: patch gerado por agente/review; para 1 hunk prefira n_edit/n_apply_semantic_patch. Retorna bytes ou erro git. Ex: {patch:\"--- a/...\"}.",
  inputSchema: {
    type: "object",
    properties: {
      patch: { type: "string", description: "Unified diff text" },
      reverse: { type: "boolean" },
    },
    required: ["patch"],
  },
  run: async ({ patch, reverse }) => {
    const norm = String(patch).trimEnd() + "\n";
    const tmp = join("/tmp", `native-patch-${Date.now()}.diff`);
    try {
      await writeFile(tmp, norm, "utf8");
      const r = await exec("git", ["apply", "--whitespace=nowarn", ...(reverse ? ["-R"] : []), tmp], { cwd: CWD });
      return r.code === 0
        ? out(`patch applied (${Buffer.byteLength(patch)} bytes)`)
        : out(`git apply failed (exit ${r.code}):\n${trimOut(r.se, 3000)}`, true);
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
  description: "Executa shell (bash -lc) no repo root: git, npm, node, opencode, curl. Retorna exit + stdout (cap 20k, ampliável via maxOutput) + stderr (4k). Quando usar: comandos, validação, git; para ler arquivos prefira n_read/n_grep (economiza tokens). exit!=0 → isError. Ex: {command:\"git status --porcelain\"}. Timeout default 120s.",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string" },
      cwd: { type: "string", description: "Working directory (default: repo root)" },
      timeout: { type: "number", description: "Timeout ms (default 120000)" },
      maxOutput: { type: "number", description: "Max chars of stdout (default 20000; raise for big outputs)" },
    },
    required: ["command"],
  },
  run: async ({ command, cwd, timeout, maxOutput }) => {
    if (typeof command !== "string" || !command.trim()) return out("command is required (string, non-empty)", true);
    const r = await exec("bash", ["-lc", command], { timeout: timeout || 120000, cwd: cwd ? fpath(cwd) : CWD });
    const cap = Math.min(Math.max(Number(maxOutput) || 20000, 1000), 200000);
    const capErr = 4000;
    const so = r.so.length > cap ? r.so.slice(0, cap) + `\n...[truncated ${r.so.length - cap} chars; run again with maxOutput=${cap * 2} or use n_read/n_grep for files]` : r.so;
    const se = r.se.length > capErr ? r.se.slice(0, capErr) + `\n...[truncated ${r.se.length - capErr} chars]` : r.se;
    const msg = `exit=${r.error ? "spawn-error" : r.killed ? "timeout" : r.code}\n--- stdout ---\n${so}\n--- stderr ---\n${se}`;
    return out(msg, r.error ? true : r.code !== 0);
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
    },
    required: ["pattern"],
  },
  run: async ({ pattern, cwd, maxResults }) => {
    const root = fpath(cwd || CWD);
    const rx = globToRegex(pattern);
    const files = [];
    walkFiles(root, files);
    const matched = files.filter((f) => rx.test(f.replace(/\\/g, "/")));
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
    },
    required: ["pattern"],
  },
  run: async ({ pattern, path, include, ignoreCase, maxResults }) => {
    let rx;
    try {
      rx = new RegExp(pattern, ignoreCase ? "i" : "");
    } catch (e) {
      return out(`invalid regex: ${e.message}`, true);
    }
    const p = fpath(path || CWD);
    let st;
    try {
      st = await stat(p);
    } catch (e) {
      return out(`path not found: ${e.message}`, true);
    }
    const fileRx = include ? globToRegex(include) : null;
    const hits = [];
    const scan = (file, rel) => {
      if (fileRx && !fileRx.test(rel.replace(/\\/g, "/"))) return;
      let text;
      try {
        text = readFileSync(file, "utf8");
        if (text.indexOf("\0") >= 0) return; // binário: pula (culpa do dev se varrer lixo)
      } catch {
        return;
      }
      const lines = text.split("\n");
      for (let i = 0; i < lines.length && hits.length < (maxResults || 100); i++) {
        if (rx.test(lines[i])) hits.push(`${rel.replace(/\\/g, "/")}:${i + 1}: ${lines[i].slice(0, 300)}`);
      }
    };
    if (st.isFile()) {
      scan(p, basename(p));
    } else {
      const files = [];
      walkFiles(p, files);
      for (const f of files) scan(join(p, f), f);
    }
    return out(hits.length ? hits.join("\n") : `no matches for ${pattern}`);
  },
});

