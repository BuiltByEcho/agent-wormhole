# Agent Wormhole CLI

## Send Text

```bash
agent-wormhole send --text "ship this to the next agent"
```

## Send a File

```bash
agent-wormhole send --file ./artifact.tgz --note "handoff bundle"
```

## Receive

```bash
agent-wormhole receive <code> --out ./received
```

The code format is `id.secret`. The `id` can inspect metadata. The full code is
required to claim and decrypt the payload.

## Options

- `--store <dir>`: local wormhole store. Defaults to `.agent-wormholes`.
- `--ttl <duration>`: time to live. Examples: `30s`, `10m`, `2h`.
- `--max-ttl <duration>`: max allowed TTL. Default: `24h`.
- `--max-payload <size>`: max payload size. Default: `5mb`.
- `--sender <label>`: sender label for the receipt.
- `--receiver <label>`: receiver label for the receipt.
- `--note <text>`: public note stored in metadata.
- `--json`: output JSON.

## Cleanup

```bash
agent-wormhole cleanup --store .agent-wormholes --delete-claimed-older-than 15m
```

Cleanup deletes expired records and claimed records older than the configured
age. Receipts are retained.

## Receipt

Every send and receive writes a JSON receipt with:

- code
- payload hash
- encrypted byte size
- sender and receiver labels
- opened time
- expiry time
- claimed time
- status
