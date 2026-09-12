// canivete — WhatsApp Web dedicado (seletores data-testid estáveis).
// Ações de leitura/navegação: low. Envio: medium e SÓ com texto explícito do dono
// (conteúdo da mensagem NÃO passa na trava — quem ordena o envio é o dono).
import { reg, devOut, trimOut } from "./ctx.mjs";
import { ubSend, ubConnected, UB_OFF } from "./ubridge.mjs";

reg("n_whatsapp", {
  description: "WhatsApp Web DEDICADO no Chrome logado (data-testid estáveis, sem classes minificadas). state|chats|open|read|send. Envio só com texto explícito do dono. Ex: {action:\"open\", name:\"Projeto II\"} {action:\"send\", text:\"olá\"}.",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["state", "chats", "open", "read", "send"] },
      tabId: { type: "number" }, tab: { type: "string", description: "trecho título/URL (default: acha web.whatsapp.com)" },
      name: { type: "string", description: "nome do chat/grupo p/ open" },
      text: { type: "string", description: "mensagem p/ send (obrigatória, explícita do dono)" },
      limit: { type: "number", default: 20, description: "N chats/mensagens (máx 100 p/ read)" },
    },
    required: ["action"],
  },
  run: async (a) => {
    const t0 = Date.now();
    const map = { state: "tab.wa_state", chats: "tab.wa_chats", open: "tab.wa_open", read: "tab.wa_read", send: "tab.wa_send" };
    if (!map[a.action]) return devOut({ status: "error", summary: `action inválida: ${a.action}`, data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    if (a.action === "send" && !(a.text && String(a.text).trim())) return devOut({ status: "error", summary: "send exige text explícito do dono", data: {}, telemetry: { execution_time_ms: Date.now() - t0 } });
    const r = await ubSend(map[a.action], { ...a }, 90000);
    if (r.__offline || r.__timeout) return devOut({ status: "error", summary: r.__offline ? UB_OFF : "timeout 90s (WhatsApp pesado/sincronizando)", data: { action: a.action }, telemetry: { execution_time_ms: Date.now() - t0 } });
    if (!r.ok) return devOut({ status: "error", summary: `extensão: ${r.error}`, data: { action: a.action }, telemetry: { execution_time_ms: Date.now() - t0 } });
    const d = r.data || {};
    const summary = a.action === "read" && Array.isArray(d)
      ? `${d.length} mensagem(ns)` + (d.length ? ` — última de ${d[d.length - 1].from}: ${(d[d.length - 1].text || "").slice(0, 100)}` : "")
      : a.action === "open" ? (d.opened ? `Chat aberto: ${d.title || a.name}` : `NÃO abriu (${d.reason || "?"})`)
      : a.action === "send" ? (d.sent ? "Mensagem enviada ✓ (confira no telefone)" : `NÃO enviada (${d.reason || "?"})`)
      : a.action === "chats" ? `${(Array.isArray(d) ? d.length : 0)} conversa(s) visíveis`
      : `state: ${d.logged ? "logado" : d.qr ? "QR (parear no telefone)" : "carregando"}`;
    return devOut({ summary, data: { action: "whatsapp_" + a.action, risk: a.action === "send" ? "medium" : "low", result: d }, telemetry: { execution_time_ms: Date.now() - t0 }, next: a.action === "open" && d.opened ? [{ tool: "n_whatsapp", reason: "Ler mensagens (read)" }] : [] });
  },
});
