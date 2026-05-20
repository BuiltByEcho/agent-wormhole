import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import {
  decryptPayload,
  encryptPayload,
  generateId,
  generateSecret,
  hashPayload,
  makeCode,
  parseCode,
} from "./codec.js";
import { FileStore, publicRecord, WormholeError } from "./store.js";
import {
  DEFAULT_MAX_PAYLOAD_BYTES,
  DEFAULT_MAX_TTL_MS,
  DEFAULT_TTL_MS,
  enforcePayloadLimit,
  parseBytes,
  resolveTtlMs,
  sanitizeFilename,
} from "./limits.js";
import { addMsIso, nowIso, parseDuration } from "./time.js";

export { FileStore, WormholeError, parseBytes, parseCode, parseDuration };
export { buildHolderMessage, verifyEchoHolderAccess } from "./access.js";

export async function openWormhole(options = {}) {
  const store = options.store instanceof FileStore ? options.store : new FileStore(options.store);
  const payload = normalizePayload(options);
  const maxPayloadBytes = parseBytes(options.maxPayloadBytes, DEFAULT_MAX_PAYLOAD_BYTES);
  const maxTtlMs = parseDuration(options.maxTtl ?? options.maxTtlMs, DEFAULT_MAX_TTL_MS);
  enforcePayloadLimit(payload.buffer, maxPayloadBytes);

  const id = options.id || generateId();
  const secret = generateSecret();
  const ttlMs = resolveTtlMs(options.ttl ?? options.ttlMs, { defaultTtlMs: DEFAULT_TTL_MS, maxTtlMs });
  const openedAt = nowIso();
  const expiresAt = addMsIso(ttlMs);
  const envelope = encryptPayload(payload.buffer, secret);
  const encryptedBytes = Buffer.byteLength(envelope.ciphertext, "utf8");
  const filename = sanitizeFilename(options.filename || payload.filename || null, "payload.bin");

  const record = {
    version: 1,
    id,
    note: options.note || "",
    filename,
    contentType: options.contentType || payload.contentType || "application/octet-stream",
    payloadHash: hashPayload(payload.buffer),
    encryptedBytes,
    sender: options.sender || null,
    receiver: null,
    access: options.access || { path: "local" },
    openedAt,
    expiresAt,
    claimedAt: null,
    status: "open",
    envelope,
  };

  await store.create(record);
  await store.writeReceipt(record, "opened");

  return {
    code: makeCode(id, secret),
    ...publicRecord(record),
  };
}

export async function inspectWormhole(codeOrId, options = {}) {
  const store = options.store instanceof FileStore ? options.store : new FileStore(options.store);
  const { id } = parseCode(codeOrId);
  if (options.requireSecret && !String(codeOrId || "").includes(".")) {
    throw new WormholeError("Full wormhole code is required to inspect this wormhole.", 404, "invalid_code");
  }
  const record = await store.read(id);
  return publicRecord(await refreshStatus(record, store));
}

export async function claimWormhole(code, options = {}) {
  const store = options.store instanceof FileStore ? options.store : new FileStore(options.store);
  const { id, secret } = parseCode(code);

  return await store.withLock(id, async () => {
    const record = await refreshStatus(await store.read(id), store);

    if (record.status === "expired") {
      throw new WormholeError("Wormhole expired.", 410, "expired");
    }
    if (record.status === "claimed") {
      throw new WormholeError("Wormhole already claimed.", 410, "claimed");
    }

    let buffer;
    try {
      buffer = decryptPayload(record.envelope, secret);
    } catch {
      throw new WormholeError("Invalid wormhole code.", 404, "invalid_code");
    }

    const claimedAt = nowIso();
    const next = {
      ...record,
      receiver: options.receiver || record.receiver || null,
      claimedAt,
      status: "claimed",
    };
    await store.update(next);
    await store.writeReceipt(next, "claimed");

    return {
      ...publicRecord(next),
      payload: buffer,
    };
  });
}

export async function writeClaimedPayload(result, outDir) {
  await mkdir(outDir, { recursive: true });
  const safeName = sanitizeFilename(result.filename || "payload.bin");
  const outPath = path.join(outDir, safeName);
  await writeFile(outPath, result.payload, { flag: "wx" });
  return outPath;
}

export async function cleanupWormholes(options = {}) {
  const store = options.store instanceof FileStore ? options.store : new FileStore(options.store);
  const now = options.now || Date.now();
  const claimedAge = options.deleteClaimedOlderThan ?? options.deleteClaimedOlderThanMs;
  const deleteClaimedOlderThanMs = claimedAge == null ? 0 : parseDuration(claimedAge, 0);
  const dryRun = Boolean(options.dryRun);
  const records = await store.listRecords();
  const deleted = [];
  const kept = [];

  for (const record of records) {
    let current = record;
    if (current.status === "open" && Date.parse(current.expiresAt) <= now) {
      current = { ...current, status: "expired" };
      if (!dryRun) await store.update(current);
    }

    const expired = current.status === "expired";
    const claimedAt = current.claimedAt ? Date.parse(current.claimedAt) : null;
    const claimedOldEnough =
      current.status === "claimed" &&
      claimedAt != null &&
      now - claimedAt >= deleteClaimedOlderThanMs;

    if (expired || claimedOldEnough) {
      deleted.push({ id: current.id, status: current.status });
      if (!dryRun) await store.delete(current.id);
    } else {
      kept.push({ id: current.id, status: current.status });
    }
  }

  return {
    scanned: records.length,
    deleted: deleted.length,
    kept: kept.length,
    dryRun,
    deletedRecords: deleted,
  };
}

function normalizePayload(options) {
  if (options.buffer) {
    return {
      buffer: Buffer.isBuffer(options.buffer) ? options.buffer : Buffer.from(options.buffer),
      filename: options.filename || "payload.bin",
      contentType: options.contentType,
    };
  }

  if (options.text != null) {
    return {
      buffer: Buffer.from(String(options.text), "utf8"),
      filename: options.filename || "message.txt",
      contentType: options.contentType || "text/plain; charset=utf-8",
    };
  }

  if (options.payload != null) {
    const payload = String(options.payload).trim();
    if (!isCanonicalBase64(payload)) {
      throw new WormholeError("Payload must be valid base64.", 400, "invalid_payload_base64");
    }
    return {
      buffer: Buffer.from(payload, "base64"),
      filename: options.filename || "payload.bin",
      contentType: options.contentType,
    };
  }

  throw new WormholeError("Missing payload. Provide text, buffer, file, or base64 payload.", 400, "missing_payload");
}

async function refreshStatus(record, store) {
  if (record.status === "open" && Date.parse(record.expiresAt) <= Date.now()) {
    const expired = { ...record, status: "expired" };
    await store.update(expired);
    return expired;
  }
  return record;
}

function isCanonicalBase64(value) {
  if (!value || value.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(value)) return false;
  const normalized = value.replace(/=+$/, "");
  return Buffer.from(value, "base64").toString("base64").replace(/=+$/, "") === normalized;
}
