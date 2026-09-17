// canivete — trava anti-destrutiva compartilhada (doutrina do dono:
// acesso total quando ele pedir; NUNCA destrutivo/idiota sem pedido explícito)
// --- INFORMATIVO vs TRANSACIONAL ---
// Regra: texto com "Pix/Total" em contexto de leitura (ex.: produto "Pix Total") NÃO é ação de pagar.
//  - INFORMATIVO: "Pix Total", "Pix total" → LOW/MEDIUM (leitura, não pagamento)
//  - TRANSACIONAL: "via Pix", "pelo Pix", "no Pix", "chave Pix", "Pix:" → HIGH (ação de pagar)
// Testes mentais:
//  - riskOf({text:"Pix Total"}) → "low"  (informativo, não pagamento)
//  - riskOf({text:"pagar via Pix"}) → "high"  (transacional)
//  - riskOf({text:"chave Pix", action:"fill"}) → "high"  (transacional)

const HIGH = [
  /pag(?:ar|amento)|transfer|boleto|checkout.*(pagar|confirmar)/i,
  /pix\s*[:\-](?!\s*total\b)|\(pix\)|via pix|pelo pix|no pix|chave pix/i, // pix transacional (exclui "Pix Total"/"Pix/Total"/"Pix - Total" informativo)
  /redefinir|redefini.*senha|trocar.*senha|alterar.*senha|nova senha|change.*password|reset.*password|esqueci.*senha|forgot.*password|#[a-z]*senha|selector.*senha|#password/i,
  /ativar.*2fa|desativar.*2fa|setup.*totp|escanear.*qr/i,
  /exclu.*conta|encerr.*conta|delet.*account|apagar.*conta|cancelar.*(conta|assinatura)/i,
  /(delet|exclu|apag).*(tudo|todos|all)|select.*all.*delet|limpar.*tudo/i,
  /desinstal|uninstall|format(ar)?\b/i,
  /chrome:\/\/extensions/i,
  /\.(exe|msi|dmg|deb|appimage|bat|ps1)(\?|$)/i,
  // Bloqueio real mantido: shell destrutivo (excluir/apagar/senha em shell) + SQL destrutivo
  /rm\s+-[rf]/i, /shred|wipe|dd\s+/i, /chpasswd|passwd.*(change|set)/i,
  /\bdrop\s+(table|database)\b|delete\s+from\b|\btruncate\b/i,
];

// Allowlist: navegação simples em whats.web e magalu ≠ ação destrutiva.
// Login no whats.web/magalu é leitura/navegação, NÃO exfiltra senha.
const ALLOWLIST_DOMAINS = ["whatsapp.com", "web.whatsapp.com", "whats.web", "magalu.com.br", "www.magalu.com.br"];

function isAllowlistURL(url) {
  if (!url) return false;
  const u = String(url).toLowerCase();
  return ALLOWLIST_DOMAINS.some((d) => u.includes(d));
}

// Bypass do allowlist só p/ sinais reais — "senha" isolado ("Entrar sem senha") NÃO sai do allowlist.
const ALLOWLIST_BYPASS = /redefinir|trocar.*senha|alterar.*senha|nova senha|change.*password|reset.*password|esqueci.*senha|forgot.*password|#[a-z]*senha|selector.*senha|#password|chpasswd|drop\s+(table|database)|delete\s+from|truncate|delete|wipe|format|exclu|apag|rm\s+-/i;

export function riskOf(a = {}) {
  const blob = `${a.action || ""} ${a.cmd || ""} ${a.selector || ""} ${a.text || ""} ${a.js || ""} ${a.url || ""}`;
  const norm = blob.replace(/[\/\-]+/g, " ").replace(/\s+/g, " ");
  // INFORMATIVO: "Pix Total"/"Pix/Total"/"Pix - Total" em leitura NÃO é pagamento — nunca high por pix.
  const isPixInformativo = /pix\s+total|total\s+pix/i.test(norm);
  const isPixTransacional = /pix\s*:(?!\s*total\b)|\(pix\)|via pix|pelo pix|no pix|chave pix/i.test(blob);
  if (isPixInformativo && !isPixTransacional) {
    if (isAllowlistURL(a.url)) return "low";
    if (a.action === "cursor") return a.click ? "medium" : "low";
    if (["click", "fill", "type", "select", "press", "evaluate"].includes(a.action)) return "medium";
    return "low";
  }
  // Navegação p/ login ("Entrar sem senha", "Login") NÃO é exfiltração — nunca high sem sinal real.
  const isLoginNav = /entrar(\s+sem)?\s*senha|\bfazer\s+login\b|\blogin\b/i.test(blob);
  const isExfiltracao = /redefinir|redefini.*senha|trocar.*senha|alterar.*senha|nova senha|change.*password|reset.*password|esqueci.*senha|forgot.*password|#[a-z]*senha|selector.*senha|#password|chpasswd/i.test(blob);
  if (isLoginNav && !isExfiltracao) {
    if (isAllowlistURL(a.url)) return "low";
    if (a.action === "cursor") return a.click ? "medium" : "low";
    if (["click", "fill", "type", "select", "press", "evaluate"].includes(a.action)) return "medium";
    return "low";
  }
  // Allowlist: navegação simples em whats.web + magalu (leitura, não transação).
  // Login no whats.web/magalu é leitura; NÃO exfiltra senha.
  if (isAllowlistURL(a.url) && !ALLOWLIST_BYPASS.test(blob)) return "low";
  if (HIGH.some((r) => r.test(blob))) return "high";
  if (a.action === "cursor") return a.click ? "medium" : "low";
  if (["click", "fill", "type", "select", "press", "evaluate"].includes(a.action)) return "medium";
  return "low";
}

export function needConfirm(a = {}) {
  return riskOf(a) === "high" && !(a.confirm && String(a.confirm).trim().length >= 4);
}

// Testes mentais (não executáveis, documentação de comportamento):
//   riskOf({url:"https://web.whatsapp.com", action:"goto"}) → "low"  (allowlist)
//   riskOf({url:"https://web.whatsapp.com", action:"fill", selector:"#senha"}) → "high" (sai do allowlist: shell de senha)
//   riskOf({url:"https://www.magalu.com.br", action:"click", text:"produto"}) → "low" (allowlist)
//   riskOf({text:"Pix Total"}) → "low" (informativo, não pix transacional)
//   riskOf({text:"pagar via Pix"}) → "high" (transacional)
//   riskOf({cmd:"rm -rf /", action:"n_bash"}) → "high" (bloqueio real mantido)
//   riskOf({action:"click", selector:"text=excluir conta"}) → "high" (bloqueio real mantido)
