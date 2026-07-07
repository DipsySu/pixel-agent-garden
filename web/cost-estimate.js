// Frontend cost estimate helpers for the data drawer's Cost tab.
//
// This mirrors core::prices::estimate: rates come only from the local price
// table; split input/output tokens are priced precisely; unsplit total-only
// remainders use an explicit blended rate; cache tokens are counted but not
// priced; unknown models are surfaced as unpriced tokens, never guessed.

export function estimateCost(tokensByModel, priceTable) {
  const prices = priceTable?.prices && typeof priceTable.prices === 'object'
    ? priceTable.prices
    : {};
  const byModel = {};
  let totalUsd = 0;
  let unpricedTokens = 0;

  for (const [model, rawUsage] of Object.entries(tokensByModel || {})) {
    const usage = normalizeUsage(rawUsage);
    const price = prices[model];
    if (!price || !Number.isFinite(price.input_per_mtok) || !Number.isFinite(price.output_per_mtok)) {
      unpricedTokens += usage.total_tokens;
      continue;
    }

    const cacheTokens = usage.cache_read_tokens + usage.cache_write_tokens;
    const splitTokens = usage.input_tokens + usage.output_tokens + cacheTokens;
    const blendedTokens = Math.max(0, usage.total_tokens - splitTokens);
    const blendedRate = (price.input_per_mtok + price.output_per_mtok) / 2;
    const usd =
      perMtok(usage.input_tokens, price.input_per_mtok) +
      perMtok(usage.output_tokens, price.output_per_mtok) +
      perMtok(blendedTokens, blendedRate);
    totalUsd += usd;
    byModel[model] = {
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      blended_tokens: blendedTokens,
      cache_tokens: cacheTokens,
      total_tokens: usage.total_tokens,
      usd,
    };
  }

  return { total_usd: totalUsd, by_model: byModel, unpriced_tokens: unpricedTokens };
}

export function normalizeUsage(value) {
  const usage = value && typeof value === 'object' ? value : {};
  const input = uint(usage.input_tokens);
  const output = uint(usage.output_tokens);
  const cacheRead = uint(usage.cache_read_tokens);
  const cacheWrite = uint(usage.cache_write_tokens);
  const total = uint(usage.total_tokens);
  return {
    input_tokens: input,
    output_tokens: output,
    cache_read_tokens: cacheRead,
    cache_write_tokens: cacheWrite,
    total_tokens: total || input + output + cacheRead + cacheWrite,
  };
}

export function modelTotalTokens(usage) {
  return normalizeUsage(usage).total_tokens;
}

export function formatUsd(value) {
  const n = Number(value || 0);
  // Locale pinned to 'en' like the repo's other number formatters: with the
  // browser default, de/nl/es grouping renders $1,235 as "$1.235" — a 1000x
  // misread on a money figure (review finding).
  if (n >= 1000) return '$' + n.toLocaleString('en', { maximumFractionDigits: 0 });
  if (n >= 100) return '$' + n.toFixed(1);
  return '$' + n.toFixed(2);
}

function perMtok(tokens, rate) {
  return tokens / 1_000_000 * rate;
}

function uint(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}
