import { getAddress, isAddress, verifyMessage } from "viem";
import { WormholeError } from "./store.js";

export const ECHO_CONTRACT = "0xA7F63eB41779925803a3EEC30890742571e63Ba3";
export const DEFAULT_BASE_RPC_URL = "https://mainnet.base.org";
export const DEFAULT_ECHO_HOLDER_THRESHOLD = "50000000";
export const DEFAULT_HOLDER_PROOF_MAX_AGE_MS = 10 * 60 * 1000;

const BALANCE_OF_SELECTOR = "0x70a08231";
const DECIMALS_SELECTOR = "0x313ce567";

export function buildHolderMessage(wallet, timestamp = new Date().toISOString()) {
  return [
    "Agent Wormhole holder access",
    `Wallet: ${getAddress(wallet)}`,
    `Timestamp: ${timestamp}`,
  ].join("\n");
}

export async function verifyEchoHolderAccess({
  wallet,
  signature,
  message,
  now = Date.now(),
  rpcUrl = process.env.BASE_RPC_URL || DEFAULT_BASE_RPC_URL,
  tokenAddress = process.env.ECHO_TOKEN_ADDRESS || ECHO_CONTRACT,
  threshold = process.env.ECHO_HOLDER_THRESHOLD || DEFAULT_ECHO_HOLDER_THRESHOLD,
  maxAgeMs = Number(process.env.ECHO_HOLDER_PROOF_MAX_AGE_MS || DEFAULT_HOLDER_PROOF_MAX_AGE_MS),
} = {}) {
  if (!wallet && !signature && !message) return null;
  if (!wallet || !signature || !message) {
    throw new WormholeError("Holder access requires wallet, signature, and signed message.", 401, "holder_proof_required");
  }
  if (!isAddress(wallet)) {
    throw new WormholeError("Invalid holder wallet.", 400, "invalid_holder_wallet");
  }

  const address = getAddress(wallet);
  const timestamp = extractTimestamp(message);
  if (!timestamp) {
    throw new WormholeError("Holder message must include a Timestamp line.", 400, "invalid_holder_message");
  }
  const age = Math.abs(now - Date.parse(timestamp));
  if (!Number.isFinite(age) || age > maxAgeMs) {
    throw new WormholeError("Holder proof is expired.", 401, "holder_proof_expired");
  }

  const ok = await verifyMessage({ address, message, signature });
  if (!ok) {
    throw new WormholeError("Invalid holder signature.", 401, "invalid_holder_signature");
  }

  const decimals = await fetchTokenDecimals({ rpcUrl, tokenAddress });
  const balanceAtomic = await fetchTokenBalance({ rpcUrl, tokenAddress, wallet: address });
  const thresholdAtomic = parseTokenAmount(threshold, decimals);

  if (balanceAtomic < thresholdAtomic) {
    throw new WormholeError("Wallet does not hold enough ECHO for free Agent Wormhole access.", 402, "echo_holder_threshold_not_met");
  }

  return {
    path: "echo_holder",
    holderWallet: address,
    holderBalance: formatTokenAmount(balanceAtomic, decimals),
    holderThreshold: formatTokenAmount(thresholdAtomic, decimals),
    tokenAddress: getAddress(tokenAddress),
  };
}

export async function fetchTokenBalance({ rpcUrl, tokenAddress, wallet }) {
  const address = getAddress(wallet).slice(2).padStart(64, "0");
  const result = await ethCall(rpcUrl, tokenAddress, `${BALANCE_OF_SELECTOR}${address}`);
  return BigInt(result);
}

export async function fetchTokenDecimals({ rpcUrl, tokenAddress }) {
  const result = await ethCall(rpcUrl, tokenAddress, DECIMALS_SELECTOR);
  return Number(BigInt(result));
}

export function parseTokenAmount(value, decimals) {
  const text = String(value).trim();
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error(`Invalid token amount "${value}".`);
  const [whole, fraction = ""] = text.split(".");
  const padded = fraction.padEnd(decimals, "0").slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || "0");
}

export function formatTokenAmount(value, decimals) {
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = value % base;
  const fractionText = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fractionText ? `${whole}.${fractionText}` : whole.toString();
}

async function ethCall(rpcUrl, to, data) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to, data }, "latest"],
    }),
  });
  const json = await response.json();
  if (!response.ok || json.error) {
    throw new WormholeError("Unable to verify ECHO holder balance.", 502, "holder_balance_check_failed");
  }
  return json.result;
}

function extractTimestamp(message) {
  const match = /^Timestamp:\s*(.+)$/im.exec(String(message));
  return match?.[1]?.trim();
}
