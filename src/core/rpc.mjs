// canivete core/rpc — dispatch JSON-RPC compartilhado (zero deps).
// Antes: server.mjs (stdio) e remote.mjs (HTTP) duplicavam
// initialize/ping/tools-list/tools-call + annotations.
// Diferenças intencionais preservadas via opções:
// - stdio: ordenado, com annotations, descrição completa.
// - http: ordem de registro, descrição fatiada em 120 chars, sem annotations.
const READ_ONLY_RE = /read|list|glob|grep|search|fetch|status|tabs|snapshot/i;
const DESTRUCTIVE_RE = /write|edit|patch|bash|delete|send|fill|type/i;
const DESTRUCTIVE_ACT_RE = /(^|_)act(_|$)/i;

export function annotationsFor(name = "") {
  if (DESTRUCTIVE_RE.test(name) || DESTRUCTIVE_ACT_RE.test(name))
    return { readOnlyHint: false, destructiveHint: true, idempotentHint: false };
  if (READ_ONLY_RE.test(name)) return { readOnlyHint: true, destructiveHint: false, idempotentHint: true };
  return { readOnlyHint: false, destructiveHint: false, idempotentHint: true };
}

export function buildToolsList(TOOLS, { sorted = true, annotations = false, descLen = 0 } = {}) {
  const vals = [...TOOLS.values()];
  if (sorted) vals.sort((a, b) => a.name.localeCompare(b.name));
  return vals.map((t) => ({
    name: t.name,
    description: descLen ? String(t.description).slice(0, descLen) : t.description,
    inputSchema: t.inputSchema,
    ...(annotations ? { annotations: annotationsFor(t.name) } : {}),
  }));
}

// Dispatch único (stdio). Retorna o objeto result ou {error} p/ unknown method.
export async function dispatchStdio(msg, TOOLS, sendToHost) {
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
    if (!tool) return { id: msg.id, result: { content: [{ type: "text", text: `unknown tool: ${name} — dica: n_find_tools/n_tools_info` }], isError: true } };
    try {
      return { id: msg.id, result: await tool.run(args || {}) };
    } catch (e) {
      return { id: msg.id, result: { content: [{ type: "text", text: `tool error: ${e?.message || e}` }], isError: true } };
    }
  }
  return { id: msg.id, error: { code: -32601, message: `unknown method: ${msg.method}` } };
}

// Item do batch HTTP (remote.mjs). Mesmo comportamento, formato remoto.
export async function dispatchHttpItem(m, TOOLS) {
  if (!m || m.method?.startsWith("notifications/") || m.id === undefined || m.id === null) return null;
  if (m.method === "initialize") {
    return { jsonrpc: "2.0", id: m.id, result: { protocolVersion: m.params?.protocolVersion || "2024-11-05", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "canivete", version: "1.0.0" } } };
  }
  if (m.method === "ping") return { jsonrpc: "2.0", id: m.id, result: {} };
  if (m.method === "tools/list") {
    return { jsonrpc: "2.0", id: m.id, result: { tools: buildToolsList(TOOLS, { sorted: false, annotations: false, descLen: 120 }) } };
  }
  if (m.method === "tools/call") {
    const { name: tn, arguments: args } = m.params || {};
    const tool = TOOLS.get(tn);
    if (!tool) return { jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: `unknown tool: ${tn} — dica: n_find_tools/n_tools_info` }], isError: true } };
    try {
      return { jsonrpc: "2.0", id: m.id, result: await tool.run(args || {}) };
    } catch (e) {
      return { jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: `tool error: ${e?.message || e}` }], isError: true } };
    }
  }
  return { jsonrpc: "2.0", id: m.id, error: { code: -32601, message: `unknown method: ${m.method}` } };
}
