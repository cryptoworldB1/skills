# Crypto Market Data Sources

## Binance Spot

Best for realtime trading data and OHLCV K-lines.

- Realtime endpoint: `/api/v3/ticker/24hr`
- Historical endpoint: `/api/v3/klines`
- No API key required for public spot market data.
- Does not provide project-level market cap, circulating supply, FDV, or coin genesis date.
- Historical data starts when the exact spot pair listed on Binance, not when the coin first existed.

## CoinGecko

Best for project-level full price history and public metadata.

- Market chart endpoint: `/api/v3/coins/{id}/market_chart`
- `days=max` gives broad project price history when available.
- Coin id is required (`bitcoin`, `ethereum`, `solana`, etc.); symbol alone can be ambiguous.
- Public/free access can be rate-limited.

## CoinMarketCap

Best for market cap, rank, circulating supply, FDV, and exchange-independent asset metadata.

- Requires `CMC_API_KEY`.
- Use for market-cap accuracy when Binance and CoinGecko differ.

## Practical Rule

For a chart inside a trading product, default to Binance K-lines. For “全部历史价格”, prefer CoinGecko `days=max` if the coin id is known. For market cap and supply, use CMC or CoinGecko metadata, not Binance.
