import http from "node:http";
import {
  claimWormhole,
  cleanupWormholes,
  FileStore,
  inspectWormhole,
  openWormhole,
  parseBytes,
  verifyEchoHolderAccess,
  WormholeError,
} from "./index.js";
import { DEFAULT_MAX_PAYLOAD_BYTES } from "./limits.js";

export function createServer({
  store = ".agent-wormholes",
  maxPayloadBytes = DEFAULT_MAX_PAYLOAD_BYTES,
  maxRequestBytes,
  maxTtl,
  bankrEndpointUrl = process.env.AGENT_WORMHOLE_BANKR_ENDPOINT_URL || "",
} = {}) {
  const fileStore = store instanceof FileStore ? store : new FileStore(store);
  const payloadLimit = parseBytes(maxPayloadBytes, DEFAULT_MAX_PAYLOAD_BYTES);
  const requestLimit = parseBytes(maxRequestBytes, payloadLimit * 2 + 4096);

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      const pathname = normalizePathname(url.pathname);

      if (req.method === "GET" && pathname === "/health") {
        return sendJson(res, 200, { status: "ok", service: "agent-wormhole" });
      }

      if (req.method === "POST" && pathname === "/v1/wormholes") {
        const body = await readJson(req, requestLimit);
        const access = await resolveOpenAccess(req, bankrEndpointUrl, body.holder);
        const opened = await openWormhole({
          store: fileStore,
          payload: body.payload,
          filename: body.filename,
          contentType: body.contentType,
          note: body.note,
          ttlMs: body.ttlMs,
          maxPayloadBytes: payloadLimit,
          maxTtl,
          sender: body.sender,
          access,
        });
        return sendJson(res, 201, opened);
      }

      if (req.method === "POST" && pathname === "/v1/cleanup") {
        const body = await readJson(req, 16 * 1024);
        return sendJson(res, 200, await cleanupWormholes({
          store: fileStore,
          deleteClaimedOlderThanMs: body.deleteClaimedOlderThanMs,
          dryRun: body.dryRun,
        }));
      }

      const match = /^\/v1\/wormholes\/([^/]+)(?:\/claim)?$/.exec(pathname);
      if (match && req.method === "GET" && !pathname.endsWith("/claim")) {
        return sendJson(res, 200, await inspectWormhole(decodeURIComponent(match[1]), { store: fileStore }));
      }

      if (match && req.method === "POST" && pathname.endsWith("/claim")) {
        const body = await readJson(req, 16 * 1024);
        const claimed = await claimWormhole(decodeURIComponent(match[1]), {
          store: fileStore,
          receiver: body.receiver,
        });
        return sendJson(res, 200, {
          ...claimed,
          payload: claimed.payload.toString("base64"),
        });
      }

      sendJson(res, 404, { error: "not_found", message: "Route not found." });
    } catch (error) {
      const status = error instanceof WormholeError ? error.status : 500;
      sendJson(res, status, {
        error: error.code || "internal_error",
        message: status === 500 ? "Internal server error." : error.message,
      });
    }
  });
}

async function resolveOpenAccess(req, bankrEndpointUrl, holder = {}) {
  const bankrToken = req.headers["x-agent-wormhole-bankr-proxy-token"];
  if (bankrToken) {
    if (!process.env.AGENT_WORMHOLE_BANKR_PROXY_TOKEN || bankrToken !== process.env.AGENT_WORMHOLE_BANKR_PROXY_TOKEN) {
      throw new WormholeError("Invalid Bankr proxy token.", 401, "invalid_bankr_proxy_token");
    }

    return {
      path: "x402_paid",
      paymentProvider: "bankr",
      paymentService: getHeader(req.headers, "x-bankr-service") || "agent-wormhole-open",
      paymentNetwork: getHeader(req.headers, "x-bankr-network") || "base",
      settledAmount: getHeader(req.headers, "x-bankr-settle-amount") || null,
      paymentTransaction: getHeader(req.headers, "x-bankr-transaction") || null,
      paymentReceipt: getHeader(req.headers, "x-bankr-receipt") || null,
    };
  }

  try {
    const access = await verifyEchoHolderAccess({
      wallet: holder.wallet || getHeader(req.headers, "x-echo-wallet"),
      signature: holder.signature || getHeader(req.headers, "x-echo-signature"),
      message: holder.message || decodeHeaderMessage(getHeader(req.headers, "x-echo-message-b64")),
    });
    if (access) return access;
  } catch (error) {
    if (error instanceof WormholeError && error.status !== 402 && error.status !== 401) throw error;
  }

  throw new WormholeError(
    bankrEndpointUrl
      ? `ECHO holder proof required for free access. Non-holders should use Bankr x402: ${bankrEndpointUrl}`
      : "ECHO holder proof required for free access. Non-holders should use the Bankr x402 endpoint.",
    402,
    "payment_required",
  );
}

export async function listen({
  host = "127.0.0.1",
  port = 8787,
  store,
  maxPayloadBytes,
  maxRequestBytes,
  maxTtl,
  bankrEndpointUrl,
} = {}) {
  const server = createServer({ store, maxPayloadBytes, maxRequestBytes, maxTtl, bankrEndpointUrl });
  await new Promise((resolve) => server.listen(port, host, resolve));
  return server;
}

async function readJson(req, limitBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.byteLength;
    if (total > limitBytes) {
      throw new WormholeError(`Request exceeds max size of ${limitBytes} bytes.`, 413, "request_too_large");
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(`${JSON.stringify(body, replacer, 2)}\n`);
}

function replacer(_key, value) {
  return typeof value === "bigint" ? value.toString() : value;
}

function getHeader(headers, name) {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value == null ? undefined : String(value);
}

function normalizePathname(pathname) {
  if (pathname === "/agent-wormhole") return "/";
  if (pathname.startsWith("/agent-wormhole/")) return pathname.slice("/agent-wormhole".length);
  return pathname;
}

function decodeHeaderMessage(value) {
  if (!value) return undefined;
  return Buffer.from(value, "base64url").toString("utf8");
}
