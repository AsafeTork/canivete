// canivete — APIs públicas sem chave (currency/cep/cnpj/ipinfo/weather/github/npm)
import { reg, out, httpJson, trimOut } from "./ctx.mjs";
import { cached } from "./web.mjs";

// Retry local com backoff: tenta até `tries` vezes (default 3), intervalo 500ms,2s.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchRetry(fn, tries = 3) {
  const delays = [500, 2000];
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      last = await fn();
      // httpJson nunca lança: sinaliza rede via status 0. Retry em erro transitório.
      if (last && typeof last.status === "number") {
        const s = last.status;
        const transient = s === 0 || s === 429 || (s >= 500 && s < 600);
        if (transient && i < tries - 1) {
          await sleep(delays[i] ?? 2000);
          continue;
        }
      }
      return last;
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(delays[i] ?? 2000);
    }
  }
  return last;
}

reg("n_currency", {
  description: "Taxa de câmbio/conversão (ECB/Frankfurter, diário, cache 1h). Converte valores e precifica. Ex: {from:\"BRL\", to:\"USD,EUR\" ou [\"USD\",\"EUR\"], amount:100, invert:false}. Retorna tabela: 1 origem = X destino + valor convertido. Com invert:true inverte (1 USD = N BRL).",
  inputSchema: {
    type: "object",
    properties: {
      from: { type: "string", description: "Moeda de origem (padrão BRL). Ex: BRL", default: "BRL" },
      to: {
        anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
        description: "Moeda(s) de destino: string com lista separada por vírgula ou array. Ex: \"USD,EUR\" ou [\"USD\",\"EUR\"] (padrão USD)",
        default: "USD",
      },
      amount: { type: "number", description: "Valor a converter na moeda de origem (padrão 1)" },
      invert: { type: "boolean", description: "Se true, inverte a cotação: mostra 1 destino = N origem (ex: 1 USD = N BRL). Padrão false.", default: false },
    },
    required: [],
  },
  run: async ({ from, to, amount, invert }) => {
    const a = Number(amount) || 1;
    const f = String(from || "BRL").toUpperCase();
    let toList = Array.isArray(to) ? to : String(to || "USD").split(/[,\s;]+/);
    toList = toList.map((s) => String(s).trim().toUpperCase()).filter(Boolean);
    if (!toList.length) toList = ["USD"];
    const toParam = toList.join(",");
    const inv = invert === true;
    const r = await cached(
      `cur:${f}:${toParam}${inv ? ":inv" : ""}`,
      60 * 60 * 1000,
      () => fetchRetry(() => httpJson(`https://api.frankfurter.app/latest?from=${f}&to=${toParam}`)),
      (x) => x.status === 200
    );
    if (r.status !== 200 || !r.data?.rates) return out(`currency API failed (HTTP ${r.status}): ${(r.data?.message || r.text || "").slice(0, 300)}`, true);
    const rates = r.data.rates;
    const lines = inv
      ? [`Conversão invertida ${toParam} → ${f} (fonte: https://api.frankfurter.app, taxas diárias ECB)`, `| moeda | 1 destino = N origem | ${a} destino = total origem |`, `|---|---|---|`]
      : [`Conversão ${a} ${f} → ${toParam} (fonte: https://api.frankfurter.app, taxas diárias ECB)`, `| moeda | 1 ${f} = X | ${a} ${f} = Y |`, `|---|---|---|`];
    for (const cur of toList) {
      const rate = rates[cur];
      if (rate == null) {
        lines.push(`| ${cur} | indisponível | - |`);
        continue;
      }
      if (inv) {
        const invRate = 1 / rate;
        lines.push(`| ${cur} | 1 ${cur} = ${invRate.toFixed(4)} ${f} | ${a} ${cur} = ${(a * invRate).toFixed(4)} ${f} |`);
      } else {
        lines.push(`| ${cur} | 1 ${f} = ${rate} ${cur} | ${a} ${f} = ${(a * rate).toFixed(4)} ${cur} |`);
      }
    }
    return out(lines.join("\n"));
  },
});

reg("n_cep", {
  description: "Busca CEP brasileiro (ViaCEP, cache 24h, com retry). Quando usar: endereço de cliente/entrega. Ex: {cep:\"01001000\"}. Retorna logradouro, bairro, cidade, UF. CEP inválido (≠8 dígitos) falha.",
  inputSchema: {
    type: "object",
    properties: {
      cep: { type: "string", description: "CEP com 8 dígitos. Ex: 01001000" },
    },
    required: ["cep"],
  },
  run: async ({ cep }) => {
    const c = String(cep || "").replace(/\D/g, "");
    if (c.length !== 8) return out(`invalid CEP: "${cep}"`, true);
    const r = await cached(
      `cep:${c}`,
      24 * 60 * 60 * 1000,
      () => fetchRetry(() => httpJson(`https://viacep.com.br/ws/${c}/json/`)),
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
  description: "Consulta CNPJ (ReceitaWS, cache 24h, rate-limited, com retry). Quando usar: validar empresa/cliente. Ex: {cnpj:\"11444777000161\"}. Retorna razão, fantasia, status, atividade, endereço, sócios. Inválido (≠14 dígitos) falha.",
  inputSchema: {
    type: "object",
    properties: {
      cnpj: { type: "string", description: "CNPJ com 14 dígitos. Ex: 11444777000161" },
    },
    required: ["cnpj"],
  },
  run: async ({ cnpj }) => {
    const c = String(cnpj || "").replace(/\D/g, "");
    if (c.length !== 14) return out(`invalid CNPJ: "${cnpj}"`, true);
    const r = await cached(
      `cnpj:${c}`,
      24 * 60 * 60 * 1000,
      () => fetchRetry(() => httpJson(`https://www.receitaws.com.br/v1/cnpj/${c}`, { timeout: 60000 })),
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
  description: "Geolocalização de IP (ip-api.com, 45 req/min, cache 10min, com retry). Omitir IP = seu IP. Quando usar: debug de rede/região. Ex: {ip:\"8.8.8.8\"} ou {}. Retorna país, região, cidade, ISP, lat/lon.",
  inputSchema: {
    type: "object",
    properties: {
      ip: { type: "string", description: "Endereço IPv4 a consultar (padrão: seu IP atual)" },
    },
    required: [],
  },
  run: async ({ ip }) => {
    const key = `ip:${ip || "self"}`;
    const url = ip ? `http://ip-api.com/json/${encodeURIComponent(ip)}?lang=pt-BR` : "http://ip-api.com/json/?lang=pt-BR";
    const r = await cached(
      key,
      10 * 60 * 1000,
      () => fetchRetry(() => httpJson(url, { timeout: 20000 })),
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
  description: "Previsão do tempo (Open-Meteo, cache 30min, lat/lon, 1-7 dias, com retry). Quando usar: planejamento e logística. Ex: {latitude:-23.55, longitude:-46.63, days:3, alert:true}. Retorna máx/mín °C, chuva %, tempo em pt-BR; com alert:true avisa no resumo se chuva>70% ou máx>35°C.",
  inputSchema: {
    type: "object",
    properties: {
      latitude: { type: "number", description: "Latitude do local. Ex: -23.55" },
      longitude: { type: "number", description: "Longitude do local. Ex: -46.63" },
      days: { type: "number", description: "Dias de previsão (padrão 3, máx 7)" },
      alert: { type: "boolean", description: "Se true (padrão), emite ALERTA no resumo quando chuva>70% ou máx>35°C", default: true },
    },
    required: ["latitude", "longitude"],
  },
  run: async ({ latitude, longitude, days, alert }) => {
    const n = Math.min(Math.max(Number(days) || 3, 1), 7);
    const withAlert = alert !== false;
    const r = await cached(
      `wx:${latitude}:${longitude}:${n}`,
      30 * 60 * 1000,
      () =>
        fetchRetry(() =>
          httpJson(
            `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode&forecast_days=${n}&timezone=auto`
          )
        ),
      (x) => x.status === 200 && !!x.data?.daily
    );
    if (r.status !== 200 || !r.data?.daily) return out(`weather failed (HTTP ${r.status}): ${r.text.slice(0, 300)}`, true);
    const d = r.data.daily;
    const codes = { 0: "céu limpo", 1: "maiormente limpo", 2: "parcialmente nublado", 3: "encoberto", 45: "névoa", 48: "névoa congelante", 51: "garoa", 61: "chuva leve", 63: "chuva", 65: "chuva forte", 71: "neve leve", 73: "neve", 75: "neve forte", 80: "pancadas leves", 81: "pancadas", 82: "pancadas fortes", 95: "trovoada" };
    const lines = [`Previsão ${d.time[0]}..${d.time.at(-1)} (${d.time.length} dias)`];
    const alerts = [];
    d.time.forEach((date, i) => {
      const tmin = d.temperature_2m_min[i];
      const tmax = d.temperature_2m_max[i];
      const rain = d.precipitation_probability_max[i];
      lines.push(`${date}: ${tmin}°C..${tmax}°C | chuva ${rain}% | ${codes[d.weathercode[i]] || d.weathercode[i]}`);
      if (withAlert) {
        const motivos = [];
        if (rain != null && rain > 70) motivos.push(`chuva ${rain}%`);
        if (tmax != null && tmax > 35) motivos.push(`máx ${tmax}°C`);
        if (motivos.length) alerts.push(`⚠ ALERTA ${date}: ${motivos.join(" + ")}`);
      }
    });
    if (withAlert && alerts.length) lines.push(...alerts);
    return out(lines.join("\n"));
  },
});

reg("n_github", {
  description: "API do GitHub (60 req/h sem token, cache 10min, com retry). repo|releases|commits|issues. Quando usar: verificar repo/lib. Ex: {owner:\"vitejs\", repo:\"vite\", kind:\"releases\", limit:3}. kind=issues lista top 5 issues abertas (título + #número). Retorna stars, forks, issues, linguagem, licença.",
  inputSchema: {
    type: "object",
    properties: {
      owner: { type: "string", description: "Dono do repositório. Ex: vitejs" },
      repo: { type: "string", description: "Nome do repositório. Ex: vite" },
      kind: { type: "string", enum: ["repo", "releases", "commits", "issues"], description: "Tipo de consulta: repo (detalhes), releases, commits ou issues (abertas top N). Padrão repo.", default: "repo" },
      limit: { type: "number", description: "Qtd de itens p/ releases/commits/issues (padrão 5, máx 30)", default: 5 },
    },
    required: ["owner", "repo"],
  },
  run: async ({ owner, repo, kind, limit }) => {
    const k = kind || "repo";
    const n = Math.min(Math.max(Number(limit) || 5, 1), 30);
    const base = `https://api.github.com/repos/${owner}/${repo}`;
    const url = k === "repo" ? base : k === "issues" ? `${base}/issues?state=open&per_page=${n}` : `${base}/${k}?per_page=${n}`;
    const ghToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    const headers = ghToken ? { authorization: `Bearer ${ghToken}` } : {};
    const r = await cached(
      `gh:${k}:${owner}/${repo}:${n}`,
      10 * 60 * 1000,
      () => fetchRetry(() => httpJson(url, { headers })),
      (x) => x.status === 200
    );
    if (r.status === 403) return out("GitHub rate limit exceeded (60 req/h sem token). Defina GITHUB_TOKEN/GH_TOKEN para mais.", true);
    if (r.status !== 200) return out(`GitHub API failed (HTTP ${r.status})`, true);
    if (k === "repo") {
      const d = r.data;
      return out(`${d.full_name} — ${d.description || "sem descrição"}\nstars: ${d.stargazers_count} | forks: ${d.forks_count} | open issues: ${d.open_issues_count}\nlanguage: ${d.language} | license: ${d.license?.spdx_id || "-"}\nupdated: ${d.updated_at}\nurl: ${d.html_url}`);
    }
    const items = Array.isArray(r.data) ? r.data.slice(0, n) : [];
    if (!items.length) return out(`no ${k} found`);
    if (k === "issues") {
      return out(items.map((it, i) => `${i + 1}. #${it.number} ${it.title} (${it.state || "open"} · ${it.comments ?? 0} comentários · ${it.created_at || "-"})`).join("\n"));
    }
    return out(items.map((it, i) => `${i + 1}. ${it.tag_name || it.name || (it.commit?.message || "").split("\n")[0]} (${it.published_at || it.created_at || it.commit?.author?.date || "-"})`).join("\n"));
  },
});

reg("n_npm", {
  description: "Info do pacote npm (cache 1h, com retry). Quando usar: checar lib antes de instalar. Ex: {package:\"vite\"}. Retorna versão, descrição, licença, deps e downloads do ÚLTIMO MÊS.",
  inputSchema: {
    type: "object",
    properties: {
      package: { type: "string", description: "Nome do pacote. Ex: vite" },
      scope: { type: "string", description: "Escopo opcional. Ex: @opencode-ai" },
    },
    required: ["package"],
  },
  run: async ({ package: pkg, scope }) => {
    const name = scope ? `${scope}/${pkg}` : pkg;
    const [meta, dl] = await cached(
      `npm:${name}`,
      60 * 60 * 1000,
      () =>
        fetchRetry(() =>
          Promise.all([
            httpJson(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`),
            httpJson(`https://api.npmjs.org/downloads/point/last-month/${encodeURIComponent(name)}`),
          ])
        ),
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

