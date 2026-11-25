// Classificador de ruído ambiente do mon-hook: avisos de SDKs de terceiros e
// bloqueios de CSP que não são erro da automação. Fonte única p/ a ponte (alertas).
// O opt-in `filter:"all"` no console sempre mostra tudo — nada é descartado na página.
const NOISE = [
  /\[Statsig\]/i,
  /content security policy directive/i,
  /creating a worker from 'blob:/i,
  /unsatisfied version .* shared singleton module/i,
  /descendant <Routes>|parent route path has no trailing/i,
  /\[Kumo Input\]: Input must have an accessible name/i,
  /GetMe error DSFetchError: Usuário não logado/i,
  /error fetching location data|no object found in localStorage with the specified key: locationData|no data available in localStorage/i,
  /ErrorUtils caught an error:\s*voip: first init attempt/i,
  /\/naLogImpressions\b|\/__l5e\/trackevents\b/i,
];

export function isMonNoise(e) {
  if (!e || typeof e !== "object") return false;
  // js-error sem mensagem não tem conteúdo acionável (ex.: CSP bloqueou worker).
  if ((e.kind === "js-error" || e.kind === "promise") && !String(e.text || "").trim()) return true;
  const text = `${String(e.text || "")} ${String(e.url || "")}`;
  return NOISE.some((re) => re.test(text));
}
