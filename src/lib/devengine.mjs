// canivete — DevEngine: arquitetura, investigação, impacto, patch AST, testes, bg, UI, DAG
import { spawn } from "node:child_process";
import { mkdir, writeFile, unlink, stat, rename } from "node:fs/promises";
import { readFileSync, readdirSync, statSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { reg, out, devOut, trimOut, estTokens, fpath, exec, walkFiles, escapeRe, WALK_CAP, isSkippable, CWD, HOME, SKIP_DIRS } from "./ctx.mjs";
import { tasks, taskId, persistTask, resolveTask } from "./tasks.mjs";

function loadPkg() {
  try {
    return JSON.parse(readFileSync(join(CWD, "package.json"), "utf8"));
  } catch {
    return {};
  }
}
function scanFeatures() {
  const feats = [];
  try {
    for (const d of readdirSync(join(CWD, "src/features"), { withFileTypes: true })) if (d.isDirectory()) feats.push(d.name);
  } catch {}
  return feats;
}
function scanFunctions() {
  const fns = [];
  try {
    for (const d of readdirSync(join(CWD, "supabase/functions"), { withFileTypes: true })) if (d.isDirectory()) fns.push(d.name);
  } catch {}
  return fns;
}
function extractSymbols(text, rel) {
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
function buildSymbolIndex(limit = 300) {
  const files = [];
  walkFiles(CWD, files);
  const syms = [];
  for (const f of files) {
    if (!/\.(jsx?|tsx?)$/.test(f)) continue;
    if (f.includes("node_modules") || f.includes("dist") || f.includes(".next")) continue;
    try {
      const txt = readFileSync(join(CWD, f), "utf8");
        if (txt.indexOf("\0") >= 0) continue; // binário
      syms.push(...extractSymbols(txt, f));
      if (syms.length >= limit) break;
    } catch {}
  }
  return syms;
}
const bgProcs = new Map();

// ---- DevEngine tools ----

reg("n_get_architecture_summary", {
  description: "DevEngine: topologia leve do projeto (package.json + scans de features/functions, sem ler arquivos inteiros). Quando usar: entender arquitetura antes de qualquer tarefa. Retorna stack, entrypoints, features, EFs e padrões.",
  inputSchema: {
    type: "object",
    properties: {
      depth: { type: "number", description: "Profundidade (1-3)", default: 2 },
      focus_module: { type: "string", description: "Foco: features|lib|supabase|all", default: "all" },
    },
    required: [],
  },
  run: async ({ depth, focus_module }) => {
    const t0 = Date.now();
    if (!existsSync(join(CWD, "package.json"))) return devOut({ status: "error", summary: `CWD inválido: ${CWD} — sem package.json`, data: {}, telemetry: { execution_time_ms: 0 } });
    const pkg = loadPkg();
    const feats = scanFeatures();
    const fns = scanFunctions();
    const dexie = (() => {
      try {
        return readFileSync(join(CWD, "src/lib/dexie.js"), "utf8").slice(0, 800);
      } catch {
        return "";
      }
    })();
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const stack = {};
    if (deps.react) stack.frontend = `react ${deps.react}`;
    if (deps.vite) stack.build = `vite ${deps.vite}`;
    if (deps.dexie) stack.offline = `dexie ${deps.dexie}`;
    if (deps["@supabase/supabase-js"]) stack.backend = `supabase ${deps["@supabase/supabase-js"]}`;
    if (deps.typescript) stack.lang = `typescript ${deps.typescript}`;
    if (deps.vitest) stack.test = `vitest ${deps.vitest}`;
    if (deps.tailwindcss) stack.css = `tailwindcss ${deps.tailwindcss}`;
    if (!Object.keys(stack).length) stack.note = "sem deps JS reconhecíveis em package.json — use n_list para mapear";
    const entrypoints = ["src/main.jsx", "src/App.jsx", "src/routes/routes.jsx", "supabase/functions", "server.cjs"].filter((e) => existsSync(join(CWD, e)));
    const patterns = [];
    if (deps.dexie || existsSync(join(CWD, "src/lib/dexie.js"))) patterns.push("offline-first (Dexie IndexedDB)");
    if (feats.length) patterns.push("feature-first (src/features/*)");
    if (existsSync(join(CWD, "supabase"))) patterns.push("supabase (auth/db/edge functions)");
    const data = {
      project: pkg.name || basename(CWD),
      version: pkg.version,
      stack,
      entrypoints,
      modules: { features: feats, edge_functions: fns.slice(0, 30) },
      patterns,
      dexie_stores: dexie.match(/stores\(\{[^}]+\}/s)?.[0]?.slice(0, 300) || "",
      focus: focus_module || "all",
    };
    const tradTokens = feats.length * 800 + fns.length * 600 + 4000;
    const devTokens = estTokens(JSON.stringify(data));
    return devOut({
      summary: `Arquitetura ${pkg.name || basename(CWD)} v${pkg.version || "?"}: ${feats.length} features, ${fns.length} edge functions`,
      data,
      telemetry: { tokens_saved: Math.max(0, tradTokens - devTokens), execution_time_ms: Date.now() - t0, trad_tokens_est: tradTokens, dev_tokens: devTokens },
      next: [{ tool: "n_investigate_issue", reason: "Localizar causa raiz sem varredura manual" }],
      refs: entrypoints.slice(0, 3).map((e) => `${e}:1`),
    });
  },
});

reg("n_investigate_issue", {
  description: "DevEngine: busca keyword OR (12 hits→8) com score por contagem + stack_trace opcional. Quando usar: bug/erro com symptom. Retorna candidatos ranqueados. Limite: NÃO é grafo de chamadas nem busca semântica — para caso simples prefira n_grep.",
  inputSchema: {
    type: "object",
    properties: {
      symptom: { type: "string", description: "Descrição do bug/comportamento" },
      stack_trace: { type: "string", description: "Stack trace p/ salto direto" },
      max_depth: { type: "number", default: 3, description: "Profundidade (reservado)" },
      include: { type: "string", description: "Globs CSV p/ filtrar arquivos, ex *.{js,ts}" },
      exclude_dirs: { type: "string", description: "Dirs extras CSV além do SKIP_DIRS" },
      context_lines: { type: "number", default: 1, description: "Linhas de contexto (0-5)" },
    },
    required: ["symptom"],
  },
  run: async ({ symptom, stack_trace, max_depth, include, exclude_dirs, context_lines }) => {
    const t0 = Date.now();
    const keywords = String(symptom).split(/\s+/).filter((w) => w.length > 2).slice(0, 6);
    const pattern = keywords.map(escapeRe).join("|") || escapeRe(symptom.slice(0, 20));
    let rx;
    try {
      rx = new RegExp(pattern, "i");
    } catch {
      rx = new RegExp(escapeRe(symptom.slice(0, 20)), "i");
    }
    let ctxN = Math.round(Number(context_lines ?? 1));
    if (!Number.isFinite(ctxN)) ctxN = 1;
    ctxN = Math.max(0, Math.min(5, ctxN));
    const csvSplit = (s) => {
      const parts = [];
      let cur = "";
      let depth = 0;
      for (const c of String(s || "")) {
        if (c === "{") depth++;
        else if (c === "}") depth = Math.max(0, depth - 1);
        if (c === "," && depth === 0) { parts.push(cur); cur = ""; }
        else cur += c;
      }
      if (cur) parts.push(cur);
      return parts.map((x) => x.trim()).filter(Boolean);
    };
    const extraDirs = new Set(csvSplit(exclude_dirs));
    const expandBraces = (g) => {
      const ob = g.indexOf("{");
      if (ob < 0) return [g];
      const cb = g.indexOf("}", ob);
      if (cb < 0) return [g];
      const pre = g.slice(0, ob);
      const post = g.slice(cb + 1);
      return g.slice(ob + 1, cb).split(",").flatMap((alt) => expandBraces(pre + alt + post));
    };
    const globToRx = (g) => {
      let re = "";
      for (let i = 0; i < g.length; i++) {
        const c = g[i];
        if (c === "*") {
          if (g[i + 1] === "*") {
            if (g[i + 2] === "/") { re += "(.*/)?"; i += 2; }
            else { re += ".*"; i++; }
          } else re += "[^/]*";
        } else if (c === "?") re += "[^/]";
        else if (/[.+^${}()|[\]\\]/.test(c)) re += "\\" + c;
        else re += c;
      }
      return new RegExp("^" + re + "$");
    };
    const incRes = csvSplit(include).flatMap(expandBraces).map(globToRx);
    const isTestFile = (f) => f.includes("__tests__") || /\.test\./.test(f);
    const files = [];
    walkFiles(CWD, files);
    const hits = [];
    const maxHits = 12;
    for (const f of files) {
      if (incRes.length) {
        const base = f.split("/").pop();
        if (!incRes.some((r) => r.test(f) || r.test(base))) continue;
      } else if (!/\.(jsx?|tsx?|ts|js)$/.test(f)) continue;
      if (SKIP_DIRS.has(f.split("/")[0])) continue;
      if (f.split("/").some((p) => extraDirs.has(p))) continue;
      try {
        const txt = readFileSync(join(CWD, f), "utf8");
        if (txt.indexOf("\0") >= 0) continue; // binário
        const lines = txt.split("\n");
        for (let i = 0; i < lines.length && hits.length < maxHits; i++) {
          if (rx.test(lines[i])) {
            const ctx = lines.slice(Math.max(0, i - ctxN), i + 1 + ctxN).join(" | ").slice(0, 240);
            const raw = keywords.filter((k) => lines[i].toLowerCase().includes(k.toLowerCase())).length;
            const isT = isTestFile(f);
            hits.push({ file: f, line: i + 1, snippet: lines[i].slice(0, 200), context: ctx, score: isT ? raw * 0.5 : raw, test: isT });
            break;
          }
        }
      } catch {}
      if (hits.length >= maxHits) break;
    }
    if (stack_trace) {
      const m = String(stack_trace).match(/at\s+.*\(?([^:)]+):(\d+):\d+\)?/);
      if (m) {
        const sf = m[1].replace(CWD + "/", "");
        hits.unshift({ file: sf, line: Number(m[2]), snippet: stack_trace.slice(0, 200), context: "stack_trace", score: 99, test: isTestFile(sf) });
      }
    }
    hits.sort((a, b) => b.score - a.score);
    if (hits.length) {
      try {
        const top = hits[0];
        const ttxt = readFileSync(join(CWD, top.file), "utf8");
        const tlines = ttxt.split("\n");
        const idx = Math.min(tlines.length - 1, Math.max(0, top.line - 1));
        const sigRe = /function|class|const.*=>|=>/;
        let sig = "";
        for (let j = idx - 1; j >= Math.max(0, idx - 40); j--) {
          if (sigRe.test(tlines[j])) { sig = tlines[j].trim().slice(0, 200); break; }
        }
        top.signature = sig;
      } catch { hits[0].signature = ""; }
    }
    const refs = hits.slice(0, 5).map((h) => `${h.file}:${h.line}`);
    return devOut({
      summary: hits.length ? `Causa provável em ${hits[0].file}:${hits[0].line} (${hits.length} candidatos)` : `Nenhum candidato para "${symptom}"`,
      data: { symptom, candidates: hits.slice(0, 8), total_scanned: files.length },
      telemetry: { tokens_saved: Math.max(0, files.length * 120 - hits.length * 80), execution_time_ms: Date.now() - t0 },
      next: hits.length ? [{ tool: "n_analyze_change_impact", reason: "Verificar impacto antes de editar" }] : [{ tool: "n_get_architecture_summary", reason: "Mapear módulos relevantes" }],
      refs,
    });
  },
});

reg("n_analyze_change_impact", {
  description: "DevEngine: impacto de editar um símbolo — callers + tests_affected. Quando usar: ANTES de editar função/componente. Suporta include (glob p/ filtrar arquivos), top (default 15, máx 50 callers, mesmo dir primeiro) e direction callers|callees (callees = símbolos que o ARQUIVO do alvo importa/requer via import/from/require, top 10). Ex: {symbol_id:\"src/lib/sync.js#syncAll\"}. Evita regressões.",
  inputSchema: {
    type: "object",
    properties: {
      symbol_id: { type: "string", description: "Símbolo ou caminho com #símbolo. Ex: src/lib/sync.js#syncAll ou Transactions" },
      file_path: { type: "string", description: "Caminho alternativo do arquivo alvo (usado p/ proximidade e callees)" },
      include: { type: "string", description: "Glob p/ filtrar arquivos varridos. Ex: src/**/*.js, *.test.js. Vazio = todos." },
      top: { type: "number", description: "Máximo de callers retornados (default 15, máx 50)", default: 15 },
      direction: { type: "string", enum: ["callers", "callees"], default: "callers", description: "callers = quem usa o símbolo; callees = o que o ARQUIVO do alvo importa/requer (regex import/from/require, top 10)" },
    },
    required: [],
  },
  run: async ({ symbol_id, file_path, include, top, direction }) => {
    const t0 = Date.now();
    const dir = direction || "callers";
    if (dir !== "callers" && dir !== "callees") return devOut({ status: "error", summary: "direction inválida: use callers|callees", data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    const topN = Math.min(Math.max(Number.parseInt(top) ?? 15, 1) || 15, 50);
    const target = symbol_id || file_path;
    if (!target) return devOut({ status: "error", summary: "symbol_id ou file_path obrigatório", data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    // glob include -> regex (suporta **, *, ?)
    let incRx = null;
    let incNoSlash = false;
    if (include) {
      try {
        let g = String(include).replace(/[.+^${}()|[\]\\]/g, "\\$&");
        g = g.replace(/\*\*\//g, "\0/");
        g = g.replace(/\*\*/g, ".*");
        g = g.replace(/\0\//g, "(.*/)?");
        g = g.replace(/\*/g, "[^/]*");
        g = g.replace(/\?/g, "[^/]");
        incRx = new RegExp(`^${g}$`, "i");
        incNoSlash = !String(include).includes("/");
      } catch {
        return devOut({ status: "error", summary: "include (glob) inválido", data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
      }
    }
    const matchesInclude = (f) => {
      if (!incRx) return true;
      if (incRx.test(f)) return true;
      if (incNoSlash && incRx.test(basename(f))) return true;
      return false;
    };
    // dir do alvo p/ ordenar por proximidade (mesmo dir primeiro)
    const targetFilePart = file_path || (String(target).includes("/") ? String(target).split("#")[0] : "");
    const targetDir = targetFilePart ? dirname(targetFilePart) : "";
    if (dir === "callees") {
      const targetFile = file_path || (String(target).includes("/") ? String(target).split("#")[0] : null);
      if (!targetFile) return devOut({ status: "error", summary: "direction callees exige file_path ou symbol_id com caminho (ex: src/lib/sync.js#syncAll)", data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
      if (isSkippable(targetFile)) return devOut({ status: "error", summary: `arquivo ignorável (mídia/binário): ${targetFile} — operação pulada`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
      let txt;
      try {
        txt = readFileSync(join(CWD, targetFile), "utf8");
      } catch {
        try {
          txt = readFileSync(fpath(targetFile), "utf8");
        } catch (e) {
          return devOut({ status: "error", summary: `arquivo do alvo não encontrado: ${targetFile}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
        }
      }
      if (txt.indexOf("\0") >= 0) return devOut({ status: "error", summary: "arquivo binário — callees indisponível", data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
      const specs = [];
      const seen = new Set();
      const push = (s) => {
        const v = String(s || "").trim();
        if (!v || seen.has(v)) return;
        seen.add(v);
        if (matchesInclude(v) || matchesInclude(v + ".js")) specs.push(v);
        else if (!include) specs.push(v);
      };
      let m;
      const reStatic = /import\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/g;
      while ((m = reStatic.exec(txt))) push(m[1]);
      const reExportFrom = /export\s+[^;]*?\s+from\s+['"]([^'"]+)['"]/g;
      while ((m = reExportFrom.exec(txt))) push(m[1]);
      const reRequire = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
      while ((m = reRequire.exec(txt))) push(m[1]);
      const reDynImport = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
      while ((m = reDynImport.exec(txt))) push(m[1]);
      const callees = specs.slice(0, 10);
      return devOut({
        summary: `${callees.length} dependência(s) importada(s) por ${targetFile}`,
        data: { target, file: targetFile, direction: dir, callees, include: include || null, files_scanned: 1 },
        telemetry: { tokens_saved: 0, execution_time_ms: Date.now() - t0 },
        next: [{ tool: "n_apply_semantic_patch", reason: "Aplicar edição validada por AST" }],
        refs: [`${targetFile}:1`],
      });
    }
    const sym = String(target).split("#").pop().split("/").pop().replace(/\.[^.]+$/, "");
    let rx;
    try {
      rx = new RegExp(`\\b${escapeRe(sym)}\\b`);
    } catch {
      return devOut({ status: "error", summary: "símbolo inválido", data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    }
    const files = [];
    walkFiles(CWD, files);
    const callers = [];
    const tests = [];
    for (const f of files) {
      if (SKIP_DIRS.has(f.split("/")[0])) continue;
      if (isSkippable(f)) continue; // mídia/binário nunca tem símbolo
      if (!matchesInclude(f)) continue;
      try {
        if (statSync(join(CWD, f)).size > 1048576) continue; // >1MB: pula sem ler
        const txt = readFileSync(join(CWD, f), "utf8");
        if (txt.indexOf("\0") >= 0) continue; // binário
        if (rx.test(txt)) {
          const lines = txt.split("\n");
          for (let i = 0; i < lines.length && callers.length < 200; i++) if (rx.test(lines[i])) callers.push({ ref: `${f}:${i + 1}: ${lines[i].slice(0, 180)}`, file: f, sameDir: !!targetDir && dirname(f) === targetDir });
          if (/\.test\.(js|ts)x?$/.test(f) || f.includes("__tests__")) tests.push(f);
        }
      } catch {}
    }
    callers.sort((a, b) => (b.sameDir - a.sameDir) || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
    const callerRefs = callers.map((c) => c.ref).slice(0, topN);
    return devOut({
      summary: `${callers.length} referência(s) a "${sym}" | ${tests.length} teste(s) afetado(s)`,
      data: { target, symbol: sym, direction: dir, include: include || null, top: topN, callers: callerRefs, tests_affected: tests.slice(0, 10), public_api: callerRefs.filter((c) => c.includes("export")).slice(0, 5), files_scanned: files.length, capped: files.length >= WALK_CAP ? `cap ${WALK_CAP} — refine path p/ precisão` : false },
      telemetry: { tokens_saved: Math.max(0, callerRefs.length * 60), execution_time_ms: Date.now() - t0 },
      next: [{ tool: "n_apply_semantic_patch", reason: "Aplicar edição validada por AST" }],
      refs: callerRefs.slice(0, 3).map((c) => c.split(":").slice(0, 2).join(":")),
    });
  },
});

reg("n_apply_semantic_patch", {
  description: "DevEngine: edição AST-validada (node --check, skip JSX). Quando usar: trocar função/constante específica; quer validação sintática. Suporta dry_run:true (valida AST sem escrever, retorna diff preview) e create_if_missing:true (cria arquivo com conteúdo se não existir, com mkdirs). Ex: {file_path, edits:[{target_symbol, new_code}]}. Mais seguro que n_edit para código.",
  inputSchema: {
    type: "object",
    properties: {
      file_path: { type: "string", description: "Caminho do arquivo a editar (relativo ao CWD ou absoluto)" },
      dry_run: { type: "boolean", description: "Se true, valida AST sem escrever no disco e retorna preview do diff", default: false },
      create_if_missing: { type: "boolean", description: "Se true, cria o arquivo (com mkdirs) usando o conteúdo dos new_code/newString quando ele não existir", default: false },
      edits: {
        type: "array",
        description: "Lista de edições (hunks) a aplicar em ordem",
        items: {
          type: "object",
          properties: {
            target_symbol: { type: "string", description: "Função/classe alvo (opcional se oldString)" },
            oldString: { type: "string", description: "Trecho exato a substituir (exigido se sem target_symbol)" },
            new_code: { type: "string", description: "Novo código (alias: newString)" },
            newString: { type: "string", description: "Novo código (alias: new_code)" },
          },
        },
      },
    },
    required: ["file_path", "edits"],
  },
  run: async ({ file_path, edits, dry_run, create_if_missing }) => {
    const t0 = Date.now();
    if (!file_path) return devOut({ status: "error", summary: "file_path obrigatório", data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    if (isSkippable(file_path)) return devOut({ status: "error", summary: `arquivo ignorável (mídia/binário): ${file_path} — operação pulada`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    const p = fpath(file_path);
    let text;
    let isNew = false;
    try {
      text = readFileSync(p, "utf8");
    } catch (e) {
      if (!create_if_missing) return devOut({ status: "error", summary: `arquivo não encontrado: ${e.message} (use create_if_missing:true p/ criar)`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
      if (!edits || !edits.length) return devOut({ status: "error", summary: "edits obrigatório mesmo p/ criar arquivo", data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
      text = "";
      isNew = true;
    }
    let nextText = text;
    const diffs = [];
    if (isNew) {
      const parts = [];
      for (const e of edits || []) {
        const newS = e.new_code ?? e.newString;
        if (newS === undefined) return devOut({ status: "error", summary: "cada edit precisa new_code/newString p/ criar arquivo", data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
        parts.push(String(newS));
        diffs.push(`create:${String(newS).slice(0, 40)}`);
      }
      nextText = parts.join("\n\n") + "\n";
    } else {
      for (const e of edits || []) {
        const oldS = e.oldString ?? e.target_symbol;
        const newS = e.new_code ?? e.newString;
        if (!oldS || newS === undefined) return devOut({ status: "error", summary: "cada edit precisa oldString/target_symbol + new_code/newString", data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
        if (e.target_symbol && !e.oldString) {
          const rx = new RegExp(`(export\\s+)?(async\\s+)?(function\\s+${escapeRe(e.target_symbol)}\\b[\\s\\S]*?\\n\\})|(const\\s+${escapeRe(e.target_symbol)}\\s*=\\s*[\\s\\S]*?;)`, "m");
          const m = nextText.match(rx);
          if (!m) return devOut({ status: "error", summary: `símbolo ${e.target_symbol} não encontrado em ${file_path}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
          nextText = nextText.replace(m[0], newS);
          diffs.push(`symbol:${e.target_symbol}`);
        } else {
          const cnt = nextText.split(oldS).length - 1;
          if (cnt === 0) return devOut({ status: "error", summary: `oldString não encontrado`, data: { file: file_path }, telemetry: { execution_time_ms: Date.now() - t0 } });
          if (cnt > 1) return devOut({ status: "error", summary: `oldString ambíguo (${cnt}x) — use mais contexto`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
          nextText = nextText.replace(oldS, newS);
          diffs.push(`exact:${oldS.slice(0, 40)}`);
        }
      }
    }
    const isJsx = /\.(jsx|tsx)$/.test(p) || /<[A-Z][\w]*\s*[^>]*>/.test(nextText.slice(0, 2000));
    if (!isJsx) {
      const tmp = join("/tmp", `devpatch-${Date.now()}.mjs`);
      try {
        await writeFile(tmp, nextText, "utf8");
        const chk = await exec("node", ["--check", tmp], { timeout: 10000 });
        if (chk.code !== 0) return devOut({ status: "error", summary: `AST validation falhou: ${chk.se.slice(0, 800)}`, data: { diffs }, telemetry: { execution_time_ms: Date.now() - t0 } });
      } finally {
        try {
          await unlink(tmp);
        } catch {}
      }
    }
    const preview = nextText.slice(0, 6000);
    if (dry_run) {
      return devOut({
        summary: `Dry-run OK em ${file_path} (${(edits || []).length} hunk(s)) — AST válido, nada escrito`,
        data: { file: file_path, hunks: diffs, preview, dry_run: true, created_would_be: isNew, bytes: Buffer.byteLength(nextText) },
        telemetry: { tokens_saved: 0, execution_time_ms: Date.now() - t0 },
        next: [{ tool: "n_execute_targeted_tests", reason: "Validar apenas testes afetados" }],
        refs: [`${file_path}:1`],
      });
    }
    try {
      if (isNew) await mkdir(dirname(p), { recursive: true });
      await writeFile(p, nextText, "utf8");
    } catch (e) {
      return devOut({ status: "error", summary: `write failed: ${e.message}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    }
    return devOut({
      summary: isNew ? `Arquivo criado em ${file_path} (${(edits || []).length} hunk(s)) — AST OK` : `Patch semântico aplicado em ${file_path} (${edits.length} hunk(s)) — AST OK`,
      data: { file: file_path, hunks: diffs, preview, bytes: Buffer.byteLength(nextText), created: isNew },
      telemetry: { tokens_saved: estTokens(text) - estTokens(nextText), execution_time_ms: Date.now() - t0 },
      next: [{ tool: "n_execute_targeted_tests", reason: "Validar apenas testes afetados" }],
      refs: [`${file_path}:1`],
    });
  },
});

reg("n_execute_targeted_tests", {
  description: "DevEngine: executa testes com detecção de runner (vitest/jest/mocha via devDependencies). Quando usar: validar mudança. diff_only usa script test:changed ou flag --changed do runner; module roda 1 arquivo (target_path); full roda a suíte. Erro claro se nenhum runner detectado. Retorna exit+stdout com contagem pass/fail por runner.",
  inputSchema: {
    type: "object",
    properties: {
      scope: { type: "string", enum: ["diff_only", "module", "full"], default: "diff_only", description: "Escopo: diff_only (só alterados), module (um arquivo via target_path), full (suíte completa)" },
      target_path: { type: "string", description: "Arquivo de teste para scope=module (ex: src/foo.test.js)" },
    },
    required: [],
  },
  run: async ({ scope, target_path }) => {
    const t0 = Date.now();
    const sc = scope || "diff_only";
    try {
      await stat(join(CWD, "package.json"));
    } catch {
      return devOut({ status: "error", summary: `sem package.json em ${CWD} — este projeto pode não usar npm; rode os testes do jeito do projeto`, data: { scope: sc }, telemetry: { execution_time_ms: Date.now() - t0 } });
    }
    const pkg = loadPkg();
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    let runner = null;
    if (deps.vitest) runner = "vitest";
    else if (deps.jest || deps["@jest/core"]) runner = "jest";
    else if (deps.mocha) runner = "mocha";
    if (!runner) {
      return devOut({ status: "error", summary: "nenhum runner detectado: adicione vitest, jest ou mocha em devDependencies (ex: npm i -D vitest)", data: { scope: sc, dica: "verifique package.json → devDependencies" }, telemetry: { execution_time_ms: Date.now() - t0 } });
    }
    const scripts = pkg.scripts || {};
    let cmd = "";
    if (sc === "diff_only") {
      if (scripts["test:changed"]) cmd = "npm run test:changed 2>&1 | tail -n 150";
      else if (runner === "vitest") cmd = "npx vitest run --changed 2>&1 | tail -n 150";
      else if (runner === "jest") cmd = "npx jest --onlyChanged 2>&1 | tail -n 150";
      else return devOut({ status: "error", summary: "mocha não suporta diff_only sem script 'test:changed' — use scope=module/full com target_path", data: { scope: sc, runner }, telemetry: { execution_time_ms: Date.now() - t0 } });
    } else if (sc === "module") {
      if (!target_path) return devOut({ status: "error", summary: "target_path obrigatório para scope=module (ex: src/foo.test.js)", data: { scope: sc, runner }, telemetry: { execution_time_ms: Date.now() - t0 } });
      if (/[;&|$`!\\]/.test(target_path)) return devOut({ status: "error", summary: "target_path com caracteres inválidos (; & | $ ` ! \\)", data: { scope: sc, runner }, telemetry: { execution_time_ms: Date.now() - t0 } });
      if (runner === "vitest") cmd = `npx vitest run ${target_path} 2>&1 | tail -n 150`;
      else if (runner === "jest") cmd = `npx jest ${target_path} 2>&1 | tail -n 150`;
      else cmd = `npx mocha ${target_path} 2>&1 | tail -n 150`;
    } else {
      if (runner === "vitest") cmd = "npx vitest run 2>&1 | tail -n 150";
      else if (runner === "jest") cmd = "npx jest 2>&1 | tail -n 150";
      else cmd = "npx mocha 2>&1 | tail -n 150";
    }
    const r = await exec("bash", ["-lc", cmd], { timeout: 120000 });
    let passed = 0;
    let failed = 0;
    const so = r.so || "";
    if (runner === "vitest") {
      const mp = so.match(/Tests\s+(\d+)\s+passed/i);
      const mf = so.match(/Tests\s+(\d+)\s+failed/i);
      passed = mp ? Number(mp[1]) : (so.match(/✓|passed/gi) || []).length;
      failed = mf ? Number(mf[1]) : (so.match(/×|failed|FAIL/gi) || []).length;
    } else if (runner === "jest") {
      const mp = so.match(/Tests:\s*(\d+)\s+passed/i);
      const mf = so.match(/(\d+)\s+failed/i);
      passed = mp ? Number(mp[1]) : (so.match(/✓|passed/gi) || []).length;
      failed = mf ? Number(mf[1]) : (so.match(/✕|failed|FAIL/gi) || []).length;
    } else {
      const mp = so.match(/(\d+)\s+passing/i);
      const mf = so.match(/(\d+)\s+failing/i);
      passed = mp ? Number(mp[1]) : (so.match(/passing|✓/gi) || []).length;
      failed = mf ? Number(mf[1]) : (so.match(/failing|✗|failed/gi) || []).length;
    }
    const summary = r.code === 0 ? `Testes OK [${runner}] (${passed || "?"} pass)` : `Testes falharam [${runner}] (exit ${r.code}, ${failed} fail)`;
    return devOut({
      status: r.code === 0 ? "success" : "error",
      summary,
      data: { scope: sc, runner, comando: cmd, exit: r.code, passed, failed, stdout: trimOut(r.so, 6000), stderr: trimOut(r.se, 2000) },
      telemetry: { tokens_saved: sc === "diff_only" ? 3500 : 0, execution_time_ms: Date.now() - t0 },
      next: r.code !== 0 ? [{ tool: "n_investigate_issue", reason: "Investigar falha estruturada" }] : [{ tool: "n_orchestrate_task", reason: "Checkpoint DAG" }],
      refs: target_path ? [target_path] : ["vitest.config.js:1"],
    });
  },
});

reg("n_manage_background_process", {
  description: "DevEngine: start/stop/restart/status/read_logs de servidores sem bloquear. Quando usar: dev server, build watch, worker. Ex: {action:\"start\", command:\"npm run dev\", env:{PORT:\"3001\"}}. restart = stop+start com o mesmo command. Limite: stdin é 'ignore' por design — a ação send NÃO escreve stdin (retorna erro explicativo); use env no start/restart.",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["start", "stop", "restart", "status", "read_logs", "send"], description: "Ação: start (novo), stop, restart (mesmo command), status, read_logs, send (indisponível — só documenta limite do stdin)" },
      command: { type: "string", description: "Comando shell para start (ex: npm run dev). No restart é reutilizado o command original." },
      process_id: { type: "string", description: "ID do processo (obrigatório para stop/restart/read_logs/send)" },
      env: { type: "object", description: "Variáveis de ambiente extras para start/restart (merge com process.env, ex: {PORT:\"3001\"})" },
    },
    required: ["action"],
  },
  run: async ({ action, command, process_id, env }) => {
    const t0 = Date.now();
    const startOne = (cmd, extraEnv) => {
      const id = `bg${Date.now().toString(36)}`;
      const mergedEnv = { ...process.env, ...(extraEnv || {}) };
      const child = spawn("bash", ["-lc", cmd], { cwd: CWD, stdio: ["ignore", "pipe", "pipe"], detached: true, env: mergedEnv });
      let logs = "";
      const appendLog = (d) => {
        logs += d;
        if (logs.length > 200000) logs = logs.slice(-200000);
      };
      child.stdout.on("data", appendLog);
      child.stderr.on("data", appendLog);
      bgProcs.set(id, { child, command: cmd, env: { ...(extraEnv || {}) }, logs: () => logs, startedAt: new Date().toISOString() });
      child.unref();
      return { id, child };
    };
    if (action === "start") {
      if (!command) return devOut({ status: "error", summary: "command obrigatório para start (ex: npm run dev)", data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
      if (env !== undefined && (typeof env !== "object" || env === null || Array.isArray(env))) return devOut({ status: "error", summary: "env deve ser objeto string→string (ex: {PORT:\"3001\"})", data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
      const { id, child } = startOne(command, env);
      return devOut({ summary: `Processo ${id} iniciado: ${command} (PID ${child.pid})`, data: { process_id: id, pid: child.pid, command, env: env || {} }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "n_inspect_ui_state", reason: "Validar UI em runtime" }], refs: [] });
    }
    if (action === "status") {
      const all = [...bgProcs.entries()].map(([id, v]) => ({ id, pid: v.child.pid, killed: v.child.killed, exitCode: v.child.exitCode, command: v.command, startedAt: v.startedAt }));
      return devOut({ summary: `${all.length} processo(s) em background`, data: { processes: all }, telemetry: { execution_time_ms: Date.now() - t0 } });
    }
    if (action === "send") {
      return devOut({ status: "error", summary: `send indisponível: stdin é 'ignore' por design (spawn stdio ["ignore","pipe","pipe"]) para evitar bloqueio — escrita em stdin NÃO implementada; use restart/start com env para reconfigurar`, data: { process_id: process_id || null }, telemetry: { execution_time_ms: Date.now() - t0 } });
    }
    const id = process_id;
    const entry = bgProcs.get(id);
    if (!entry) return devOut({ status: "error", summary: `processo ${id} não encontrado — veja n_manage_background_process({action:\"status\"})`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    if (action === "stop") {
      try {
        entry.child.kill("SIGTERM");
      } catch {}
      bgProcs.delete(id);
      return devOut({ summary: `Processo ${id} encerrado`, data: { process_id: id }, telemetry: { execution_time_ms: Date.now() - t0 } });
    }
    if (action === "restart") {
      const cmd = entry.command;
      const mergedEnv = { ...(entry.env || {}), ...(env || {}) };
      try {
        entry.child.kill("SIGTERM");
      } catch {}
      bgProcs.delete(id);
      const child = spawn("bash", ["-lc", cmd], { cwd: CWD, stdio: ["ignore", "pipe", "pipe"], detached: true, env: { ...process.env, ...mergedEnv } });
      let logs = "";
      const appendLog = (d) => {
        logs += d;
        if (logs.length > 200000) logs = logs.slice(-200000);
      };
      child.stdout.on("data", appendLog);
      child.stderr.on("data", appendLog);
      bgProcs.set(id, { child, command: cmd, env: mergedEnv, logs: () => logs, startedAt: new Date().toISOString() });
      child.unref();
      return devOut({ summary: `Processo ${id} reiniciado: ${cmd} (PID ${child.pid})`, data: { process_id: id, pid: child.pid, command: cmd, env: mergedEnv }, telemetry: { execution_time_ms: Date.now() - t0 } });
    }
    if (action === "read_logs") {
      const l = entry.logs().slice(-4000);
      return devOut({ summary: `Logs ${id} (${l.length} chars)`, data: { process_id: id, logs: l }, telemetry: { execution_time_ms: Date.now() - t0 } });
    }
    return devOut({ status: "error", summary: "action inválida (use: start|stop|restart|status|read_logs)", data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
  },
});

reg("n_inspect_ui_state", {
  description: "DevEngine: checagem HTTP da UI (status + conteúdo). Quando usar: validar se front está no ar e se contém texto esperado antes de teste manual/E2E. expect verifica substring no body (curl -s + grep, FOUND/MISSING); retries (0-3) repete com intervalo de 2s.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", default: "http://localhost:5173", description: "URL da UI (ex: http://localhost:5173)" },
      viewport: { type: "string", enum: ["desktop", "mobile"], default: "desktop", description: "Viewport apenas informativo (desktop|mobile)" },
      actions: { type: "array", items: { type: "object" }, description: "Reservado (ignorado nesta versão curl-only)" },
      expect: { type: "string", description: "Substring que deve existir no body (verificado com curl -s + grep -F; retorna FOUND/MISSING)" },
      retries: { type: "number", default: 0, description: "Tentativas extras após falha (0-3, intervalo 2s entre elas)" },
    },
    required: [],
  },
  run: async ({ url, viewport, expect, retries }) => {
    const t0 = Date.now();
    const u = url || "http://localhost:5173";
    const vp = viewport || "desktop";
    const want = typeof expect === "string" && expect.length ? expect : null;
    let rt = Number(retries ?? 0);
    if (!Number.isFinite(rt)) rt = 0;
    rt = Math.max(0, Math.min(3, Math.floor(rt)));
    const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
    let code = "";
    let found = null;
    let attempts = 0;
    for (let i = 0; i <= rt; i++) {
      attempts = i + 1;
      const r = await exec("bash", ["-lc", `curl -s -o /dev/null -w "%{http_code}" ${shq(u)} 2>&1 | head -c 20`], { timeout: 10000 });
      code = (r.so || "").trim();
      if (want) {
        const g = await exec("bash", ["-lc", `curl -s ${shq(u)} 2>&1 | grep -F -q -- ${shq(want)}`], { timeout: 10000 });
        found = g.code === 0 ? "FOUND" : "MISSING";
      }
      const reachable = code === "200" || code === "301" || code === "302";
      const ok = reachable && (!want || found === "FOUND");
      if (ok || i === rt) break;
      await new Promise((res) => setTimeout(res, 2000));
    }
    const reachable = code === "200" || code === "301" || code === "302";
    const expectOk = !want || found === "FOUND";
    const ok = reachable && expectOk;
    const expectTxt = want ? ` expect:${found} (${want.slice(0, 80)})` : "";
    return devOut({
      summary: ok ? `UI ${u} (${vp}) alcançável (HTTP ${code})${expectTxt} em ${attempts} tentativa(s)` : `UI ${u} offline (curl ${code || "?"}${want ? ` ${found}` : ""}) após ${attempts} tentativa(s) — inicie com n_manage_background_process`,
      data: { url: u, viewport: vp, reachable, http_code: code, expect: want, expect_result: want ? found : "SKIP", retries: rt, attempts, hint: "n_manage_background_process({action:'start', command:'npm run dev'})" },
      telemetry: { execution_time_ms: Date.now() - t0 },
      next: ok ? [{ tool: "n_investigate_issue", reason: "Se overflow/bug visual detectado, investigar símbolo" }] : [{ tool: "n_manage_background_process", reason: "Subir dev server" }],
      refs: ["src/App.jsx:1", "playwright.config.ts:1"],
    });
  },
});

// Usa o Chrome do sistema (/usr/bin/google-chrome) via DevTools Protocol.
// Zero npm deps: spawn + fetch + WebSocket nativo (Node 22+). Browser persistente
// em /tmp/opencode-chrome-profile, porta 19322. Cobre: SPA com JS, snapshot de
// elementos, click/fill/press/scroll, screenshot PNG (com imagem no retorno) e PDF.

reg("n_orchestrate_task", {
  description: "DevEngine: DAG de tarefas com checkpoint/resume/rollback (git stash). Quando usar: multi-step com rollback garantido. Ex: {action:\"init\", plan:{steps:[...]}}. rollback lista git stash list ANTES e exige confirm:true para executar.",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["init", "checkpoint", "resume", "rollback"], default: "init", description: "Ação: init, checkpoint (git stash push), resume, rollback (prévia + confirm)" },
      task_id: { type: "string", description: "ID do DAG (obrigatório para checkpoint/resume)" },
      plan: { type: "object", description: "Plano do DAG para init (ex: {title, steps:[...]})" },
      confirm: { type: "boolean", description: "Obrigatório true para EXECUTAR o rollback; sem ele só retorna a prévia do que será restaurado" },
    },
    required: [],
  },
  run: async ({ action, task_id, plan, confirm }) => {
    const t0 = Date.now();
    const act = action || "init";
    if (act === "init") {
      const id = taskId();
      const entry = { id, plan: plan || {}, status: "running", startedAt: new Date().toISOString(), checkpoints: [] };
      tasks.set(id, { ...entry, description: plan?.title || "DevEngine DAG", agent: "devengine" });
      await persistTask({ id, agent: "devengine", description: plan?.title || "DAG", status: "running", startedAt: entry.startedAt, finishedAt: null, exitCode: null, tools: [], error: null, result: JSON.stringify(plan || {}) });
      return devOut({ summary: `DAG ${id} iniciado`, data: { task_id: id, plan }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "n_get_architecture_summary", reason: "Mapear antes de delegar" }], refs: [] });
    }
    if (act === "checkpoint") {
      const t = resolveTask(task_id);
      if (!t) return devOut({ status: "error", summary: `task ${task_id} não encontrada`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
      const snap = await exec("bash", ["-lc", "git stash push -m \"devengine-checkpoint\" --keep-index 2>&1 | tail -5"], { timeout: 15000 });
      return devOut({ summary: `Checkpoint ${task_id} salvo (git stash)`, data: { task_id, stash: trimOut(snap.so, 600) }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "n_analyze_change_impact", reason: "Validar antes do próximo hunk" }], refs: [] });
    }
    if (act === "rollback") {
      const lst = await exec("bash", ["-lc", "git stash list 2>&1 | head -n 20"], { timeout: 15000 });
      const preview = trimOut(lst.so, 2000).trim();
      if (!preview) return devOut({ status: "error", summary: "nada a restaurar: git stash list vazio — nenhum checkpoint salvo", data: { preview: "" }, telemetry: { execution_time_ms: Date.now() - t0 } });
      if (confirm !== true) {
        return devOut({ status: "error", summary: `Rollback NÃO executado: passe confirm:true para restaurar o topo do stash. Prévia abaixo`, data: { preview, stash_list: preview, dica: 'n_orchestrate_task({action:"rollback", confirm:true})' }, telemetry: { execution_time_ms: Date.now() - t0 } });
      }
      const rb = await exec("bash", ["-lc", "git stash pop 2>&1 | tail -10"], { timeout: 15000 });
      return devOut({ summary: `Rollback executado`, data: { preview, result: trimOut(rb.so, 800) }, telemetry: { execution_time_ms: Date.now() - t0 } });
    }
    if (act === "resume") {
      const t = resolveTask(task_id);
      if (!t) return devOut({ status: "error", summary: `task ${task_id} não encontrada`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
      return devOut({ summary: `DAG ${task_id} retomado`, data: { task_id, task: t }, telemetry: { execution_time_ms: Date.now() - t0 } });
    }
    return devOut({ status: "error", summary: "action inválida (use: init|checkpoint|resume|rollback)", data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
  },
});

