import path from "node:path";
import { WormholeError } from "./store.js";
import { parseDuration } from "./time.js";

export const DEFAULT_MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;
export const DEFAULT_TTL_MS = 10 * 60 * 1000;
export const DEFAULT_MAX_TTL_MS = 24 * 60 * 60 * 1000;

const BYTE_RE = /^(\d+)(b|kb|mb|gb)?$/i;

export function parseBytes(value, fallback = DEFAULT_MAX_PAYLOAD_BYTES) {
  if (value == null || value === "") return fallback;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;

  const text = String(value).trim();
  const match = BYTE_RE.exec(text);
  if (!match) {
    throw new Error(`Invalid byte size "${value}". Use formats like 500kb, 5mb, or 1gb.`);
  }

  const amount = Number(match[1]);
  const unit = (match[2] || "b").toLowerCase();
  const multipliers = {
    b: 1,
    kb: 1024,
    mb: 1024 * 1024,
    gb: 1024 * 1024 * 1024,
  };
  return amount * multipliers[unit];
}

export function resolveTtlMs(value, { defaultTtlMs = DEFAULT_TTL_MS, maxTtlMs = DEFAULT_MAX_TTL_MS } = {}) {
  const ttlMs = parseDuration(value, defaultTtlMs);
  if (ttlMs > maxTtlMs) {
    throw new WormholeError(`TTL exceeds max of ${maxTtlMs}ms.`, 413, "ttl_too_large");
  }
  return ttlMs;
}

export function enforcePayloadLimit(buffer, maxPayloadBytes = DEFAULT_MAX_PAYLOAD_BYTES) {
  if (buffer.byteLength > maxPayloadBytes) {
    throw new WormholeError(
      `Payload exceeds max size of ${maxPayloadBytes} bytes.`,
      413,
      "payload_too_large",
    );
  }
}

export function sanitizeFilename(filename, fallback = "payload.bin") {
  const raw = filename == null || filename === "" ? fallback : String(filename);
  const base = path.basename(raw).trim();

  if (!base || base === "." || base === ".." || base !== raw || /[\0\r\n]/.test(base) || base.length > 180) {
    throw new WormholeError("Invalid filename.", 400, "invalid_filename");
  }

  return base;
}
