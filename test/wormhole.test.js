import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import {
  claimWormhole,
  cleanupWormholes,
  inspectWormhole,
  openWormhole,
  writeClaimedPayload,
} from "../src/index.js";
import { createServer } from "../src/server.js";

let dir;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "agent-wormhole-test-"));
  process.env.AGENT_WORMHOLE_BANKR_PROXY_TOKEN = "test-bankr-proxy-token";
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("opens, inspects, and claims a text wormhole once", async () => {
  const opened = await openWormhole({
    store: dir,
    text: "sealed hello",
    note: "mission",
    sender: "echo",
    ttl: "5m",
  });

  assert.match(opened.code, /^[a-z0-9-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(opened.status, "open");
  assert.equal(opened.note, "mission");

  const inspected = await inspectWormhole(opened.id, { store: dir });
  assert.equal(inspected.status, "open");
  assert.equal(inspected.payloadHash, opened.payloadHash);

  const claimed = await claimWormhole(opened.code, { store: dir, receiver: "dark" });
  assert.equal(claimed.payload.toString("utf8"), "sealed hello");
  assert.equal(claimed.status, "claimed");
  assert.equal(claimed.receiver, "dark");

  await assert.rejects(() => claimWormhole(opened.code, { store: dir }), /already claimed/i);

  const receipts = await readdir(path.join(dir, "receipts"));
  assert.equal(receipts.length, 2);
  assert.equal(receipts.some((name) => name.endsWith("-opened.json")), true);
  assert.equal(receipts.some((name) => name.endsWith("-claimed.json")), true);
});

test("rejects expired wormholes", async () => {
  const opened = await openWormhole({ store: dir, text: "short", ttl: "1ms" });
  await new Promise((resolve) => setTimeout(resolve, 5));
  await assert.rejects(() => claimWormhole(opened.code, { store: dir }), /expired/i);
});

test("writes claimed file payloads without leaking plaintext into metadata", async () => {
  const source = path.join(dir, "artifact.txt");
  await writeFile(source, "artifact bytes");
  const buffer = await readFile(source);
  const opened = await openWormhole({
    store: dir,
    buffer,
    filename: "artifact.txt",
    contentType: "text/plain",
  });

  const recordRaw = await readFile(path.join(dir, `${opened.id}.json`), "utf8");
  assert.equal(recordRaw.includes("artifact bytes"), false);

  const claimed = await claimWormhole(opened.code, { store: dir });
  const outPath = await writeClaimedPayload(claimed, path.join(dir, "received"));
  assert.equal(await readFile(outPath, "utf8"), "artifact bytes");
});

test("enforces payload size, ttl, and filename limits", async () => {
  await assert.rejects(
    () => openWormhole({ store: dir, text: "too big", maxPayloadBytes: 3 }),
    /payload exceeds/i,
  );

  await assert.rejects(
    () => openWormhole({ store: dir, text: "too long", ttl: "2d", maxTtl: "1d" }),
    /ttl exceeds/i,
  );

  await assert.rejects(
    () => openWormhole({ store: dir, text: "bad name", filename: "../secret.txt" }),
    /invalid filename/i,
  );
});

test("cleanup removes expired and claimed records while keeping receipts", async () => {
  const expired = await openWormhole({ store: dir, text: "expired", ttl: "1ms" });
  const claimed = await openWormhole({ store: dir, text: "claimed", ttl: "5m" });
  const open = await openWormhole({ store: dir, text: "open", ttl: "5m" });

  await claimWormhole(claimed.code, { store: dir });
  await new Promise((resolve) => setTimeout(resolve, 5));

  const result = await cleanupWormholes({ store: dir, deleteClaimedOlderThan: "0ms" });
  assert.equal(result.scanned, 3);
  assert.equal(result.deleted, 2);
  assert.deepEqual(result.deletedRecords.map((record) => record.id).sort(), [claimed.id, expired.id].sort());

  await assert.rejects(() => inspectWormhole(expired.id, { store: dir }), /unknown wormhole/i);
  await assert.rejects(() => inspectWormhole(claimed.id, { store: dir }), /unknown wormhole/i);
  assert.equal((await inspectWormhole(open.id, { store: dir })).status, "open");
  assert.ok((await readdir(path.join(dir, "receipts"))).length >= 4);
});

test("http api opens, inspects, and claims", async () => {
  const server = createServer({ store: dir });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    const openRes = await fetch(`${base}/v1/wormholes`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agent-wormhole-bankr-proxy-token": "test-bankr-proxy-token",
        "x-bankr-settle-amount": "0.005000",
      },
      body: JSON.stringify({
        payload: Buffer.from("api hello").toString("base64"),
        filename: "api.txt",
        contentType: "text/plain",
        ttlMs: 60_000,
      }),
    });
    assert.equal(openRes.status, 201);
    const opened = await openRes.json();
    assert.equal(opened.access.path, "x402_paid");

    const inspectRes = await fetch(`${base}/v1/wormholes/${opened.id}`);
    assert.equal(inspectRes.status, 200);
    assert.equal((await inspectRes.json()).status, "open");

    const claimRes = await fetch(`${base}/v1/wormholes/${encodeURIComponent(opened.code)}/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ receiver: "api-test" }),
    });
    assert.equal(claimRes.status, 200);
    const claimed = await claimRes.json();
    assert.equal(Buffer.from(claimed.payload, "base64").toString("utf8"), "api hello");
  } finally {
    server.close();
  }
});

test("http api enforces limits and supports cleanup", async () => {
  const server = createServer({ store: dir, maxPayloadBytes: 3, maxTtl: "1m" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    const tooBig = await fetch(`${base}/v1/wormholes`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agent-wormhole-bankr-proxy-token": "test-bankr-proxy-token",
      },
      body: JSON.stringify({ payload: Buffer.from("large").toString("base64"), ttlMs: 1000 }),
    });
    assert.equal(tooBig.status, 413);

    const tooLong = await fetch(`${base}/v1/wormholes`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agent-wormhole-bankr-proxy-token": "test-bankr-proxy-token",
      },
      body: JSON.stringify({ payload: Buffer.from("ok").toString("base64"), ttlMs: 120_000 }),
    });
    assert.equal(tooLong.status, 413);

    const cleanup = await fetch(`${base}/v1/cleanup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dryRun: true }),
    });
    assert.equal(cleanup.status, 200);
    assert.equal((await cleanup.json()).dryRun, true);
  } finally {
    server.close();
  }
});

test("http api returns payment required without holder proof or bankr proxy", async () => {
  const server = createServer({ store: dir, bankrEndpointUrl: "https://x402.bankr.bot/example/agent-wormhole-open" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    const response = await fetch(`${base}/v1/wormholes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload: Buffer.from("pay").toString("base64") }),
    });
    assert.equal(response.status, 402);
    assert.equal((await response.json()).error, "payment_required");
  } finally {
    server.close();
  }
});

test("only one concurrent claim can receive the payload", async () => {
  const opened = await openWormhole({ store: dir, text: "race", ttl: "5m" });
  const results = await Promise.allSettled([
    claimWormhole(opened.code, { store: dir, receiver: "a" }),
    claimWormhole(opened.code, { store: dir, receiver: "b" }),
  ]);

  const fulfilled = results.filter((result) => result.status === "fulfilled");
  const rejected = results.filter((result) => result.status === "rejected");

  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(fulfilled[0].value.payload.toString("utf8"), "race");
});
