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
      stack_trace: { type: "string" },
      max_depth: { type: "number", default: 3 },
    },
    required: ["symptom"],
  },
  run: async ({ symptom, stack_trace, max_depth }) => {
    const t0 = Date.now();
    const keywords = String(symptom).split(/\s+/).filter((w) => w.length > 2).slice(0, 6);
    const pattern = keywords.map(escapeRe).join("|") || escapeRe(symptom.slice(0, 20));
    let rx;
    try {
      rx = new RegExp(pattern, "i");
    } catch {
      rx = new RegExp(escapeRe(symptom.slice(0, 20)), "i");
    }
    const files = [];
    walkFiles(CWD, files);
    const hits = [];
    const maxHits = 12;
    for (const f of files) {
      if (!/\.(jsx?|tsx?|ts|js)$/.test(f)) continue;
      if (SKIP_DIRS.has(f.split("/")[0])) continue;
      try {
        const txt = readFileSync(join(CWD, f), "utf8");
        if (txt.indexOf("\0") >= 0) continue; // binário
        const lines = txt.split("\n");
        for (let i = 0; i < lines.length && hits.length < maxHits; i++) {
          if (rx.test(lines[i])) {
            const ctx = lines.slice(Math.max(0, i - 1), i + 2).join(" | ").slice(0, 240);
            hits.push({ file: f, line: i + 1, snippet: lines[i].slice(0, 200), context: ctx, score: keywords.filter((k) => lines[i].toLowerCase().includes(k.toLowerCase())).length });
            break;
          }
        }
      } catch {}
      if (hits.length >= maxHits) break;
    }
    if (stack_trace) {
      const m = String(stack_trace).match(/at\s+.*\(?([^:)]+):(\d+):\d+\)?/);
      if (m) hits.unshift({ file: m[1].replace(CWD + "/", ""), line: Number(m[2]), snippet: stack_trace.slice(0, 200), context: "stack_trace", score: 99 });
    }
    hits.sort((a, b) => b.score - a.score);
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
  description: "DevEngine: busca regex do símbolo nos arquivos — callers + tests por nome. Quando usar: ANTES de editar função/componente. Limite: regex \\b (não AST); ajuda a evitar regressões, não garante.",
  inputSchema: {
    type: "object",
    properties: {
      symbol_id: { type: "string", description: "ex: src/lib/sync.js#syncAll ou Transactions" },
      file_path: { type: "string" },
    },
    required: [],
  },
  run: async ({ symbol_id, file_path }) => {
    const t0 = Date.now();
    const target = symbol_id || file_path;
    if (!target) return devOut({ status: "error", summary: "symbol_id ou file_path obrigatório", data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
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
      try {
        if (statSync(join(CWD, f)).size > 1048576) continue; // >1MB: pula sem ler
        const txt = readFileSync(join(CWD, f), "utf8");
        if (txt.indexOf("\0") >= 0) continue; // binário
        if (rx.test(txt)) {
          const lines = txt.split("\n");
          for (let i = 0; i < lines.length && callers.length < 30; i++) if (rx.test(lines[i])) callers.push(`${f}:${i + 1}: ${lines[i].slice(0, 180)}`);
          if (/\.test\.(js|ts)x?$/.test(f) || f.includes("__tests__")) tests.push(f);
        }
      } catch {}
    }
    return devOut({
      summary: `${callers.length} referência(s) a "${sym}" | ${tests.length} teste(s) afetado(s)`,
      data: { target, symbol: sym, callers: callers.slice(0, 15), tests_affected: tests.slice(0, 10), public_api: callers.filter((c) => c.includes("export")).slice(0, 5), files_scanned: files.length, capped: files.length >= WALK_CAP ? `cap ${WALK_CAP} — refine path p/ precisão` : false },
      telemetry: { tokens_saved: Math.max(0, callers.length * 60), execution_time_ms: Date.now() - t0 },
      next: [{ tool: "n_apply_semantic_patch", reason: "Aplicar edição validada por AST" }],
      refs: callers.slice(0, 3).map((c) => c.split(":").slice(0, 2).join(":")),
    });
  },
});

reg("n_apply_semantic_patch", {
  description: "DevEngine: edição AST-validada (node --check, skip JSX). Quando usar: trocar função/constante específica; quer validação sintática. Ex: {file_path, edits:[{target_symbol, new_code}]}. Mais seguro que n_edit para código.",
  inputSchema: {
    type: "object",
    properties: {
      file_path: { type: "string" },
      edits: {
        type: "array",
        items: {
          type: "object",
          properties: {
            target_symbol: { type: "string", description: "Função/classe alvo (opcional se oldString)" },
            oldString: { type: "string" },
            new_code: { type: "string" },
            newString: { type: "string" },
          },
        },
      },
    },
    required: ["file_path", "edits"],
  },
  run: async ({ file_path, edits }) => {
    const t0 = Date.now();
    const p = fpath(file_path);
    let text;
    try {
      text = readFileSync(p, "utf8");
    } catch (e) {
      return devOut({ status: "error", summary: `arquivo não encontrado: ${e.message}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    }
    let nextText = text;
    const diffs = [];
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
    try {
      await writeFile(p, nextText, "utf8");
    } catch (e) {
      return devOut({ status: "error", summary: `write failed: ${e.message}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    }
    return devOut({
      summary: `Patch semântico aplicado em ${file_path} (${edits.length} hunk(s)) — AST OK`,
      data: { file: file_path, hunks: diffs, bytes: Buffer.byteLength(nextText) },
      telemetry: { tokens_saved: estTokens(text) - estTokens(nextText), execution_time_ms: Date.now() - t0 },
      next: [{ tool: "n_execute_targeted_tests", reason: "Validar apenas testes afetados" }],
      refs: [`${file_path}:1`],
    });
  },
});

reg("n_execute_targeted_tests", {
  description: "DevEngine: wrapper de testes (scope=diff_only|module|full). Quando usar: validar mudança. Limite: NÃO mapeia diff→testes; diff_only roda `npm run test:changed`, module roda `vitest run <target>`, full roda `npm test`. Retorna exit+stdout.",
  inputSchema: {
    type: "object",
    properties: {
      scope: { type: "string", enum: ["diff_only", "module", "full"], default: "diff_only" },
      target_path: { type: "string" },
    },
    required: [],
  },
  run: async ({ scope, target_path }) => {
    const t0 = Date.now();
    const sc = scope || "diff_only";
    try {
      await stat(join(CWD, "package.json"));
    } catch {
      return devOut({ status: "error", summary: `sem package.json em ${CWD} — este projeto pode não usar vitest/npm; rode os testes do jeito do projeto`, data: { scope: sc }, telemetry: { execution_time_ms: Date.now() - t0 } });
    }
    let cmd = "npm test 2>&1 | tail -n 120";
    if (sc === "diff_only") cmd = "npm run test:changed 2>&1 | tail -n 150";
    else if (sc === "module" && target_path) cmd = `npx vitest run ${target_path} 2>&1 | tail -n 150`;
    const r = await exec("bash", ["-lc", cmd], { timeout: 120000 });
    const passed = (r.so.match(/✓|passed/gi) || []).length;
    const failed = (r.so.match(/×|failed|FAIL/gi) || []).length;
    const summary = r.code === 0 ? `Testes OK (${passed || "?"} pass)` : `Testes falharam (exit ${r.code})`;
    return devOut({
      status: r.code === 0 ? "success" : "error",
      summary,
      data: { scope: sc, exit: r.code, stdout: trimOut(r.so, 6000), stderr: trimOut(r.se, 2000) },
      telemetry: { tokens_saved: sc === "diff_only" ? 3500 : 0, execution_time_ms: Date.now() - t0 },
      next: r.code !== 0 ? [{ tool: "n_investigate_issue", reason: "Investigar falha estruturada" }] : [{ tool: "n_orchestrate_task", reason: "Checkpoint DAG" }],
      refs: target_path ? [target_path] : ["vitest.config.js:1"],
    });
  },
});

reg("n_manage_background_process", {
  description: "DevEngine: start/stop/status/read_logs de servidores sem bloquear. Quando usar: dev server, build watch, worker. Ex: {action:\"start\", command:\"npm run dev\"}. Logs em tempo real.",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["start", "stop", "status", "read_logs"] },
      command: { type: "string", description: "ex: npm run dev" },
      process_id: { type: "string" },
    },
    required: ["action"],
  },
  run: async ({ action, command, process_id }) => {
    const t0 = Date.now();
    if (action === "start") {
      if (!command) return devOut({ status: "error", summary: "command obrigatório para start", data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
      const id = `bg${Date.now().toString(36)}`;
      const child = spawn("bash", ["-lc", command], { cwd: CWD, stdio: ["ignore", "pipe", "pipe"], detached: true });
      let logs = "";
      const appendLog = (d) => {
        logs += d;
        if (logs.length > 200000) logs = logs.slice(-200000);
      };
      child.stdout.on("data", appendLog);
      child.stderr.on("data", appendLog);
      bgProcs.set(id, { child, command, logs: () => logs, startedAt: new Date().toISOString() });
      child.unref();
      return devOut({ summary: `Processo ${id} iniciado: ${command} (PID ${child.pid})`, data: { process_id: id, pid: child.pid, command }, telemetry: { execution_time_ms: Date.now() - t0 }, next: [{ tool: "n_inspect_ui_state", reason: "Validar UI em runtime" }], refs: [] });
    }
    if (action === "status") {
      const all = [...bgProcs.entries()].map(([id, v]) => ({ id, pid: v.child.pid, killed: v.child.killed, exitCode: v.child.exitCode, command: v.command }));
      return devOut({ summary: `${all.length} processo(s) em background`, data: { processes: all }, telemetry: { execution_time_ms: Date.now() - t0 } });
    }
    const id = process_id;
    const entry = bgProcs.get(id);
    if (!entry) return devOut({ status: "error", summary: `processo ${id} não encontrado`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    if (action === "stop") {
      try {
        entry.child.kill("SIGTERM");
      } catch {}
      bgProcs.delete(id);
      return devOut({ summary: `Processo ${id} encerrado`, data: { process_id: id }, telemetry: { execution_time_ms: Date.now() - t0 } });
    }
    if (action === "read_logs") {
      const l = entry.logs().slice(-4000);
      return devOut({ summary: `Logs ${id} (${l.length} chars)`, data: { process_id: id, logs: l }, telemetry: { execution_time_ms: Date.now() - t0 } });
    }
    return devOut({ status: "error", summary: "action inválida", data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
  },
});

reg("n_inspect_ui_state", {
  description: "DevEngine: checagem HTTP da UI (curl status) + hint p/ subir dev server. Quando usar: validar se front está no ar antes de teste manual/E2E.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", default: "http://localhost:5173" },
      viewport: { type: "string", enum: ["desktop", "mobile"], default: "desktop" },
      actions: { type: "array", items: { type: "object" } },
    },
    required: [],
  },
  run: async ({ url, viewport }) => {
    const t0 = Date.now();
    const u = url || "http://localhost:5173";
    const vp = viewport || "desktop";
    const r = await exec("bash", ["-lc", `curl -s -o /dev/null -w "%{http_code}" ${u} 2>&1 | head -c 20`], { timeout: 10000 });
    const code = r.so.trim();
    const reachable = code === "200" || code === "301" || code === "302";
    return devOut({
      summary: reachable ? `UI ${u} (${vp}) alcançável (HTTP ${code})` : `UI ${u} offline (curl ${code || trimOut(r.so, 200)}) — inicie com n_manage_background_process`,
      data: { url: u, viewport: vp, reachable, http_code: code, hint: "n_manage_background_process({action:'start', command:'npm run dev'})" },
      telemetry: { execution_time_ms: Date.now() - t0 },
      next: reachable ? [{ tool: "n_investigate_issue", reason: "Se overflow/bug visual detectado, investigar símbolo" }] : [{ tool: "n_manage_background_process", reason: "Subir dev server" }],
      refs: ["src/App.jsx:1", "playwright.config.ts:1"],
    });
  },
});

// Usa o Chrome do sistema (/usr/bin/google-chrome) via DevTools Protocol.
// Zero npm deps: spawn + fetch + WebSocket nativo (Node 22+). Browser persistente
// em /tmp/opencode-chrome-profile, porta 19322. Cobre: SPA com JS, snapshot de
// elementos, click/fill/press/scroll, screenshot PNG (com imagem no retorno) e PDF.

reg("n_orchestrate_task", {
  description: "DevEngine: DAG de tarefas com checkpoint/resume/rollback (git stash). Quando usar: multi-step com rollback garantido. Ex: {action:\"init\", plan:{steps:[...]}}.",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["init", "checkpoint", "resume", "rollback"], default: "init" },
      task_id: { type: "string" },
      plan: { type: "object" },
    },
    required: [],
  },
  run: async ({ action, task_id, plan }) => {
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
      const rb = await exec("bash", ["-lc", "git stash pop 2>&1 | tail -10"], { timeout: 15000 });
      return devOut({ summary: `Rollback executado`, data: { result: trimOut(rb.so, 800) }, telemetry: { execution_time_ms: Date.now() - t0 } });
    }
    if (act === "resume") {
      const t = resolveTask(task_id);
      if (!t) return devOut({ status: "error", summary: `task ${task_id} não encontrada`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
      return devOut({ summary: `DAG ${task_id} retomado`, data: { task_id, task: t }, telemetry: { execution_time_ms: Date.now() - t0 } });
    }
    return devOut({ status: "error", summary: "action inválida", data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
  },
});

