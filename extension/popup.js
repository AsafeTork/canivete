async function refresh() {
  const s = await chrome.storage.local.get(["token", "enabled", "profileLabel"]);
  const on = s.enabled !== false && !!s.token;
  document.getElementById("dot").className = on ? "on" : "off";
  document.getElementById("status").textContent = !s.token
    ? "sem token — cole o token.txt"
    : s.enabled !== false ? "ATIVO — modelo pode ver/agir (quando você pedir)" : "PAUSADO — modelo bloqueado";
  if (s.token) document.getElementById("token").value = s.token;
  const li = document.getElementById("label");
  if (li && document.activeElement !== li) li.value = (s.profileLabel || "").slice(0, 60);
  try {
    const st = await chrome.runtime.sendMessage({ cmd: "status" });
    document.getElementById("client").textContent = "cliente: " + (st && st.clientId ? String(st.clientId).slice(0, 12) + "…" : "—");
  } catch { document.getElementById("client").textContent = "cliente: — (SW dormente?)"; }
}
document.getElementById("save").onclick = async () => {
  const token = document.getElementById("token").value.trim();
  await chrome.storage.local.set({ token });
  await refresh();
  // valida de verdade (Salvar sozinho aceitava qualquer texto — falso verde):
  const d = document.getElementById("diag");
  d.textContent = "verificando token…";
  try {
    const r = await chrome.runtime.sendMessage({ cmd: "pingBridge" });
    d.textContent = r.ok ? ("ponte OK + " + (r.token || "token?")) : ("FALHA: " + (r.error || r.http));
  } catch (e) { d.textContent = "SW sem resposta (dormente?) — aguarde 1 min e tente de novo"; }
};
document.getElementById("toggle").onclick = async () => {
  const s = await chrome.storage.local.get(["enabled"]);
  await chrome.storage.local.set({ enabled: !(s.enabled !== false) });
  refresh();
};
document.getElementById("test").onclick = async () => {
  const d = document.getElementById("diag");
  d.textContent = "testando…";
  try {
    const r = await chrome.runtime.sendMessage({ cmd: "pingBridge" });
    d.textContent = r.ok ? ("ponte OK (" + r.http + " " + r.body + ") + " + (r.token || "token?") + " · " + (r.clientId ? "cliente " + String(r.clientId).slice(0, 8) + "…" : "cliente?")) : ("FALHA: " + (r.error || r.http));
  } catch (e) { d.textContent = "SW sem resposta (dormente?) — aguarde 1 min e tente de novo"; }
};
// label do perfil: persiste e manda hello de teste na mesma tacada (rota p/ multi-perfil)
document.getElementById("saveLabel").onclick = async () => {
  const label = document.getElementById("label").value.trim().slice(0, 60);
  await chrome.storage.local.set({ profileLabel: label });
  refresh();
  const d = document.getElementById("diag");
  d.textContent = "salvando label + ping na ponte…";
  try {
    const r = await chrome.runtime.sendMessage({ cmd: "pingBridge" });
    d.textContent = r.ok
      ? ("label '" + label + "' salvo + " + (r.token || "token?") + " · cliente " + (r.clientId ? String(r.clientId).slice(0, 8) + "…" : "?"))
      : ("FALHA: " + (r.error || r.http));
  } catch (e) { d.textContent = "SW sem resposta (dormente?) — aguarde 1 min e tente de novo"; }
};
(async () => {
  const s = await chrome.storage.local.get(["diag"]);
  if (s.diag) document.getElementById("diag").textContent =
    `polls:${s.diag.polls} último ok:${s.diag.lastPollOk} erro:${s.diag.lastError}`;
})();
refresh();
