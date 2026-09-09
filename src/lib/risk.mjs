// canivete — trava anti-destrutiva compartilhada (doutrina do dono:
// acesso total quando ele pedir; NUNCA destrutivo/idiota sem pedido explícito)
const HIGH = [
  /pag(?:ar|amento)|pix|transfer|boleto|checkout.*(pagar|confirmar)/i,
  /senh|password|2fa|mfa|totp|redefinir.*acesso/i,
  /exclu.*conta|encerr.*conta|delet.*account|apagar.*conta|cancelar.*(conta|assinatura)/i,
  /(delet|exclu|apag).*(tudo|todos|all)|select.*all.*delet|limpar.*tudo/i,
  /desinstal|uninstall|format(ar)?\b/i,
  /chrome:\/\/extensions/i,
  /\.(exe|msi|dmg|deb|appimage|bat|ps1)(\?|$)/i,
];

export function riskOf(a = {}) {
  const blob = `${a.action || a.cmd || ""} ${a.selector || ""} ${a.text || ""} ${a.js || ""} ${a.url || ""}`;
  if (HIGH.some((r) => r.test(blob))) return "high";
  if (a.action === "cursor") return a.click ? "medium" : "low";
  if (["click", "fill", "press", "evaluate"].includes(a.action)) return "medium";
  return "low";
}

export function needConfirm(a = {}) {
  return riskOf(a) === "high" && !(a.confirm && String(a.confirm).trim().length >= 4);
}
