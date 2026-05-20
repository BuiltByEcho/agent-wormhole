#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE="${AGENT_WORMHOLE_REMOTE:-vps}"
REMOTE_DIR="${AGENT_WORMHOLE_REMOTE_DIR:-/home/dustin/apps/agent-wormhole}"
STORE="${AGENT_WORMHOLE_STORE:-$REMOTE_DIR/.store}"
HOST="${AGENT_WORMHOLE_HOST:-127.0.0.1}"
PORT="${AGENT_WORMHOLE_PORT:-8791}"
MAX_PAYLOAD="${AGENT_WORMHOLE_MAX_PAYLOAD:-5mb}"
MAX_TTL="${AGENT_WORMHOLE_MAX_TTL:-24h}"
BANKR_ENDPOINT_URL="${AGENT_WORMHOLE_BANKR_ENDPOINT_URL:-https://x402.bankr.bot/0x2a16625fad3b0d840ac02c7c59edea3781e340ae/agent-wormhole-open}"
BANKR_PROXY_TOKEN="${AGENT_WORMHOLE_BANKR_PROXY_TOKEN:-}"
ECHO_HOLDER_THRESHOLD="${ECHO_HOLDER_THRESHOLD:-50000000}"

if [[ -z "$BANKR_PROXY_TOKEN" ]]; then
  echo "AGENT_WORMHOLE_BANKR_PROXY_TOKEN is required for VPS deploy" >&2
  exit 1
fi

cd "$ROOT"

npm test
for file in src/*.js test/*.js; do
  node --check "$file"
done

rsync -az --delete \
  --exclude node_modules \
  --exclude .agent-wormholes \
  --exclude .wormhole-smoke \
  --exclude .store \
  --exclude '*.tgz' \
  "$ROOT/" "$REMOTE:$REMOTE_DIR/"

ssh "$REMOTE" "cd '$REMOTE_DIR' \
  && mkdir -p '$STORE' \
  && chmod 700 '$STORE' \
  && npm ci --omit=dev \
  && chmod +x src/cli.js scripts/deploy-vps.sh \
  && (pm2 delete agent-wormhole >/dev/null 2>&1 || true) \
  && AGENT_WORMHOLE_BANKR_PROXY_TOKEN='$BANKR_PROXY_TOKEN' ECHO_HOLDER_THRESHOLD='$ECHO_HOLDER_THRESHOLD' pm2 start src/cli.js --name agent-wormhole -- serve --host '$HOST' --port '$PORT' --store '$STORE' --max-payload '$MAX_PAYLOAD' --max-ttl '$MAX_TTL' --bankr-endpoint-url '$BANKR_ENDPOINT_URL' \
  && pm2 save"

ssh "$REMOTE" "node - <<'NODE'
const base = 'http://$HOST:$PORT';
const health = await fetch(base + '/health');
if (health.status !== 200) throw new Error('health ' + health.status);
const open = await fetch(base + '/v1/wormholes', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-agent-wormhole-bankr-proxy-token': '$BANKR_PROXY_TOKEN',
    'x-bankr-service': 'agent-wormhole-open',
    'x-bankr-network': 'base',
    'x-bankr-settle-amount': '0.005000'
  },
  body: JSON.stringify({
    payload: Buffer.from('deploy smoke').toString('base64'),
    filename: 'deploy-smoke.txt',
    contentType: 'text/plain',
    ttlMs: 60000,
    sender: 'deploy'
  })
});
if (open.status !== 201) throw new Error('open ' + open.status + ' ' + await open.text());
const opened = await open.json();
const claim = await fetch(base + '/v1/wormholes/' + encodeURIComponent(opened.code) + '/claim', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ receiver: 'deploy' })
});
if (claim.status !== 200) throw new Error('claim ' + claim.status + ' ' + await claim.text());
const claimed = await claim.json();
if (Buffer.from(claimed.payload, 'base64').toString('utf8') !== 'deploy smoke') {
  throw new Error('payload mismatch');
}
const second = await fetch(base + '/v1/wormholes/' + encodeURIComponent(opened.code) + '/claim', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ receiver: 'deploy-second' })
});
if (second.status !== 410) throw new Error('second claim ' + second.status);
console.log(JSON.stringify({ ok: true, service: 'agent-wormhole', port: $PORT }, null, 2));
NODE"
