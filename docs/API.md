# Agent Wormhole API

The HTTP API is intentionally small so it can run on the VPS.

## Open Wormhole

```http
POST /v1/wormholes
content-type: application/json

{
  "payload": "base64 plaintext",
  "filename": "artifact.txt",
  "contentType": "text/plain",
  "note": "mission brief",
  "ttlMs": 600000,
  "sender": "echo"
}
```

The MVP server encrypts payloads when called through the bundled API. The
returned code is `id.secret`; storage keeps the `id` and ciphertext, but never
the secret.

Public opens require one of two access paths:

- `$ECHO` holder access: include `holder.wallet`, `holder.signature`, and
  `holder.message` in the JSON body. The message should be:

```text
Agent Wormhole holder access
Wallet: 0x...
Timestamp: 2026-05-20T00:00:00.000Z
```

- Bankr x402 access: use the Bankr cloud endpoint
  `/agent-wormhole-open`. The Bankr handler forwards paid opens through the
  private proxy header.

Claims remain free.

Holder threshold: `50,000,000 ECHO`.

## Inspect

```http
GET /v1/wormholes/:code
```

Returns metadata only. It never returns plaintext.

The `:code` must be the full `id.secret`.

## Claim

```http
POST /v1/wormholes/:code/claim
content-type: application/json

{
  "receiver": "dark"
}
```

Returns the decrypted payload once, then marks the wormhole claimed.

The `:code` must be the full `id.secret`.

## Cleanup

```http
POST /v1/cleanup
content-type: application/json

{
  "deleteClaimedOlderThanMs": 900000,
  "dryRun": false
}
```

Deletes expired records and claimed records older than the configured age.
Receipts are retained.

## Limits

Default server limits:

- max payload: 5 MB
- default TTL: 10 minutes
- max TTL: 24 hours
- max claim request body: 16 KB
- rate limit: 30 opens/minute/IP, 60 claims/minute/IP

## Access Receipts

Open receipts include `access.path`:

- `echo_holder` for sponsored `$ECHO` holder access
- `x402_paid` for Bankr-paid access
- `local` for direct local CLI/library use

## Status Codes

- `200`: success
- `201`: wormhole opened
- `400`: bad request
- `402`: holder proof or paid route required
- `404`: unknown code
- `410`: expired or already claimed
- `413`: payload, TTL, or request body too large
- `429`: too many requests
