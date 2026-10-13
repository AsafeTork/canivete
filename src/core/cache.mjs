// canivete core/cache — single TTL cache source of truth (zero deps).
// Unifica web.mjs:cached (size>300, prune expirados) + apis.mjs:memo (exp + negative-cache).
// Comportamento preservado por caller via parâmetros; sem mudança de resultados.
const DEFAULT_MAX = 500;

export function createTtlCache({ max = DEFAULT_MAX } = {}) {
  const map = new Map();
  function get(key) {
    const hit = map.get(key);
    if (!hit) return undefined;
    if (Date.now() > hit.exp) {
      map.delete(key);
      return undefined;
    }
    return hit.val;
  }
  function set(key, val, ttlMs) {
    if (map.size >= max) map.delete(map.keys().next().value);
    map.set(key, { exp: Date.now() + ttlMs, ts: Date.now(), val });
  }
  function prune() {
    const now = Date.now();
    for (const [k, v] of map) {
      if (v.exp < now) map.delete(k);
      if (map.size <= 200) break;
    }
  }
  return { map, get, set, prune, get size() { return map.size; } };
}

// Cache global compatível com web.mjs:cached(key, ttlMs, fn, ok?).
// Semântica idêntica: hit fresco retorna; só grava se !ok || ok(val);
// poda expirados quando size>300 até <=200, senão evict FIFO.
const globalCache = new Map();
export function cached(key, ttlMs, fn, ok) {
  const hit = globalCache.get(key);
  if (hit && Date.now() - hit.ts < ttlMs) return Promise.resolve(hit.val);
  return Promise.resolve()
    .then(fn)
    .then((val) => {
      if (!ok || ok(val)) {
        if (globalCache.size > 300) {
          const now = Date.now();
          for (const [k, v] of globalCache) {
            if (now - v.ts >= ttlMs) globalCache.delete(k);
            if (globalCache.size <= 200) break;
          }
          if (globalCache.size > 300) globalCache.delete(globalCache.keys().next().value);
        }
        globalCache.set(key, { ts: Date.now(), val });
      }
      return val;
    });
}

// Escrita direta p/ fresh:true (mesma poda que cached()).
export function cacheSet(key, val, ttlMs) {
  if (globalCache.size > 300) {
    const now = Date.now();
    for (const [k, v] of globalCache) {
      if (now - v.ts >= ttlMs) globalCache.delete(k);
      if (globalCache.size <= 200) break;
    }
    if (globalCache.size > 300) globalCache.delete(globalCache.keys().next().value);
  }
  globalCache.set(key, { ts: Date.now(), val });
}

// Negative-cache curto p/ falhas (apis.mjs:memoTtl): erro usa min(base, 60s).
export const TTL_NEG_MS = 60 * 1000;
export function memoTtl(baseTtlMs, val) {
  return val?.isError ? Math.min(baseTtlMs, TTL_NEG_MS) : baseTtlMs;
}
