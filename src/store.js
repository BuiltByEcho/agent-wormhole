import { mkdir, readdir, readFile, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const ID_RE = /^[a-z0-9-]+$/;

export class WormholeError extends Error {
  constructor(message, status = 400, code = "wormhole_error") {
    super(message);
    this.name = "WormholeError";
    this.status = status;
    this.code = code;
  }
}

export class FileStore {
  constructor(rootDir = ".agent-wormholes") {
    this.rootDir = path.resolve(rootDir);
  }

  recordPath(id) {
    if (!ID_RE.test(id)) {
      throw new WormholeError("Invalid wormhole id.", 400, "invalid_id");
    }
    return path.join(this.rootDir, `${id}.json`);
  }

  async ensure() {
    await mkdir(this.rootDir, { recursive: true, mode: 0o700 });
  }

  async create(record) {
    await this.ensure();
    const file = this.recordPath(record.id);
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await rename(tmp, file);
  }

  async read(id) {
    try {
      const raw = await readFile(this.recordPath(id), "utf8");
      return JSON.parse(raw);
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new WormholeError("Unknown wormhole.", 404, "not_found");
      }
      throw error;
    }
  }

  async listRecords() {
    await this.ensure();
    const entries = await readdir(this.rootDir, { withFileTypes: true });
    const records = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const id = entry.name.slice(0, -".json".length);
      records.push(await this.read(id));
    }
    return records;
  }

  async delete(id) {
    await unlink(this.recordPath(id)).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }

  async update(record) {
    await this.ensure();
    const file = this.recordPath(record.id);
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    await rename(tmp, file);
  }

  async writeReceipt(record, event, extra = {}) {
    await this.ensure();
    const dir = path.join(this.rootDir, "receipts");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(dir, `${stamp}-${record.id}-${event}.json`);
    const receipt = {
      event,
      ...publicRecord(record),
      ...extra,
    };
    await writeFile(file, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    return file;
  }

  async withLock(id, fn) {
    await this.ensure();
    if (!ID_RE.test(id)) {
      throw new WormholeError("Invalid wormhole id.", 400, "invalid_id");
    }

    const dir = path.join(this.rootDir, ".locks", `${id}.lock`);
    try {
      await mkdir(path.dirname(dir), { recursive: true, mode: 0o700 });
      await mkdir(dir, { mode: 0o700 });
    } catch (error) {
      if (error.code === "EEXIST") {
        throw new WormholeError("Wormhole claim is already in progress.", 409, "claim_in_progress");
      }
      throw error;
    }

    try {
      return await fn();
    } finally {
      await rmdir(dir).catch(() => {});
    }
  }
}

export function publicRecord(record) {
  return {
    id: record.id,
    note: record.note || "",
    filename: record.filename || null,
    contentType: record.contentType || "application/octet-stream",
    payloadHash: record.payloadHash,
    encryptedBytes: record.encryptedBytes,
    sender: record.sender || null,
    receiver: record.receiver || null,
    access: record.access || { path: "local" },
    openedAt: record.openedAt,
    expiresAt: record.expiresAt,
    claimedAt: record.claimedAt || null,
    status: record.status,
  };
}
