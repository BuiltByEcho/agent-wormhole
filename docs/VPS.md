# VPS Deployment Notes

The first API can run as a plain Node service:

```bash
agent-wormhole serve --host 127.0.0.1 --port 8791 --store /home/dustin/apps/agent-wormhole/.store --max-payload 5mb --max-ttl 24h
```

Put Nginx or Caddy in front of it and proxy:

```text
/v1/wormholes -> http://127.0.0.1:8791
```

Also proxy `/health` for deploy checks.

Current first VPS staging uses PM2 process `agent-wormhole` on localhost port
`8791`. Public Caddy routing is intentionally not enabled yet.

The current public upstream route is:

```text
https://storage.builtbyecho.xyz/agent-wormhole
```

Unauthenticated opens return payment-required guidance. Bankr x402 paid opens
proxy to this route. `$ECHO` holder opens can also use this route directly with
a signed holder proof.

Deploy from the local project:

```bash
scripts/deploy-vps.sh
```

The deploy script runs tests, syntax checks, rsyncs to the VPS, restarts PM2,
and performs a remote open/claim/second-claim smoke test.

The deploy script requires `AGENT_WORMHOLE_BANKR_PROXY_TOKEN` in the local
environment.

## Cleanup

The VPS has a user crontab entry:

```cron
*/15 * * * * cd /home/dustin/apps/agent-wormhole && node src/cli.js cleanup --store /home/dustin/apps/agent-wormhole/.store --delete-claimed-older-than 15m --json >> /home/dustin/.pm2/logs/agent-wormhole-cleanup.log 2>&1
```

Expired records are removed. Claimed records are removed after 15 minutes.
Receipts are retained.

## Storage

The MVP uses local filesystem storage. That is enough for:

- proof-of-concept demos
- short TTL sealed drops
- internal agent-to-agent tests

For production, swap the storage adapter to Redis, SQLite, or object storage
while preserving the same code/claim/receipt contract.

## Safety Defaults

- short TTLs
- one claim
- encrypted payloads at rest
- no directory listing endpoint
- no plaintext in metadata
- full claim code is `id.secret`; the secret is never stored
