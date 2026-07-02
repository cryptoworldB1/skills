# Codex Skills

Reusable Codex/OpenClaw skills for 第九社区 and related crypto research projects.

## Skills

- `crypto-market-data`: Fetch Binance realtime spot data and Binance/CoinGecko historical crypto market data.

## Layout

Each skill lives in its own top-level folder and contains a required `SKILL.md` plus optional bundled resources such as `scripts/` and `references/`.

## Publish To ClawHub

Install the ClawHub CLI, authenticate, then publish a skill folder:

```bash
npm install -g @openclaw/clawhub
clawhub skill publish crypto-market-data
```

ClawHub web import requires the GitHub repository to be public, non-fork, and accessible to the connected GitHub App. If this repository stays private, publish through the CLI after authenticating locally.
