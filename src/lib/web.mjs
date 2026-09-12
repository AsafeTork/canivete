// canivete — web: fetch enxuto + search multi-backend + cache TTL
import { reg, out, trimOut, httpJson, escapeRe, UA } from "./ctx.mjs";

const ttlCache = new Map();
function cached(key, ttlMs, fn, ok) {
  const hit = ttlCache.get(key);
  if (hit && Date.now() - hit.ts < ttlMs) return Promise.resolve(hit.val);
  return Promise.resolve()
    .then(fn)
    .then((val) => {
      if (!ok || ok(val)) {
        // evita crescimento descontrolado: remove entradas expiradas primeiro
        if (ttlCache.size > 300) {
          const now = Date.now();
          for (const [k, v] of ttlCache) {
            if (now - v.ts >= ttlMs) ttlCache.delete(k);
            if (ttlCache.size <= 200) break;
          }
          if (ttlCache.size > 300) ttlCache.delete(ttlCache.keys().next().value);
        }
        ttlCache.set(key, { ts: Date.now(), val });
      }
      return val;
    });
}

const S = (s, n = 240) => (s ? String(s).replace(/\s+/g, " ").trim().slice(0, n) : "");
function probeMeta(html) {
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const og = html.match(/property=["']og:title["'][^>]*content=["']([^"']+)/i);
  return S(og?.[1] || t?.[1] || "", 160);
}

function mainContent(html) {
  const clean = html.replace(/<(script|style|noscript|header|footer|nav|aside)[\s\S]*?<\/\1>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");
  const m = clean.match(/<(?:article|main)[\s\S]*?<\/(?:article|main)>/i);
  return m ? m[0] : clean;
}

reg("n_webfetch", {
  description: "Baixa URL SEM JS e extrai texto principal (tenta <article>/<main>, com fallback p/ corpo). Retorna título, header (h1 + meta description) e links. Se SPA shell (<300 chars + >5 scripts) avisa SPA_DETECTADA: use n_browser_navigate. Site 100% JS / login-wall / preço dinâmico (Shopee, Amazon, Magalu logada)? NÃO use este — vá de n_browser_navigate (renderiza JS) ou n_ubrowser_* (sessão logada). Erro (inclui DNS) vira isError imediato; HTTP>=400 NÃO cacheia.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "URL a baixar" },
      format: { type: "string", enum: ["markdown", "text", "html"], default: "text", description: "Formato de saída" },
      maxChars: { type: "number", description: "Máx. caracteres do texto (500-60000, padrão 12000)" },
      timeout: { type: "number", default: 60000, description: "Timeout em ms (padrão 60000)" },
      links: { type: "boolean", default: true, description: "Extrair links (padrão true; false economiza)" },
    },
    required: ["url"],
  },
  run: async ({ url, format, maxChars, timeout, links }) => {
    const cap = Math.min(Math.max(Number(maxChars) || 12000, 500), 60000);
    const withLinks = links !== false;
    const key = `fetch:${url}:${format}:${cap}:${withLinks ? "links" : "nolinks"}`;
    const result = await cached(
      key,
      15 * 60 * 1000,
      async () => {
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), Number(timeout) || 60000);
        try {
          const res = await fetch(url, { signal: ac.signal, redirect: "follow", headers: { "user-agent": UA } });
          const raw = await res.text();
          if (res.status >= 400) return { err: `HTTP ${res.status} from ${url}\n${raw.slice(0, 1500)}` };
        const isHtml = /html/i.test(res.headers.get("content-type") || "");
        if (!isHtml) return { text: trimOut(raw, cap) };
        const core = mainContent(raw);
        const body = core
          .replace(/<[^>]+>/g, "\n")
          .replace(/&nbsp;/gi, " ")
          .replace(/&amp;/gi, "&")
          .replace(/&lt;/gi, "<")
          .replace(/&gt;/gi, ">")
          .replace(/&quot;/gi, '"')
          .replace(/&#39;/gi, "'")
          .replace(/&(?:rsquo|lsquo|ldquo|rdquo|ndash|mdash|hellip|middot|bull|apos);/g, (m) => ({ "&rsquo;": "'", "&lsquo;": "'", "&ldquo;": '"', "&rdquo;": '"', "&ndash;": "-", "&mdash;": "-", "&hellip;": "...", "&middot;": "·", "&bull;": "•", "&apos;": "'" })[m.toLowerCase()])
          .split("\n")
          .map((l) => l.replace(/\s+/g, " ").trim())
          .filter((l) => l.length > 1)
          .join("\n");
        const descM = raw.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)/i) || raw.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i);
        const ogDescM = raw.match(/property=["']og:description["'][^>]*content=["']([^"']+)/i);
        const h1M = raw.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
        const h1 = h1M ? h1M[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200) : "";
        const desc = S(descM?.[1] || ogDescM?.[1] || "", 300);
        const header = [h1, desc].filter(Boolean).join(" | ");
        const scriptCount = (raw.match(/<script\b/gi) || []).length;
        const spa = body.length < 300 && scriptCount > 5;
        let linksTxt = "";
        if (withLinks) {
          const seen = new Set();
          const items = [];
          const re = /<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
          let m;
          while ((m = re.exec(raw)) && items.length < 40) {
            let href = m[1].trim();
            if (!href || href.startsWith("#") || href.startsWith("javascript:")) continue;
            try { href = new URL(href, url).toString(); } catch {}
            if (seen.has(href)) continue;
            seen.add(href);
            const txt = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || href;
            items.push(`- ${txt} → ${href}`);
          }
          if (items.length) linksTxt = `\nLinks (${items.length}):\n${items.join("\n")}`;
        }
        const title = probeMeta(raw);
        const head = `${title ? title + "\n" : ""}${header ? header + "\n" : ""}${spa ? "SPA_DETECTADA: use n_browser_navigate\n" : ""}`;
        return { text: `${head}${format === "html" ? core : body}${linksTxt}`.slice(0, cap), title, header, spa };
      } catch (e) {
        return { err: `fetch failed: ${e.message}` };
      } finally {
        clearTimeout(t);
      }
      },
      (v) => !v.err
    );
    if (result.err) return out(result.err, true);
    return out(`URL ${url} (200)${result.title ? ` — ${result.title}` : ""}${result.header ? `\nHeader: ${result.header}` : ""}${result.spa ? "\nSPA_DETECTADA: use n_browser_navigate" : ""}\n${trimOut(result.text, cap)}`);
  },
});

async function searchNews(q, n, sinceDate) {
  // since: repassado como operador after:YYYY-MM-DD (suportado pelo Google News RSS).
  const qq = sinceDate ? `${q} after:${sinceDate}` : q;
  const r = await httpJson(`https://news.google.com/rss/search?q=${encodeURIComponent(qq)}&hl=pt-BR&gl=BR&ceid=BR:pt`, { timeout: 12000 });
  if (r.status !== 200) return null;
  const out = [];
  for (const b of r.text.split("<item>").slice(1)) {
    const t = b.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/s);
    const l = b.match(/<link>(.*?)<\/link>/s);
    const src = b.match(/<source[^>]*>(.*?)<\/source>/s);
    const pub = b.match(/<pubDate>(.*?)<\/pubDate>/s);
    if (!t || !l) continue;
    const bits = [];
    if (src) bits.push(`fonte: ${collapseHtml(src[1])}`);
    if (pub) bits.push(collapseHtml(pub[1]));
    out.push({ title: collapseHtml(t[1]), url: l[1].trim(), snippet: bits.join(" · ") });
    if (out.length >= n) break;
  }
  return out.length ? { source: "google-news", items: out } : null;
}

async function searchDdgInstant(q) {
  const r = await httpJson(`https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`, { timeout: 10000 });
  if (r.status !== 200) return null;
  const d = r.data || {};
  const items = [];
  if (d.AbstractText) items.push({ title: d.Heading || "DuckDuckGo", url: d.AbstractURL || "", snippet: S(d.AbstractText, 400) });
  for (const t of d.RelatedTopics || []) {
    if (t.Topics) for (const s of t.Topics) if (s.Text) items.push({ title: t.Name || "", url: s.FirstURL || "", snippet: S(s.Text, 260) });
    else if (t.Text) items.push({ title: t.Name || "", url: t.FirstURL || "", snippet: S(t.Text, 260) });
  }
  return items.length ? { source: "ddg-instant-answer", items } : null;
}

async function searchWikiExtract(q) {
  const r = await httpJson(
    `https://pt.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(q)}&gsrlimit=1&prop=extracts&exintro&explaintext&redirects=1&format=json&utf8=1`,
    { timeout: 12000 }
  );
  if (r.status !== 200 || !r.data?.query?.pages) return null;
  const page = r.data.query.pages[Object.keys(r.data.query.pages)[0]];
  if (!page?.extract) return null;
  return { source: "wikipedia-resumo", items: [{ title: page.title, url: `https://pt.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`, snippet: S(page.extract, 500) }] };
}

async function searchWiki(q, n) {
  const r = await httpJson(
    `https://pt.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=${n}&format=json&utf8=1`,
    { timeout: 12000 }
  );
  if (r.status !== 200 || !r.data?.query?.search?.length) return null;
  return {
    source: "wikipedia-pt",
    items: r.data.query.search.map((s) => ({
      title: s.title,
      url: `https://pt.wikipedia.org/wiki/${encodeURIComponent(s.title.replace(/ /g, "_"))}`,
      snippet: collapseHtml(s.snippet),
    })),
  };
}

async function searchHn(q, n, sinceMs) {
  // since: repassado via numericFilters=created_at_i> (suportado pela API Algolia HN).
  let url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=story&hitsPerPage=${n}`;
  if (sinceMs) url += `&numericFilters=created_at_i>${Math.floor(sinceMs / 1000)}`;
  const r = await httpJson(url, { timeout: 12000 });
  if (r.status !== 200 || !Array.isArray(r.data?.hits)) return null;
  return {
    source: "hacker-news",
    items: r.data.hits.map((h) => ({
      title: S(h.title),
      url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      snippet: `${h.points ?? 0} points · ${h.num_comments ?? 0} comments · ${h.author || ""}${h.created_at ? ` · ${String(h.created_at).slice(0, 10)}` : ""}`.trim(),
    })),
  };
}

async function searchGithub(q, n, sinceDate) {
  // since: repassado como qualificador pushed:>YYYY-MM-DD (suportado pela Search API do GitHub).
  const qq = sinceDate ? `${q} pushed:>${sinceDate}` : q;
  const r = await httpJson(`https://api.github.com/search/repositories?q=${encodeURIComponent(qq)}&per_page=${n}`, { timeout: 10000 });
  if (r.status !== 200 || !Array.isArray(r.data?.items)) return null;
  return {
    source: "github",
    items: r.data.items.map((it) => ({ title: it.full_name, url: it.html_url, snippet: `${S(it.description, 180)} | stars: ${it.stargazers_count}${it.pushed_at ? ` · ${String(it.pushed_at).slice(0, 10)}` : ""}`.trimStart() })),
  };
}

// Helpers de search: normalização de URL (dedupe), filtros site:/since:.
function normUrl(u) {
  try {
    const url = new URL(String(u || "").trim());
    let host = url.hostname.toLowerCase().replace(/^www\./, "");
    let path = url.pathname.replace(/\/+$/, "") || "";
    // ignora query de tracking e fragmento p/ dedupe entre backends
    url.searchParams.forEach((_, k) => {
      if (/^(utm_|fbclid|gclid|mc_|igsh)/i.test(k)) url.searchParams.delete(k);
    });
    const qs = url.searchParams.toString();
    return `${host}${path}${qs ? `?${qs}` : ""}`.toLowerCase();
  } catch {
    return String(u || "").trim().replace(/\/+$/, "").toLowerCase();
  }
}

function normSite(s) {
  return String(s || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
}

function siteMatches(url, site) {
  if (!site) return true;
  try {
    const host = new URL(String(url)).hostname.toLowerCase().replace(/^www\./, "");
    return host === site || host.endsWith(`.${site}`) || host.includes(site);
  } catch {
    return String(url || "").toLowerCase().includes(site);
  }
}

// Aceita "YYYY-MM-DD" ou ISO; retorna { ms, date } ou { ms: null, date: null }.
function parseSince(v) {
  if (v == null || v === "") return { ms: null, date: null };
  const s = String(v).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  const t = Date.parse(m ? m[1] : s);
  if (Number.isNaN(t)) return { ms: null, date: null, invalid: true };
  return { ms: t, date: m ? m[1] : new Date(t).toISOString().slice(0, 10) };
}

// Tenta extrair data do snippet (ISO, BR DD/MM/YYYY, "12 Jan 2024", pubDate RFC). Null = sem data detectável.
function snippetDateMs(snippet) {
  const s = String(snippet || "");
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}`);
    if (!Number.isNaN(t)) return t;
  }
  m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const t = Date.parse(`${m[3]}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`);
    if (!Number.isNaN(t)) return t;
  }
  m = s.match(/(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{4})/i);
  if (m) {
    const t = Date.parse(`${m[1]} ${m[2]} ${m[3]}`);
    if (!Number.isNaN(t)) return t;
  }
  const t = Date.parse(s);
  // Date.parse no snippet inteiro só vale se o snippet for quase só data (evita falso-positivo em números soltos)
  if (!Number.isNaN(t) && s.trim().length < 40) return t;
  return null;
}

function dedupeItems(groups) {
  const map = new Map();
  for (const g of groups) {
    for (const it of g.items || []) {
      const key = normUrl(it.url);
      if (!key) continue;
      const hit = map.get(key);
      if (!hit) {
        map.set(key, { title: it.title, url: it.url, snippet: it.snippet || "", fontes: [g.source] });
      } else {
        if (!hit.fontes.includes(g.source)) hit.fontes.push(g.source);
        // mantém o snippet mais informativo em caso de conflito
        if ((it.snippet || "").length > (hit.snippet || "").length) hit.snippet = it.snippet;
        if (!hit.title && it.title) hit.title = it.title;
      }
    }
  }
  return [...map.values()];
}

reg("n_websearch", {
  description: "Busca web gratuita (7 backends paralelos: Google News RSS, DDG Instant Answer, Wikipedia pt resumo+títulos, HN, GitHub, DDG HTML; deduplicada por URL, cache 10min). Quando usar: pesquisar doc/bug/biblioteca. Filtros: site restringe ao domínio (URL contém o domínio); since (YYYY-MM-DD) é repassado onde o backend suporta (News via after:, HN via numericFilters, GitHub via pushed:>) e nos demais filtra só quando o snippet contém data reconhecível — sem data detectável o item é mantido (limite documentado). fresh:true pula o cache e força re-busca. Limite: numResults é teto POR FONTE, não total; preços em snippet podem estar desatualizados (confirme ao vivo).",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Termos da busca (obrigatório)." },
      numResults: { type: "number", default: 8, description: "Teto de resultados POR FONTE (1-20, padrão 8)." },
      site: { type: "string", description: "Filtra resultados cujo URL contém este domínio. Ex: github.com, pt.wikipedia.org. Vazio = sem filtro." },
      since: { type: "string", description: "Só resultados desde esta data (YYYY-MM-DD ou ISO). Repassado a News/HN/GitHub; nos demais backends filtra pelo snippet quando houver data, senão mantém. Formato inválido = erro." },
      fresh: { type: "boolean", default: false, description: "Se true, pula o cache de 10min e força re-busca ao vivo." },
    },
    required: ["query"],
  },
  run: async ({ query, numResults, site, since, fresh }) => {
    const q = String(query || "").trim();
    if (!q) return out("query is required", true);
    const n = Math.min(Math.max(Number(numResults) || 8, 1), 20);
    const qClean = q.replace(/["“”]/g, " ").replace(/\s+/g, " ").trim();
    const siteNorm = normSite(site);
    const parsedSince = parseSince(since);
    if (since != null && String(since).trim() !== "" && (parsedSince.invalid || parsedSince.ms == null))
      return out("since inválido: use YYYY-MM-DD ou data ISO (ex: 2024-01-01)", true);
    const sinceMs = parsedSince.ms;
    const sinceDate = parsedSince.date;
    const key = `search:${qClean}:${n}:${siteNorm || "-"}:${sinceDate || "-"}`;
    const fetchGroups = async () => {
      const attempt = async (qq) => {
        const settled = await Promise.allSettled([
          searchNews(qq, 4, sinceDate),
          searchDdgInstant(qq),
          searchWikiExtract(qq),
          searchWiki(qq, n),
          searchHn(qq, 4, sinceMs),
          searchGithub(qq, 4, sinceDate),
          httpJson(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(qq)}`, { timeout: 12000 }).then((r) =>
            r.status === 200 ? { source: "duckduckgo", items: parseDdg(r.text).slice(0, n) } : null
          ),
        ]);
        return settled.filter((s) => s.status === "fulfilled" && s.value?.items?.length).map((s) => s.value);
      };
      let list = await attempt(qClean);
      if (!list.length) {
        const short = qClean.split(/\s+/).slice(0, 4).join(" ");
        if (short && short !== qClean) list = await attempt(short);
      }
      return list;
    };
    // fresh:true pula a leitura do cache (força re-busca) mas atualiza o cache p/ próximas chamadas.
    let groups;
    if (fresh) {
      groups = await fetchGroups();
      if (groups.length) ttlCache.set(key, { ts: Date.now(), val: groups });
    } else {
      groups = await cached(key, 10 * 60 * 1000, fetchGroups);
    }
    if (!groups.length) return out(`no results for "${q}"`);
    // 1) site: filtra por domínio (URL contém o domínio normalizado)
    let filtered = siteNorm
      ? groups.map((g) => ({ source: g.source, items: (g.items || []).filter((it) => siteMatches(it.url, siteNorm)) })).filter((g) => g.items.length)
      : groups;
    // 2) since (fallback): onde o backend não suporta, filtra pelo snippet quando há data reconhecível;
    // sem data detectável o item é mantido (limite documentado na description).
    if (sinceMs) {
      filtered = filtered
        .map((g) => {
          // backends com repasse nativo já filtram no servidor: google-news, hacker-news, github
          if (g.source === "google-news" || g.source === "hacker-news" || g.source === "github") return g;
          return { source: g.source, items: (g.items || []).filter((it) => {
            const d = snippetDateMs(it.snippet);
            return d == null || d >= sinceMs;
          }) };
        })
        .filter((g) => g.items.length);
    }
    if (!filtered.length) return out(`no results for "${q}"${siteNorm ? ` (site:${siteNorm})` : ""}${sinceDate ? ` (since:${sinceDate})` : ""}`);
    // 3) dedupe por URL normalizada entre backends (mesma URL em 2 fontes => 1 item com fontes:[...])
    const items = dedupeItems(filtered);
    if (!items.length) return out(`no results for "${q}"`);
    const srcs = [...new Set(filtered.map((g) => g.source))].join(", ");
    const cacheTag = fresh ? "fresh" : "cached 10min";
    const blocks = items.map((it, i) => `${i + 1}. ${it.title}\n   ${it.url}\n   ${it.snippet}\n   fontes: [${it.fontes.join(", ")}]\n`).join("");
    return out(`${items.length} results for "${q}" (${cacheTag}, sources: ${srcs}${siteNorm ? `, site:${siteNorm}` : ""}${sinceDate ? `, since:${sinceDate}` : ""})\n` + blocks + `\nTip: use n_webfetch to read a page's main content (maxChars caps token cost).`);
  },
});

function parseDdg(html) {
  const items = [];
  const blocks = html.split('class="result__a"');
  for (let i = 1; i < blocks.length; i++) {
    const b = blocks[i];
    const title = b.match(/>([^<]*)<\/a>/);
    const href = b.match(/href="([^"]+)"/);
    const snippet = b.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    if (!href) continue;
    const uddg = href[1].match(/uddg=([^&]+)/);
    items.push({
      title: title ? title[1].trim() : "",
      url: uddg ? decodeURIComponent(uddg[1]) : href[1],
      snippet: snippet ? collapseHtml(snippet[1]) : "",
    });
  }
  return items;
}

function collapseHtml(s) {
  return s.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();
}

export { probeMeta, mainContent, cached };
