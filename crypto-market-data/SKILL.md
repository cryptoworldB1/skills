---
name: crypto-market-data
description: Fetch reusable cryptocurrency realtime spot prices and historical price/K-line data for a symbol or coin id. Use when a user asks to get crypto realtime data, historical candles, full price history, Binance spot data, CoinGecko market-chart data, or wants to reuse market data in another project.
---

# Crypto Market Data

Use this skill to retrieve clean JSON market data that can be copied into any project.

## Quick Start

Run the bundled Node script:

```bash
node ~/.codex/skills/crypto-market-data/scripts/fetch-market-data.mjs BTC --realtime --history --interval 1d --range max
```

Import it from another Node project:

```js
import { fetchCryptoMarketData } from "~/.codex/skills/crypto-market-data/scripts/fetch-market-data.mjs";

const data = await fetchCryptoMarketData({
  symbol: "BTC",
  realtime: true,
  history: true,
  interval: "1d",
  range: "max",
});
```

## Source Selection

- Use `--history-source binance` for exchange K-lines. This is best for trading charts, but history starts when the pair listed on Binance.
- Use `--history-source coingecko --coin-id bitcoin --range max` for coin/project price history. This is better when the user asks for “全部历史价格”.
- Use Binance realtime for spot ticker data when the asset has a liquid `USDT`, `USDC`, or `FDUSD` spot pair.
- Do not invent market cap, supply, or history. If a source is missing, return an error or mark the field missing.

## Common Commands

Realtime only:

```bash
node ~/.codex/skills/crypto-market-data/scripts/fetch-market-data.mjs SOL --realtime
```

Binance full K-line history:

```bash
node ~/.codex/skills/crypto-market-data/scripts/fetch-market-data.mjs ETH --history --interval 1d --range max --history-source binance
```

CoinGecko full price history:

```bash
node ~/.codex/skills/crypto-market-data/scripts/fetch-market-data.mjs BTC --history --history-source coingecko --coin-id bitcoin --range max
```

Write JSON to a file:

```bash
node ~/.codex/skills/crypto-market-data/scripts/fetch-market-data.mjs TRUMP --realtime --history --range 30d --out trump-market.json
```

## Output Shape

The script returns:

- `query`: requested symbol, pair, interval, range and source choice.
- `realtime`: latest spot ticker from Binance when requested.
- `history`: candle/price series with source metadata.
- `errors`: non-fatal source errors.

Read `references/data-sources.md` when deciding between Binance, CoinGecko, and CMC semantics.
