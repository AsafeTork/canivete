// Hash estável do catálogo público — usado para avisar clientes MCP (Codex/claude)
// que a lista de tools mudou sem precisar reiniciar a sessão.
import { createHash } from "node:crypto";

export function toolsHashOf(tools) {
  const names = [...tools.entries()]
    .filter(([, t]) => t && t.public !== false)
    .map(([n]) => n)
    .sort();
  return createHash("sha1").update(names.join("\n")).digest("hex").slice(0, 12);
}
