// canivete — APIs públicas sem chave (currency/cep/cnpj/ipinfo/weather/github/npm)
import { reg, out, httpJson, trimOut } from "./ctx.mjs";
import { cached } from "./web.mjs";

reg("n_currency", {
  description: "Taxa de câmbio/conversão (ECB/Frankfurter, diário, cache 1h). Default BRL→USD. Quando usar: converter valores, precificar. Ex: {from:\"BRL\", to:\"USD,EUR\", amount:100}. Retorna 1 from = X to + amount convertido.",
  inputSchema: {
    type: "object",
    properties: {
      from: { type: "string", description: "Base currency (default BRL)", default: "BRL" },
      to: { type: "string", description: "Target currency, comma list (default USD)", default: "USD" },
      amount: { type: "number", description: "Amount to convert (default 1)" },
    },
    required: [],
  },
  run: async ({ from, to, amount }) => {
    const a = Number(amount) || 1;
    const [f, t] = [from || "BRL", to || "USD"];
    const r = await cached(
      `cur:${f.toUpperCase()}:${t.toUpperCase()}`,
      60 * 60 * 1000,
      () => httpJson(`https://api.frankfurter.app/latest?from=${f.toUpperCase()}&to=${t.toUpperCase()}`),
      (x) => x.status === 200
    );
    if (r.status !== 200 || !r.data?.rates) return out(`currency API failed (HTTP ${r.status}): ${(r.data?.message || r.text || "").slice(0, 300)}`, true);
    const lines = [f.toUpperCase(), `source: https://api.frankfurter.app (ECB daily rates)`];
    for (const [cur, rate] of Object.entries(r.data.rates)) {
      lines.push(`${cur.toUpperCase()}: 1 ${f.toUpperCase()} = ${rate} ${cur.toUpperCase()}  |  ${a} ${f.toUpperCase()} = ${(a * rate).toFixed(4)} ${cur.toUpperCase()}`);
    }
    return out(lines.join("\n"));
  },
});

reg("n_cep", {
  description: "Busca CEP brasileiro (ViaCEP, cache 24h). Quando usar: endereço de cliente/entrega. Ex: {cep:\"01001000\"}. Retorna logradouro, bairro, cidade, UF. CEP inválido (≠8 dígitos) falha.",
  inputSchema: {
    type: "object",
    properties: {
      cep: { type: "string", description: "8-digit CEP, e.g. 01001000" },
    },
    required: ["cep"],
  },
  run: async ({ cep }) => {
    const c = String(cep || "").replace(/\D/g, "");
    if (c.length !== 8) return out(`invalid CEP: "${cep}"`, true);
    const r = await cached(
      `cep:${c}`,
      24 * 60 * 60 * 1000,
      () => httpJson(`https://viacep.com.br/ws/${c}/json/`),
      (x) => x.status === 200 && !x.data?.erro
    );
    if (r.status !== 200) return out(`ViaCEP failed (HTTP ${r.status})`, true);
    if (r.data?.erro) return out("CEP not found", true);
    return out(
      `CEP: ${r.data.cep}\nLogradouro: ${r.data.logradouro}\nBairro: ${r.data.bairro}\nCidade: ${r.data.localidade}/${r.data.uf}\nIBGE: ${r.data.ibge}\nComplemento: ${r.data.complemento || "-"}`
    );
  },
});

reg("n_cnpj", {
  description: "Consulta CNPJ (ReceitaWS, cache 24h, rate-limited). Quando usar: validar empresa/cliente. Ex: {cnpj:\"11444777000161\"}. Retorna razão, fantasia, status, atividade, endereço, sócios. Inválido (≠14 dígitos) falha.",
  inputSchema: {
    type: "object",
    properties: {
      cnpj: { type: "string", description: "14 digits, e.g. 11444777000161" },
    },
    required: ["cnpj"],
  },
  run: async ({ cnpj }) => {
    const c = String(cnpj || "").replace(/\D/g, "");
    if (c.length !== 14) return out(`invalid CNPJ: "${cnpj}"`, true);
    const r = await cached(
      `cnpj:${c}`,
      24 * 60 * 60 * 1000,
      () => httpJson(`https://www.receitaws.com.br/v1/cnpj/${c}`, { timeout: 60000 }),
      (x) => x.status === 200 && !!x.data?.status
    );
    if (r.status !== 200 || !r.data?.status) return out(`ReceitaWS failed (HTTP ${r.status}): ${r.text.slice(0, 300)}`, true);
    const d = r.data;
    return out(
      `CNPJ: ${d.cnpj}\nRazao social: ${d.nome}\nNome fantasia: ${d.fantasia || "-"}\nStatus: ${d.status} (${d.situacao || "-"}) desde ${d.data_situacao || "-"}\nAtividade: ${d.atividade_principal?.[0]?.text || "-"}\nEndereco: ${d.logradouro}, ${d.numero} - ${d.municipio}/${d.uf} ${d.cep || ""}\nTelefone: ${d.telefone || "-"}\nData abertura: ${d.abertura || "-"}\nCapital social: ${d.capital_social || "-"}\nSocios: ${(d.qsa || []).map((q) => `${q.nome_socio} (${q.qual_socio})`).join("; ") || "-"}`
    );
  },
});

reg("n_ipinfo", {
  description: "Geolocalização IP (ip-api.com, 45 req/min, cache 10min). Omitir IP = seu IP. Quando usar: debug rede/região. Ex: {ip:\"8.8.8.8\"} ou {}. Retorna país, região, cidade, ISP, lat/lon.",
  inputSchema: {
    type: "object",
    properties: {
      ip: { type: "string", description: "IPv4 (default: current IP)" },
    },
    required: [],
  },
  run: async ({ ip }) => {
    const key = `ip:${ip || "self"}`;
    const url = ip ? `http://ip-api.com/json/${encodeURIComponent(ip)}?lang=pt-BR` : "http://ip-api.com/json/?lang=pt-BR";
    const r = await cached(
      key,
      10 * 60 * 1000,
      () => httpJson(url, { timeout: 20000 }),
      (x) => x.status === 200 && x.data?.status === "success"
    );
    if (r.status !== 200 || !r.data || r.data.status !== "success") {
      return out(`ip lookup failed (HTTP ${r.status}): ${r.data?.message || r.data?.status || r.text.slice(0, 300)}`, true);
    }
    return out(
      `IP: ${r.data.query}\nPaís: ${r.data.country} (${r.data.countryCode})\nRegião: ${r.data.regionName}\nCidade: ${r.data.city}\nISP: ${r.data.isp}\nLat/Lon: ${r.data.lat}, ${r.data.lon}`
    );
  },
});

reg("n_weather", {
  description: "Previsão tempo (Open-Meteo, cache 30min, lat/lon, 1-7 dias). Quando usar: planejamento logística. Ex: {latitude:-23.55, longitude:-46.63, days:3}. Retorna max/min °C, chuva %, código tempo em pt-BR.",
  inputSchema: {
    type: "object",
    properties: {
      latitude: { type: "number" },
      longitude: { type: "number" },
      days: { type: "number", description: "Forecast days (default 3, max 7)" },
    },
    required: ["latitude", "longitude"],
  },
  run: async ({ latitude, longitude, days }) => {
    const n = Math.min(Math.max(Number(days) || 3, 1), 7);
    const r = await cached(
      `wx:${latitude}:${longitude}:${n}`,
      30 * 60 * 1000,
      () =>
        httpJson(
          `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode&forecast_days=${n}&timezone=auto`
        ),
      (x) => x.status === 200 && !!x.data?.daily
    );
    if (r.status !== 200 || !r.data?.daily) return out(`weather failed (HTTP ${r.status}): ${r.text.slice(0, 300)}`, true);
    const d = r.data.daily;
    const codes = { 0: "céu limpo", 1: "maiormente limpo", 2: "parcialmente nublado", 3: "encoberto", 45: "névoa", 48: "névoa congelante", 51: "garoa", 61: "chuva leve", 63: "chuva", 65: "chuva forte", 71: "neve leve", 73: "neve", 75: "neve forte", 80: "pancadas leves", 81: "pancadas", 82: "pancadas fortes", 95: "trovoada" };
    const lines = [`Previsão ${d.time[0]}..${d.time.at(-1)} (${d.time.length} dias)`];
    d.time.forEach((date, i) => {
      lines.push(`${date}: ${d.temperature_2m_min[i]}°C..${d.temperature_2m_max[i]}°C | chuva ${d.precipitation_probability_max[i]}% | ${codes[d.weathercode[i]] || d.weathercode[i]}`);
    });
    return out(lines.join("\n"));
  },
});

reg("n_github", {
  description: "GitHub API (60 req/h unauthenticated, cache 10min). repo|releases|commits. Quando usar: verificar repo/lib. Ex: {owner:\"vitejs\", repo:\"vite\", kind:\"releases\", limit:3}. Retorna stars, forks, issues, linguagem, license.",
  inputSchema: {
    type: "object",
    properties: {
      owner: { type: "string" },
      repo: { type: "string" },
      kind: { type: "string", enum: ["repo", "releases", "commits"], default: "repo" },
      limit: { type: "number", default: 5 },
    },
    required: ["owner", "repo"],
  },
  run: async ({ owner, repo, kind, limit }) => {
    const k = kind || "repo";
    const n = Math.min(Math.max(Number(limit) || 5, 1), 30);
    const base = `https://api.github.com/repos/${owner}/${repo}`;
    const url = k === "repo" ? base : `${base}/${k}?per_page=${n}`;
    const ghToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    const headers = ghToken ? { authorization: `Bearer ${ghToken}` } : {};
    const r = await cached(
      `gh:${k}:${owner}/${repo}:${n}`,
      10 * 60 * 1000,
      () => httpJson(url, { headers }),
      (x) => x.status === 200
    );
    if (r.status === 403) return out("GitHub rate limit exceeded (60 req/h sem token). Defina GITHUB_TOKEN/GH_TOKEN para mais.", true);
    if (r.status !== 200) return out(`GitHub API failed (HTTP ${r.status})`, true);
    if (k === "repo") {
      const d = r.data;
      return out(`${d.full_name} — ${d.description || "sem descrição"}\nstars: ${d.stargazers_count} | forks: ${d.forks_count} | open issues: ${d.open_issues_count}\nlanguage: ${d.language} | license: ${d.license?.spdx_id || "-"}\nupdated: ${d.updated_at}\nurl: ${d.html_url}`);
    }
    const items = Array.isArray(r.data) ? r.data : [];
    return out(items.length ? items.map((it, i) => `${i + 1}. ${it.tag_name || it.name || (it.commit?.message || "").split("\n")[0]} (${it.published_at || it.created_at || it.commit?.author?.date || "-"})`).join("\n") : `no ${k} found`);
  },
});

reg("n_npm", {
  description: "npm registry info (cache 1h): latest version, size, deps, downloads. Quando usar: checar lib antes de instalar. Ex: {package:\"dexie\"}. Retorna versão, deps, downloads semanal.",
  inputSchema: {
    type: "object",
    properties: {
      package: { type: "string", description: "Package name, e.g. vite" },
      scope: { type: "string", description: "Optional scope, e.g. @opencode-ai" },
    },
    required: ["package"],
  },
  run: async ({ package: pkg, scope }) => {
    const name = scope ? `${scope}/${pkg}` : pkg;
    const [meta, dl] = await cached(
      `npm:${name}`,
      60 * 60 * 1000,
      () =>
        Promise.all([
          httpJson(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`),
          httpJson(`https://api.npmjs.org/downloads/point/last-month/${encodeURIComponent(name)}`),
        ]),
      (x) => x[0].status === 200
    );
    if (meta.status !== 200 || !meta.data) return out(`npm registry failed (HTTP ${meta.status})`, true);
    const d = meta.data;
    const lines = [
      `${name}@${d.version}`,
      `description: ${d.description || "-"}`,
      `license: ${d.license || "-"} | deps: ${Object.keys(d.dependencies || {}).length} | bin: ${Object.keys(d.bin || {}).join(", ") || "-"}`,
      `engines: ${JSON.stringify(d.engines || {})}`,
      `dist.tarball: ${d.dist?.tarball || "-"}`,
    ];
    if (dl.data) lines.push(`downloads last month: ${dl.data.downloads.toLocaleString("pt-BR")}`);
    return out(lines.join("\n"));
  },
});

