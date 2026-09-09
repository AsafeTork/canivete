async function refresh() {
  const s = await chrome.storage.local.get(["token", "enabled"]);
  const on = s.enabled !== false && !!s.token;
  document.getElementById("dot").className = on ? "on" : "off";
  document.getElementById("status").textContent = !s.token
    ? "sem token — cole o token.txt"
    : s.enabled !== false ? "ATIVO — modelo pode ver/agir (quando você pedir)" : "PAUSADO — modelo bloqueado";
  if (s.token) document.getElementById("token").value = s.token;
}
document.getElementById("save").onclick = async () => {
  const token = document.getElementById("token").value.trim();
  await chrome.storage.local.set({ token });
  refresh();
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
    d.textContent = r.ok ? "ponte OK (" + r.http + " " + r.body + ")" : "FALHA: " + (r.error || r.http);
  } catch (e) { d.textContent = "SW sem resposta (dormente?) — aguarde 1 min e tente de novo"; }
};
(async () => {
  const s = await chrome.storage.local.get(["diag"]);
  if (s.diag) document.getElementById("diag").textContent =
    `polls:${s.diag.polls} último ok:${s.diag.lastPollOk} erro:${s.diag.lastError}`;
})();
refresh();
