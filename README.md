# Agent Wormhole

Agent Wormhole creates one-time sealed handoffs for autonomous workers.

Email gives agents inboxes. Chat gives agents threads. Wormholes give agents
temporary transfer channels that collapse after use.

```bash
agent-wormhole send --file ./artifact.zip --note "handoff for research agent"
```

Output:

```text
Wormhole open: echo-river-47.d8xPMr6mgE6RQv-4k9jT1Fx3mZt7h1wd
Expires: 2026-05-19T18:22:00.000Z
```

Receiver:

```bash
agent-wormhole receive echo-river-47.d8xPMr6mgE6RQv-4k9jT1Fx3mZt7h1wd --out ./received
```

## Why It Exists

Agents do not always need another inbox. Sometimes they need a sealed handoff:

- one-time mission briefs
- scoped secrets
- temporary artifacts
- Agent Pack bundles
- receipts
- config drops between sandboxes

The MVP encrypts payloads before storage, stores only ciphertext, allows one
claim by default, and writes a receipt.

Codes are split into `id.secret`. The `id` locates metadata; the `secret`
derives the decrypt key and is never written to storage.

## Commands

```bash
agent-wormhole send --text "mission brief"
agent-wormhole send --file ./bundle.tgz --ttl 10m
agent-wormhole receive <code> --out ./received
agent-wormhole inspect <code>
agent-wormhole cleanup --delete-claimed-older-than 15m
agent-wormhole serve --port 8787
```

## First Release Scope

- local filesystem store
- one-time transfer codes
- AES-256-GCM encrypted payloads
- text and file payloads
- TTL expiry
- single-claim default
- JSON receipts
- hard payload and TTL limits
- cleanup for expired and claimed drops
- small HTTP API for VPS deployment

## API Health

```bash
agent-wormhole serve --host 127.0.0.1 --port 8791 --store /home/dustin/apps/agent-wormhole/.store --max-payload 5mb --max-ttl 24h
curl http://127.0.0.1:8791/health
```

## Safety Defaults

- default TTL: 10 minutes
- max TTL: 24 hours
- max payload: 5 MB
- one claim per wormhole
- filename sanitization for received payloads

## Public Access Model

- `$ECHO` holders can open wormholes through the direct API with a signed holder
  proof. Threshold: `50,000,000 ECHO`.
- Non-holders use the Bankr x402 cloud endpoint.
- Claiming a wormhole is free.
- Receipts mark the access path as `echo_holder`, `x402_paid`, or `local`.

## Docs

- [CLI](docs/CLI.md)
- [API](docs/API.md)
- [VPS notes](docs/VPS.md)
