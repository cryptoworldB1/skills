#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_BINANCE_BASE_URL = "https://api.binance.com";
const DEFAULT_COINGECKO_BASE_URL = "https://api.coingecko.com/api/v3";
const QUOTE_PRIORITY = ["USDT", "USDC", "FDUSD"];
const RANGE_TO_DAYS = {
  "1d": 1,
  "7d": 7,
  "1w": 7,
  "30d": 30,
  "1m": 30,
  "90d": 90,
  "3m": 90,
  "180d": 180,
  "6m": 180,
  "1y": 365,
  "5y": 365 * 5,
  "10y": 365 * 10,
  max: "max",
  all: "max",
};

export async function fetchCryptoMarketData(options = {}) {
  await loadDotEnvIfPresent(options.envPath);
  await configureProxyIfAvailable();
  const symbol = normalizeSymbol(options.symbol || options.base || options._?.[0]);
  const realtime = Boolean(options.realtime ?? (!options.historyOnly && !options.historySourceOnly));
  const history = Boolean(options.history ?? options.interval ?? options.range ?? options.historySource);
  const historySource = String(options.historySource || "binance").toLowerCase();
  const interval = options.interval || "1d";
  const range = normalizeRange(options.range || "1y");
  const quoteAssets = normalizeQuoteAssets(options.quote);
  const errors = [];
  let pairInfo;

  if (!symbol) throw new Error("Missing symbol. Example: BTC, ETH, SOL.");

  if (historySource === "binance" || realtime) {
    try {
      pairInfo = await resolveBinanceSpotPair(symbol, { quoteAssets, baseUrl: options.binanceBaseUrl });
    } catch (error) {
      errors.push(toError("BINANCE_PAIR_RESOLVE_FAILED", error));
    }
  }

  const output = {
    generatedAt: new Date().toISOString(),
    query: {
      symbol,
      pair: pairInfo?.symbol ?? null,
      quoteAsset: pairInfo?.quoteAsset ?? quoteAssets[0],
      interval,
      range,
      historySource,
    },
    realtime: null,
    history: null,
    errors,
  };

  if (realtime) {
    try {
      if (!pairInfo) throw new Error(`No Binance spot pair found for ${symbol}.`);
      output.realtime = await fetchBinanceRealtime(pairInfo.symbol, { baseUrl: options.binanceBaseUrl });
    } catch (error) {
      output.errors.push(toError("BINANCE_REALTIME_FAILED", error));
    }
  }

  if (history) {
    if (historySource === "coingecko") {
      try {
        const coinId = options.coinId || options.coinGeckoId;
        if (!coinId) throw new Error("CoinGecko history requires --coin-id, e.g. --coin-id bitcoin.");
        output.history = await fetchCoinGeckoHistory(coinId, { range, vsCurrency: options.vsCurrency, baseUrl: options.coinGeckoBaseUrl });
      } catch (error) {
        output.errors.push(toError("COINGECKO_HISTORY_FAILED", error));
      }
    } else {
      try {
        if (!pairInfo) throw new Error(`No Binance spot pair found for ${symbol}.`);
        output.history = await fetchBinanceKlines(pairInfo.symbol, {
          interval,
          range,
          baseUrl: options.binanceBaseUrl,
          limit: options.limit,
        });
      } catch (error) {
        output.errors.push(toError("BINANCE_HISTORY_FAILED", error));
      }
    }
  }

  return output;
}

export async function resolveBinanceSpotPair(symbol, options = {}) {
  const baseUrl = options.baseUrl || DEFAULT_BINANCE_BASE_URL;
  const quoteAssets = options.quoteAssets?.length ? options.quoteAssets : QUOTE_PRIORITY;
  const info = await fetchJson(`${baseUrl}/api/v3/exchangeInfo`);
  const candidates = new Map();
  for (const item of info.symbols || []) {
    if (item.status !== "TRADING" || item.baseAsset !== symbol) continue;
    if (!item.isSpotTradingAllowed) continue;
    candidates.set(item.quoteAsset, item);
  }
  for (const quote of quoteAssets) {
    if (candidates.has(quote)) return candidates.get(quote);
  }
  const first = [...candidates.values()][0];
  if (first) return first;
  throw new Error(`No active Binance spot pair found for ${symbol}.`);
}

export async function fetchBinanceRealtime(pair, options = {}) {
  const baseUrl = options.baseUrl || DEFAULT_BINANCE_BASE_URL;
  const ticker = await fetchJson(`${baseUrl}/api/v3/ticker/24hr?symbol=${encodeURIComponent(pair)}`);
  return {
    source: "Binance Spot",
    pair,
    currentPrice: toNumber(ticker.lastPrice),
    priceChange24h: toNumber(ticker.priceChange),
    priceChangePercentage24h: toNumber(ticker.priceChangePercent),
    openPrice24h: toNumber(ticker.openPrice),
    high24h: toNumber(ticker.highPrice),
    low24h: toNumber(ticker.lowPrice),
    volumeBase24h: toNumber(ticker.volume),
    volumeQuote24h: toNumber(ticker.quoteVolume),
    tradeCount24h: ticker.count ?? null,
    observedAt: ticker.closeTime ? new Date(ticker.closeTime).toISOString() : new Date().toISOString(),
    raw: ticker,
  };
}

export async function fetchBinanceKlines(pair, options = {}) {
  const baseUrl = options.baseUrl || DEFAULT_BINANCE_BASE_URL;
  const interval = options.interval || "1d";
  const range = normalizeRange(options.range || "1y");
  const limit = clampInteger(options.limit, 1, 1000) || 1000;
  const now = Date.now();
  let startTime = range === "max" ? 0 : now - Number(RANGE_TO_DAYS[range] || 365) * 86_400_000;
  const candles = [];

  while (true) {
    const url = new URL(`${baseUrl}/api/v3/klines`);
    url.searchParams.set("symbol", pair);
    url.searchParams.set("interval", interval);
    url.searchParams.set("limit", String(limit));
    if (startTime) url.searchParams.set("startTime", String(startTime));
    const rows = await fetchJson(url);
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const row of rows) candles.push(mapBinanceKline(row, pair, interval));
    const lastOpenTime = rows[rows.length - 1]?.[0];
    if (!lastOpenTime || rows.length < limit || lastOpenTime >= now) break;
    startTime = lastOpenTime + intervalToMilliseconds(interval);
    await sleep(80);
  }

  return {
    source: "Binance Spot",
    pair,
    interval,
    range,
    pointCount: candles.length,
    startsAt: candles[0]?.openTime ?? null,
    endsAt: candles.at(-1)?.openTime ?? null,
    candles,
  };
}

export async function fetchCoinGeckoHistory(coinId, options = {}) {
  const baseUrl = options.baseUrl || DEFAULT_COINGECKO_BASE_URL;
  const vsCurrency = options.vsCurrency || "usd";
  const range = normalizeRange(options.range || "max");
  const days = RANGE_TO_DAYS[range] || range;
  const url = new URL(`${baseUrl}/coins/${encodeURIComponent(coinId)}/market_chart`);
  url.searchParams.set("vs_currency", vsCurrency);
  url.searchParams.set("days", String(days));
  const payload = await fetchJson(url);
  const prices = Array.isArray(payload.prices)
    ? payload.prices.map(([time, value]) => ({ time, date: new Date(time).toISOString().slice(0, 10), value: toNumber(value) }))
    : [];
  return {
    source: "CoinGecko",
    coinId,
    vsCurrency,
    range,
    pointCount: prices.length,
    startsAt: prices[0]?.date ?? null,
    endsAt: prices.at(-1)?.date ?? null,
    prices,
    marketCaps: mapCoinGeckoSeries(payload.market_caps),
    totalVolumes: mapCoinGeckoSeries(payload.total_volumes),
  };
}

function mapBinanceKline(row, pair, interval) {
  return {
    source: "Binance Spot",
    pair,
    interval,
    openTime: new Date(row[0]).toISOString(),
    open: toNumber(row[1]),
    high: toNumber(row[2]),
    low: toNumber(row[3]),
    close: toNumber(row[4]),
    volume: toNumber(row[5]),
    closeTime: new Date(row[6]).toISOString(),
    quoteVolume: toNumber(row[7]),
    tradeCount: row[8],
  };
}

function mapCoinGeckoSeries(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map(([time, value]) => ({ time, date: new Date(time).toISOString().slice(0, 10), value: toNumber(value) }));
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "xninth-crypto-market-data-skill/1.0",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    const message = typeof payload === "object" && payload?.msg ? payload.msg : text || response.statusText;
    throw new Error(`${response.status} ${message}`);
  }
  return payload;
}

async function configureProxyIfAvailable() {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
  if (!proxyUrl || configureProxyIfAvailable.done) return;
  configureProxyIfAvailable.done = true;
  try {
    const requireFromCwd = createRequire(path.join(process.cwd(), "package.json"));
    const undici = requireFromCwd("undici");
    undici.setGlobalDispatcher(new undici.ProxyAgent(proxyUrl));
  } catch (error) {
    // Node's global fetch does not always honor proxy env vars. If undici is
    // unavailable, continue direct and let the request error surface normally.
    if (process.env.DEBUG_CRYPTO_MARKET_DATA) {
      console.warn(`[crypto-market-data] proxy configured but undici ProxyAgent unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function loadDotEnvIfPresent(envPath) {
  const target = envPath || path.join(process.cwd(), ".env");
  try {
    const text = await readFile(target, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key] !== undefined) continue;
      process.env[key] = rawValue.trim().replace(/^['"]|['"]$/g, "");
    }
  } catch {
    // .env is optional.
  }
}

function normalizeSymbol(value) {
  return String(value || "")
    .trim()
    .replace(/[-_/].*$/, "")
    .toUpperCase();
}

function normalizeQuoteAssets(quote) {
  if (!quote) return QUOTE_PRIORITY;
  const values = Array.isArray(quote) ? quote : String(quote).split(",");
  return values.map((item) => item.trim().toUpperCase()).filter(Boolean);
}

function normalizeRange(range) {
  const value = String(range || "1y").trim().toLowerCase();
  return RANGE_TO_DAYS[value] ? value : "1y";
}

function intervalToMilliseconds(interval) {
  const match = String(interval).match(/^(\d+)([mhdwM])$/);
  if (!match) return 86_400_000;
  const amount = Number(match[1]);
  const unit = match[2];
  if (unit === "m") return amount * 60_000;
  if (unit === "h") return amount * 3_600_000;
  if (unit === "d") return amount * 86_400_000;
  if (unit === "w") return amount * 7 * 86_400_000;
  return amount * 30 * 86_400_000;
}

function clampInteger(value, min, max) {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) return undefined;
  return Math.max(min, Math.min(max, number));
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toError(code, error) {
  return {
    code,
    message: error instanceof Error ? error.message : String(error),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseCliArgs(argv) {
  const options = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      options._.push(arg);
      continue;
    }
    const key = arg.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
      continue;
    }
    options[key] = next;
    index += 1;
  }
  return options;
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  if (!options.realtime && !options.history) {
    options.realtime = true;
    options.history = true;
  }
  if (options.source && !options.historySource) options.historySource = options.source;
  const payload = await fetchCryptoMarketData(options);
  const json = `${JSON.stringify(payload, null, 2)}\n`;
  if (options.out) {
    await writeFile(options.out, json, "utf8");
  } else {
    process.stdout.write(json);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(JSON.stringify(toError("CRYPTO_MARKET_DATA_FAILED", error), null, 2));
    process.exitCode = 1;
  });
}
