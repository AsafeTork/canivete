// canivete core/rpc — dispatch JSON-RPC compartilhado (zero deps).
// Antes: server.mjs (stdio) e remote.mjs (HTTP) duplicavam
// initialize/ping/tools-list/tools-call + annotations.
// O catálogo MCP entra no contexto da IA. Envie descrições curtas por padrão;
// cv_help {query,detail:true} fornece a instrução integral quando necessária.
import { randomUUID } from "node:crypto";
const DEFAULT_AGENT_SESSION_ID = `stdio:${randomUUID()}`;
export const MCP_AGENT_SESSION_ID = DEFAULT_AGENT_SESSION_ID;
const READ_ONLY_RE = /read|list|glob|grep|search|fetch|status|tabs|snapshot|lookup|inspect|help|context|_todo$/i;
const DESTRUCTIVE_RE = /write|edit|patch|bash|delete|send|fill|type|lifecycle|connect|login|task_start|task_mailbox|alerts|report|screencast|exec|todowrite|orchestrate|resolve|whatsapp|skill/i;
const DESTRUCTIVE_ACT_RE = /(^|_)act(_|$)/i;

export function annotationsFor(name = "") {
  // cv_owner_act is a mixed browser-control surface. MCP annotations apply to
  // the whole tool, so marking it destructive would demand approval even for
  // harmless navigation/new-tab actions. Its runner still applies Canivete's
  // action-level high-risk confirmation before destructive operations.
  if (name === "cv_owner_act")
    return { readOnlyHint: false, destructiveHint: false, idempotentHint: false };
  if (DESTRUCTIVE_RE.test(name) || DESTRUCTIVE_ACT_RE.test(name))
    return { readOnlyHint: false, destructiveHint: true, idempotentHint: false };
  if (READ_ONLY_RE.test(name)) return { readOnlyHint: true, destructiveHint: false, idempotentHint: true };
  return { readOnlyHint: false, destructiveHint: false, idempotentHint: true };
}

function brief(s, limit) {
  const clean = String(s ?? "").replace(/\s+/g, " ").trim();
  if (clean.length <= limit) return clean;
  const sentence = clean.match(/^.*?[.!?](?=\s|$)/)?.[0];
  if (sentence && sentence.length <= limit) return sentence;
  return clean.slice(0, limit - 1).trimEnd() + "…";
}

function slimSchema(value) {
  if (Array.isArray(value)) return value.map(slimSchema);
  if (!value || typeof value !== "object") return value;
  // Per-field prose is available through cv_help on demand. Keeping the JSON
  // constraints while omitting it avoids paying that token cost on every turn.
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== "description")
    .map(([key, item]) => [key, slimSchema(item)]));
}

export function buildToolsList(TOOLS, { sorted = true, annotations = false, descLen = 220 } = {}) {
  const vals = [...TOOLS.values()].filter((tool) => tool.public !== false);
  if (sorted) vals.sort((a, b) => a.name.localeCompare(b.name));
  return vals.map((t) => ({
    name: t.name,
    description: brief(t.description, descLen),
    inputSchema: slimSchema(t.inputSchema),
    ...(annotations ? { annotations: annotationsFor(t.name) } : {}),
  }));
}

// Dispatch único (stdio). Retorna o objeto result ou {error} p/ unknown method.
export async function dispatchStdio(msg, TOOLS, sendToHost, agentSessionId = DEFAULT_AGENT_SESSION_ID) {
  if (msg.method?.startsWith("notifications/")) return null;
  if (msg.id === undefined || msg.id === null) return null;
  if (msg.method === "initialize") {
    return { id: msg.id, result: { protocolVersion: msg.params?.protocolVersion || "2024-11-05", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "canivete", version: "1.0.0" } } };
  }
  if (msg.method === "ping") return { id: msg.id, result: {} };
  if (msg.method === "tools/list") {
    return { id: msg.id, result: { tools: buildToolsList(TOOLS, { sorted: true, annotations: true }) } };
  }
  if (msg.method === "tools/call") {
    const { name, arguments: args } = msg.params || {};
    const tool = TOOLS.get(name);
    if (!tool) return { id: msg.id, result: { content: [{ type: "text", text: `unknown tool: ${name} — dica: cv_help` }], isError: true } };
    try {
      return { id: msg.id, result: await tool.run(args || {}, { agentSessionId }) };
    } catch (e) {
      return { id: msg.id, result: { content: [{ type: "text", text: `tool error: ${e?.message || e}` }], isError: true } };
    }
  }
  return { id: msg.id, error: { code: -32601, message: `unknown method: ${msg.method}` } };
}

// Item do batch HTTP (remote.mjs). Mesmo comportamento, formato remoto.
export async function dispatchHttpItem(m, TOOLS, agentSessionId = DEFAULT_AGENT_SESSION_ID) {
  if (!m || m.method?.startsWith("notifications/") || m.id === undefined || m.id === null) return null;
  if (m.method === "initialize") {
    return { jsonrpc: "2.0", id: m.id, result: { protocolVersion: m.params?.protocolVersion || "2024-11-05", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "canivete", version: "1.0.0" } } };
  }
  if (m.method === "ping") return { jsonrpc: "2.0", id: m.id, result: {} };
  if (m.method === "tools/list") {
    return { jsonrpc: "2.0", id: m.id, result: { tools: buildToolsList(TOOLS, { sorted: false, annotations: true }) } };
  }
  if (m.method === "tools/call") {
    const { name: tn, arguments: args } = m.params || {};
    const tool = TOOLS.get(tn);
    if (!tool) return { jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: `unknown tool: ${tn} — dica: cv_help` }], isError: true } };
    try {
      return { jsonrpc: "2.0", id: m.id, result: await tool.run(args || {}, { agentSessionId }) };
    } catch (e) {
      return { jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: `tool error: ${e?.message || e}` }], isError: true } };
    }
  }
  return { jsonrpc: "2.0", id: m.id, error: { code: -32601, message: `unknown method: ${m.method}` } };
}
