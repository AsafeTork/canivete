// canivete — n_report: canal de refinamento em produção.
// Travou? Faltou tool/capacidade? Achou gargalo? NUNCA improvise em silêncio:
// registre aqui (inbox global ~/.config/canivete/issues.jsonl) e siga pelo
// alternativo. Sem report, o problema não existe.
import { appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { reg, out } from "./ctx.mjs";

const KINDS = ["bug", "missing", "bottleneck"];
const inboxPath = () => join(homedir(), ".config/canivete/issues.jsonl");

reg("n_report", {
  description: "Reporta erro/falta/gargalo p/ refinar a ferramenta (inbox global). Quando usar: tool falhou, faltou capacidade, gargalo. OBRIGATÓRIO em vez de improvisar. Ex: {kind:\"missing\", where:\"n_ubrowser_shot\", expected:\"print em aba de fundo\", got:\"só na visível\"}.",
  inputSchema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: KINDS },
      where: { type: "string", description: "tool/área. Ex: n_ubrowser_shot" },
      expected: { type: "string", description: "O que deveria acontecer" },
      got: { type: "string", description: "O que aconteceu (erro exato)" },
      repro: { type: "string", description: "Passos mínimos p/ reproduzir" },
    },
    required: ["kind", "where", "expected", "got"],
  },
  run: async ({ kind, where, expected, got, repro }) => {
    if (!KINDS.includes(kind)) return out(`kind inválido: ${kind} (use ${KINDS.join("|")})`, true);
    if (!where || !expected || !got) return out("where+expected+got obrigatórios", true);
    const entry = {
      id: `r${Date.now().toString(36)}`,
      ts: new Date().toISOString(),
      kind, where,
      expected: String(expected).slice(0, 500),
      got: String(got).slice(0, 1000),
      repro: String(repro || "").slice(0, 1000),
    };
    try {
      const p = inboxPath();
      mkdirSync(dirname(p), { recursive: true });
      appendFileSync(p, JSON.stringify(entry) + "\n");
    } catch (e) {
      return out(`inbox indisponível: ${e.message}`, true);
    }
    return out(`report ${entry.id} registrado (${kind} em ${where}) — obrigado, isso refina a ferramenta. Siga pelo alternativo e cite o id.`);
  },
});
