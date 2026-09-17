// canivete — APIs públicas sem chave (currency/cep/cnpj/ipinfo/weather/github/npm)
import { reg, out, httpJson, trimOut } from "./ctx.mjs";
import { cached } from "./web.mjs";

// CACHE INTELLIGENCE (só apis.mjs, sem mudar resultados):
// - normaliza chaves (moeda upper/trim, CEP/CNPJ só dígitos, ip trim, lat/lon 2 casas)
// - TTL por volatilidade (câmbio 1h, clima 30min, CEP/CNPJ 7d semi-estático)
// - memo em-memória do out() final, além do `cached` (web.mjs). Sucesso usa TTL do
//   tool; falha (isError, ex: offline) usa negative-cache curto 60s p/ 2ª chamada ~0ms
//   sem stale longo. 304/etag NÃO (httpJson sem suporte).
const memo = new Map();
const DAY_MS = 24 * 60 * 60 * 1000;
const TTL_CEP_CNPJ_MS = 7 * DAY_MS;
const TTL_NEG_MS = 60 * 1000;
function memoGet(key) {
  const hit = memo.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.exp) {
    memo.delete(key);
    return undefined;
  }
  return hit.val;
}
function memoSet(key, val, ttlMs) {
  if (memo.size >= 500) memo.delete(memo.keys().next().value);
  memo.set(key, { exp: Date.now() + ttlMs, val });
}
function memoTtl(baseTtlMs, val) {
  return val?.isError ? Math.min(baseTtlMs, TTL_NEG_MS) : baseTtlMs;
}

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
    const a = amount == null || amount === "" ? 1 : Number(amount);
    if (!Number.isFinite(a) || a <= 0) return out(`invalid amount: "${amount}". Use número finito > 0 (ex: 100).`, true);
    const f = String(from || "BRL").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(f)) return out(`invalid from: "${from}". Use código ISO 4217 com 3 letras (ex: BRL, USD).`, true);
    let toList = Array.isArray(to) ? to : String(to || "USD").split(/[,\s;]+/);
    toList = toList.map((s) => String(s).trim().toUpperCase()).filter(Boolean);
    if (!toList.length) toList = ["USD"];
    const badCur = toList.find((s) => !/^[A-Z]{3}$/.test(s));
    if (badCur) return out(`invalid to: "${badCur}". Use códigos ISO 4217 com 3 letras separados por vírgula (ex: USD,EUR).`, true);
    const toParam = toList.join(",");
    const inv = invert === true;
    const TTL_CUR_MS = 60 * 60 * 1000;
    const mKey = `memo:cur:${f}:${toParam}:${a}:${inv ? "inv" : "n"}`;
    const mHit = memoGet(mKey);
    if (mHit) return mHit;
    const r = await cached(
      `cur:${f}:${toParam}${inv ? ":inv" : ""}`,
      TTL_CUR_MS,
      () => fetchRetry(() => httpJson(`https://api.frankfurter.app/latest?from=${encodeURIComponent(f)}&to=${encodeURIComponent(toParam)}`), 3),
      (x) => x.status === 200
    );
    if (r.status !== 200 || !r.data?.rates) {
      const err = out(`currency API failed (HTTP ${r.status}): ${(r.data?.message || r.text || "").slice(0, 300)}. Causa provável: moeda inválida ou instabilidade da Frankfurter/ECB. Alternativa: confira códigos ISO 4217 e tente de novo em 1min.`, true);
      memoSet(mKey, err, memoTtl(TTL_CUR_MS, err));
      return err;
    }
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
    const res = out(lines.join("\n"));
    memoSet(mKey, res, memoTtl(TTL_CUR_MS, res));
    return res;
  },
});

reg("n_cep", {
  description: "Busca CEP brasileiro (ViaCEP, cache 7 dias, com retry). Quando usar: endereço de cliente/entrega. Ex: {cep:\"01001000\"}. Retorna logradouro, bairro, cidade, UF. CEP inválido (≠8 dígitos) falha.",
  inputSchema: {
    type: "object",
    properties: {
      cep: { type: "string", description: "CEP com 8 dígitos. Ex: 01001000" },
    },
    required: ["cep"],
  },
  run: async ({ cep }) => {
    const c = String(cep || "").replace(/\D/g, "");
    if (c.length !== 8) return out(`invalid CEP: "${cep}". Use 8 dígitos (ex: 01001000, sem hífen).`, true);
    const mKey = `memo:cep:${c}`;
    const mHit = memoGet(mKey);
    if (mHit) return mHit;
    const r = await cached(
      `cep:${c}`,
      TTL_CEP_CNPJ_MS,
      () => fetchRetry(() => httpJson(`https://viacep.com.br/ws/${c}/json/`), 3),
      (x) => x.status === 200 && !x.data?.erro
    );
    if (r.status !== 200) {
      const err = out(`ViaCEP failed (HTTP ${r.status}): ${(r.text || "").slice(0, 200)}. Causa provável: instabilidade da ViaCEP ou rede. Alternativa: confira os 8 dígitos e tente de novo em 1min.`, true);
      memoSet(mKey, err, memoTtl(TTL_CEP_CNPJ_MS, err));
      return err;
    }
    if (r.data?.erro) {
      const err = out(`CEP not found: "${c}". Causa provável: CEP inexistente. Alternativa: confira os dígitos no site dos Correios.`, true);
      memoSet(mKey, err, memoTtl(TTL_CEP_CNPJ_MS, err));
      return err;
    }
    const res = out(
      `CEP: ${r.data.cep}\nLogradouro: ${r.data.logradouro}\nBairro: ${r.data.bairro}\nCidade: ${r.data.localidade}/${r.data.uf}\nIBGE: ${r.data.ibge}\nComplemento: ${r.data.complemento || "-"}`
    );
    memoSet(mKey, res, memoTtl(TTL_CEP_CNPJ_MS, res));
    return res;
  },
});

reg("n_cnpj", {
  description: "Consulta CNPJ (ReceitaWS, cache 7 dias, rate-limited, com retry). Quando usar: validar empresa/cliente. Ex: {cnpj:\"11444777000161\"}. Retorna razão, fantasia, status, atividade, endereço, sócios. Inválido (≠14 dígitos) falha.",
  inputSchema: {
    type: "object",
    properties: {
      cnpj: { type: "string", description: "CNPJ com 14 dígitos. Ex: 11444777000161" },
    },
    required: ["cnpj"],
  },
  run: async ({ cnpj }) => {
    const c = String(cnpj || "").replace(/\D/g, "");
    if (c.length !== 14) return out(`invalid CNPJ: "${cnpj}". Use 14 dígitos (ex: 11444777000161, sem máscara).`, true);
    const mKey = `memo:cnpj:${c}`;
    const mHit = memoGet(mKey);
    if (mHit) return mHit;
    const r = await cached(
      `cnpj:${c}`,
      TTL_CEP_CNPJ_MS,
      () => fetchRetry(() => httpJson(`https://www.receitaws.com.br/v1/cnpj/${c}`, { timeout: 60000 }), 3),
      (x) => x.status === 200 && !!x.data?.status
    );
    if (r.status !== 200 || !r.data?.status) {
      const err = out(`ReceitaWS failed (HTTP ${r.status}): ${(r.text || "").slice(0, 300)}. Causa provável: rate-limit (429) ou CNPJ inexistente. Alternativa: aguarde 1min e tente de novo.`, true);
      memoSet(mKey, err, memoTtl(TTL_CEP_CNPJ_MS, err));
      return err;
    }
    const d = r.data;
    const res = out(
      `CNPJ: ${d.cnpj}\nRazao social: ${d.nome}\nNome fantasia: ${d.fantasia || "-"}\nStatus: ${d.status} (${d.situacao || "-"}) desde ${d.data_situacao || "-"}\nAtividade: ${d.atividade_principal?.[0]?.text || "-"}\nEndereco: ${d.logradouro}, ${d.numero} - ${d.municipio}/${d.uf} ${d.cep || ""}\nTelefone: ${d.telefone || "-"}\nData abertura: ${d.abertura || "-"}\nCapital social: ${d.capital_social || "-"}\nSocios: ${(d.qsa || []).map((q) => `${q.nome_socio} (${q.qual_socio})`).join("; ") || "-"}`
    );
    memoSet(mKey, res, memoTtl(TTL_CEP_CNPJ_MS, res));
    return res;
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
    const ipT = ip == null ? "" : String(ip).trim();
    if (ipT !== "") {
      const m = ipT.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
      const octetsOk = m && m.slice(1).every((o) => Number(o) <= 255);
      if (!octetsOk) return out(`invalid ip: "${ip}". Use IPv4 válido (ex: 8.8.8.8) ou omita para seu IP.`, true);
    }
    const ipNorm = ipT || "self";
    const TTL_IP_MS = 10 * 60 * 1000;
    const mKey = `memo:ip:${ipNorm}`;
    const mHit = memoGet(mKey);
    if (mHit) return mHit;
    const key = `ip:${ipNorm}`;
    const url = ipT ? `http://ip-api.com/json/${encodeURIComponent(ipT)}?lang=pt-BR` : "http://ip-api.com/json/?lang=pt-BR";
    const r = await cached(
      key,
      TTL_IP_MS,
      () => fetchRetry(() => httpJson(url, { timeout: 20000 }), 3),
      (x) => x.status === 200 && x.data?.status === "success"
    );
    if (r.status !== 200 || !r.data || r.data.status !== "success") {
      const err = out(`ip lookup failed (HTTP ${r.status}): ${(r.data?.message || r.data?.status || r.text || "").slice(0, 300)}. Causa provável: IP inválido/privado ou limite 45 req/min. Alternativa: confira o IPv4 ou aguarde 1min.`, true);
      memoSet(mKey, err, memoTtl(TTL_IP_MS, err));
      return err;
    }
    const res = out(
      `IP: ${r.data.query}\nPaís: ${r.data.country} (${r.data.countryCode})\nRegião: ${r.data.regionName}\nCidade: ${r.data.city}\nISP: ${r.data.isp}\nLat/Lon: ${r.data.lat}, ${r.data.lon}`
    );
    memoSet(mKey, res, memoTtl(TTL_IP_MS, res));
    return res;
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
    const lat = Number(latitude);
    const lon = Number(longitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) return out(`invalid latitude: "${latitude}". Use número entre -90 e 90 (ex: -23.55).`, true);
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) return out(`invalid longitude: "${longitude}". Use número entre -180 e 180 (ex: -46.63).`, true);
    const n = Math.min(Math.max(Number(days) || 3, 1), 7);
    const withAlert = alert !== false;
    const rLat = Math.round(lat * 100) / 100;
    const rLon = Math.round(lon * 100) / 100;
    const latS = rLat.toFixed(2);
    const lonS = rLon.toFixed(2);
    const TTL_WX_MS = 30 * 60 * 1000;
    const mKey = `memo:wx:${latS}:${lonS}:${n}:${withAlert ? "a" : "na"}`;
    const mHit = memoGet(mKey);
    if (mHit) return mHit;
    const r = await cached(
      `wx:${latS}:${lonS}:${n}`,
      TTL_WX_MS,
      () =>
        fetchRetry(() =>
          httpJson(
            `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(rLat)}&longitude=${encodeURIComponent(rLon)}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode&forecast_days=${n}&timezone=auto`
          ), 3
        ),
      (x) => x.status === 200 && !!x.data?.daily
    );
    if (r.status !== 200 || !r.data?.daily) {
      const err = out(`weather failed (HTTP ${r.status}): ${(r.text || "").slice(0, 300)}. Causa provável: coords inválidas ou instabilidade da Open-Meteo. Alternativa: confira lat/lon e tente de novo em 1min.`, true);
      memoSet(mKey, err, memoTtl(TTL_WX_MS, err));
      return err;
    }
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
    const res = out(lines.join("\n"));
    memoSet(mKey, res, memoTtl(TTL_WX_MS, res));
    return res;
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
    const nameRe = /^[A-Za-z0-9_.-]+$/;
    if (!owner || !nameRe.test(String(owner))) return out(`invalid owner: "${owner}". Use nome de usuário/org do GitHub (ex: vitejs).`, true);
    if (!repo || !nameRe.test(String(repo))) return out(`invalid repo: "${repo}". Use nome do repositório (ex: vite).`, true);
    const k = kind || "repo";
    if (!["repo", "releases", "commits", "issues"].includes(k)) return out(`invalid kind: "${kind}". Use repo|releases|commits|issues.`, true);
    try {
      new URL(`https://api.github.com/repos/${owner}/${repo}`);
    } catch {
      return out(`invalid repo URL para "${owner}/${repo}". Confira owner/repo.`, true);
    }
    const n = Math.min(Math.max(Number(limit) || 5, 1), 30);
    const base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    const url = k === "repo" ? base : k === "issues" ? `${base}/issues?state=open&per_page=${n}` : `${base}/${k}?per_page=${n}`;
    const ghToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    const headers = ghToken ? { authorization: `Bearer ${ghToken}` } : {};
    const TTL_GH_MS = 10 * 60 * 1000;
    const mKey = `memo:gh:${k}:${owner}/${repo}:${n}`;
    const mHit = memoGet(mKey);
    if (mHit) return mHit;
    const r = await cached(
      `gh:${k}:${owner}/${repo}:${n}`,
      TTL_GH_MS,
      () => fetchRetry(() => httpJson(url, { headers }), 3),
      (x) => x.status === 200
    );
    if (r.status === 403) {
      const err = out("GitHub rate limit exceeded (60 req/h sem token). Defina GITHUB_TOKEN/GH_TOKEN para mais.", true);
      memoSet(mKey, err, memoTtl(TTL_GH_MS, err));
      return err;
    }
    if (r.status !== 200) {
      const err = out(`GitHub API failed (HTTP ${r.status}): ${(r.text || "").slice(0, 200)}. Causa provável: repo inexistente ou rate-limit. Alternativa: confira owner/repo ou defina GITHUB_TOKEN.`, true);
      memoSet(mKey, err, memoTtl(TTL_GH_MS, err));
      return err;
    }
    if (k === "repo") {
      const d = r.data;
      const res = out(`${d.full_name} — ${d.description || "sem descrição"}\nstars: ${d.stargazers_count} | forks: ${d.forks_count} | open issues: ${d.open_issues_count}\nlanguage: ${d.language} | license: ${d.license?.spdx_id || "-"}\nupdated: ${d.updated_at}\nurl: ${d.html_url}`);
      memoSet(mKey, res, memoTtl(TTL_GH_MS, res));
      return res;
    }
    const items = Array.isArray(r.data) ? r.data.slice(0, n) : [];
    if (!items.length) {
      const res = out(`no ${k} found`);
      memoSet(mKey, res, memoTtl(TTL_GH_MS, res));
      return res;
    }
    if (k === "issues") {
      const res = out(items.map((it, i) => `${i + 1}. #${it.number} ${it.title} (${it.state || "open"} · ${it.comments ?? 0} comentários · ${it.created_at || "-"})`).join("\n"));
      memoSet(mKey, res, memoTtl(TTL_GH_MS, res));
      return res;
    }
    const res = out(items.map((it, i) => `${i + 1}. ${it.tag_name || it.name || (it.commit?.message || "").split("\n")[0]} (${it.published_at || it.created_at || it.commit?.author?.date || "-"})`).join("\n"));
    memoSet(mKey, res, memoTtl(TTL_GH_MS, res));
    return res;
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
    const raw = scope ? `${scope}/${pkg}` : String(pkg || "").trim();
    if (!raw) return out(`invalid package: "${pkg}". Use nome npm (ex: vite ou @scope/pkg).`, true);
    const npmRe = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
    if (!npmRe.test(raw.toLowerCase())) return out(`invalid package: "${raw}". Use nome npm válido (ex: vite, express, @opencode-ai/plugin).`, true);
    const name = raw;
    const TTL_NPM_MS = 60 * 60 * 1000;
    const mKey = `memo:npm:${name}`;
    const mHit = memoGet(mKey);
    if (mHit) return mHit;
    const [meta, dl] = await cached(
      `npm:${name}`,
      TTL_NPM_MS,
      () =>
        fetchRetry(() =>
          Promise.all([
            httpJson(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`),
            httpJson(`https://api.npmjs.org/downloads/point/last-month/${encodeURIComponent(name)}`),
          ]), 3
        ),
      (x) => x[0].status === 200
    );
    if (meta.status !== 200 || !meta.data) {
      const err = out(`npm registry failed (HTTP ${meta.status}): ${(meta.text || "").slice(0, 200)}. Causa provável: pacote inexistente ou instabilidade do registry. Alternativa: confira o nome em https://www.npmjs.com e tente de novo.`, true);
      memoSet(mKey, err, memoTtl(TTL_NPM_MS, err));
      return err;
    }
    const d = meta.data;
    const lines = [
      `${name}@${d.version}`,
      `description: ${d.description || "-"}`,
      `license: ${d.license || "-"} | deps: ${Object.keys(d.dependencies || {}).length} | bin: ${Object.keys(d.bin || {}).join(", ") || "-"}`,
      `engines: ${JSON.stringify(d.engines || {})}`,
      `dist.tarball: ${d.dist?.tarball || "-"}`,
    ];
    if (dl.data) lines.push(`downloads last month: ${dl.data.downloads.toLocaleString("pt-BR")}`);
    const res = out(lines.join("\n"));
    memoSet(mKey, res, memoTtl(TTL_NPM_MS, res));
    return res;
  },
});

