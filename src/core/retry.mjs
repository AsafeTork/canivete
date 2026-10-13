// canivete core/retry — sleep + fetchRetry unificados (zero deps).
// web.mjs: tries=2 delays 1000,2000 (converte throw em {status:0});
// apis.mjs: tries=3 delays 500,2000 (rethrow no fim, só retry em transitório).
// Esta versão parametrizada preserva ambos via defaults do caller.
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const isTransientStatus = (s) => s === 0 || s === 429 || (s >= 500 && s < 600);

export async function fetchRetry(fn, triesOrOpts = 3, maybeDelays) {
  // Compat: fetchRetry(fn, 2) | fetchRetry(fn, 3) | fetchRetry(fn, {tries, delays, swallowThrow})
  let tries = 3, delays = [500, 2000], swallowThrow = false;
  if (typeof triesOrOpts === "number") {
    tries = triesOrOpts;
    // preserva os defaults históricos por tries: 2 → web (1000,2000 + swallow), 3 → apis (500,2000 + throw)
    if (tries === 2 && maybeDelays === undefined) { delays = [1000, 2000]; swallowThrow = true; }
  } else if (triesOrOpts && typeof triesOrOpts === "object") {
    tries = triesOrOpts.tries ?? 3;
    delays = triesOrOpts.delays ?? delays;
    swallowThrow = triesOrOpts.swallowThrow ?? false;
  }
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      last = await fn();
      if (last && typeof last.status === "number") {
        if (isTransientStatus(last.status) && i < tries - 1) {
          await sleep(delays[i] ?? 2000);
          continue;
        }
      }
      return last;
    } catch (e) {
      if (swallowThrow) {
        last = { status: 0, data: null, text: e?.message || "fetch error" };
        if (i === tries - 1) return last;
        await sleep(delays[i] ?? 2000);
        continue;
      }
      if (i === tries - 1) throw e;
      await sleep(delays[i] ?? 2000);
    }
  }
  return last;
}

// Atalhos com os defaults históricos (evitam drift nos call sites):
export const webFetchRetry = (fn) => fetchRetry(fn, { tries: 2, delays: [1000, 2000], swallowThrow: true });
export const apiFetchRetry = (fn) => fetchRetry(fn, { tries: 3, delays: [500, 2000], swallowThrow: false });
