declare const process: { env?: Record<string, string | undefined> };

const DEFAULT_AGENT_WORMHOLE_BASE_URL = 'https://storage.builtbyecho.xyz/agent-wormhole';
const PRICE = 0.005;

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ ok: false, error: 'POST required' }, 405);

  try {
    const body = await req.json();
    const upstream = await fetch(`${getBaseUrl()}/v1/wormholes`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-agent-wormhole-bankr-proxy-token': getProxyToken(),
        'x-bankr-service': 'agent-wormhole-open',
        'x-bankr-network': 'base',
        'x-bankr-settle-amount': PRICE.toFixed(6),
      },
      body: JSON.stringify({
        payload: body.payload,
        filename: body.filename,
        contentType: body.contentType,
        note: body.note,
        ttlMs: body.ttlMs,
        sender: body.sender,
      }),
    });

    const data = await upstream.json().catch(async () => ({ body: await upstream.text() }));
    return json({
      ok: upstream.ok,
      ...data,
      price: PRICE.toFixed(6),
      bankr: {
        service: 'agent-wormhole-open',
        paymentScheme: 'exact',
        settledAmount: PRICE.toFixed(6),
        note: 'Bankr x402 is the paid open route; ECHO holders can use the direct holder route for sponsored opens.',
      },
    }, upstream.ok ? 200 : upstream.status);
  } catch (error) {
    return json({
      ok: false,
      error: error instanceof Error ? error.message : 'Bad request',
      service: 'agent-wormhole-open',
    }, 400);
  }
}

function getBaseUrl() {
  return getEnv('AGENT_WORMHOLE_BASE_URL') || DEFAULT_AGENT_WORMHOLE_BASE_URL;
}

function getProxyToken() {
  const token = process.env?.VAULTLINE_BANKR_PROXY_TOKEN || process.env?.AGENT_WORMHOLE_BANKR_PROXY_TOKEN;
  if (!token) throw new Error('VAULTLINE_BANKR_PROXY_TOKEN is not configured in Bankr x402 env');
  return token;
}

function getEnv(name: string) {
  try {
    return process.env?.[name] || '';
  } catch {
    return '';
  }
}

function atomicUsdc(amount: number) {
  return String(Math.max(1, Math.round(amount * 1_000_000)));
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json',
      'x-402-settle-amount': atomicUsdc(PRICE),
    },
  });
}
