#!/usr/bin/env node
// Gera docs/TOOLS.md a partir do catálogo público real (inclui tools consolidadas).
// O servidor imprime o catálogo e sai antes de entrar no loop MCP.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_FILE = join(ROOT, "docs", "TOOLS.md");
const result = spawnSync(process.execPath, ["src/server.mjs", "--catalog"], {
  cwd: ROOT,
  encoding: "utf8",
  timeout: 15000,
  env: { ...process.env, CANIVETE_TASK_ENABLE: "0" },
});
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`server --catalog saiu com ${result.status}: ${(result.stderr || "").slice(0, 1000)}`);
let tools;
try { tools = JSON.parse(result.stdout); } catch { throw new Error(`catálogo inválido: ${(result.stdout || "").slice(0, 500)}`); }
if (!Array.isArray(tools)) throw new Error("server --catalog não retornou uma lista de tools");

function group(name) {
  if (/^cv_file_|^cv_bash$/.test(name)) return "Arquivos e comandos";
  if (/^cv_web|^cv_lookup$/.test(name)) return "Web e consultas";
  if (/^cv_browser_/.test(name)) return "Browser headless";
  if (/^cv_owner_/.test(name)) return "Chrome logado do dono";
  if (/^cv_android_/.test(name)) return "Android";
  if (/^cv_codespace_/.test(name)) return "Codespaces";
  if (/^cv_code_|^cv_manage_background_process$|^cv_orchestrate_task$/.test(name)) return "Desenvolvimento";
  if (/^cv_task_|^cv_todo/.test(name)) return "Orquestração";
  if (/^cv_elemreports_/.test(name)) return "Reports de elemento";
  if (name === "cv_audio_analyze") return "Mídia local";
  if (name === "cv_whatsapp") return "WhatsApp";
  return "Meta";
}

function params(tool) {
  const schema = tool.inputSchema || {};
  if (Array.isArray(schema.oneOf)) return schema.oneOf.map((branch) => {
    const props = branch.properties || {};
    const [modeKey, modeSchema] = Object.entries(props).find(([, p]) => p && typeof p.const === "string") || [];
    const mode = modeSchema?.const || "modo";
    const fields = Object.keys(props).filter((key) => key !== modeKey);
    return `${mode}: ${fields.join(", ")}`;
  }).join("; ");
  return Object.keys(schema.properties || {}).join(", ") || "sem parâmetros";
}

const date = new Date().toISOString().slice(0, 10);
const taskExtras = 4;
const lines = [
  "# TOOLS — catálogo MCP público do Canivete",
  "",
  "> GERADO AUTOMATICAMENTE por `node scripts/gen-catalog.mjs` — NÃO EDITE MANUALMENTE.",
  "> Fonte: `tools/list` construído pelo registro real do servidor (`node src/server.mjs --catalog`). Executores antigos podem continuar como aliases ocultos para compatibilidade.",
  `> Total: ${tools.length} tools ativas; ${tools.length + taskExtras} com a família opcional de tarefas habilitada. Gerado em ${date}.`,
  "",
  "| nome | grupo | descrição | modos/parâmetros |",
  "|---|---|---|---|",
  ...tools.map((tool) => `| \`${tool.name}\` | ${group(tool.name)} | ${String(tool.description || "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim()} | ${params(tool).replace(/\|/g, "\\|")} |`),
  "",
  "Os modos usam enums explícitos e campos específicos por operação. Para a descrição completa, use `cv_help {query, detail:true}`.",
  "",
  "_Regenerar: `node scripts/gen-catalog.mjs` · Validar: `node --check scripts/gen-catalog.mjs`_",
  "",
];
writeFileSync(OUT_FILE, lines.join("\n"), "utf8");
console.log(`catalog: ${tools.length} tools públicas -> docs/TOOLS.md`);
