#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  claimWormhole,
  cleanupWormholes,
  inspectWormhole,
  openWormhole,
  writeClaimedPayload,
  WormholeError,
} from "./index.js";
import { listen } from "./server.js";
import pkg from "../package.json" with { type: "json" };

async function main(argv = process.argv.slice(2)) {
  const command = argv.shift();

  try {
    if (!command || command === "help" || command === "--help" || command === "-h") {
      printHelp();
      return;
    }

    if (command === "--version" || command === "-v" || command === "version") {
      console.log(pkg.version);
      return;
    }

    if (command === "send") return await sendCommand(argv);
    if (command === "receive") return await receiveCommand(argv);
    if (command === "inspect") return await inspectCommand(argv);
    if (command === "cleanup") return await cleanupCommand(argv);
    if (command === "serve") return await serveCommand(argv);

    throw new Error(`Unknown command "${command}".`);
  } catch (error) {
    const message = error instanceof WormholeError ? error.message : error.message || String(error);
    console.error(`agent-wormhole: ${message}`);
    process.exitCode = error.status === 410 ? 10 : 1;
  }
}

async function sendCommand(argv) {
  const args = parseArgs(argv);
  let buffer;
  let filename;
  let contentType = args.contentType;

  if (args.file) {
    const filePath = path.resolve(args.file);
    buffer = await readFile(filePath);
    filename = args.filename || path.basename(filePath);
  } else if (args.text != null) {
    buffer = Buffer.from(args.text, "utf8");
    filename = args.filename || "message.txt";
    contentType ||= "text/plain; charset=utf-8";
  } else {
    throw new Error("send requires --text or --file.");
  }

  const result = await openWormhole({
    store: args.store,
    buffer,
    filename,
    contentType,
    note: args.note,
    ttl: args.ttl,
    maxPayloadBytes: args.maxPayload,
    maxTtl: args.maxTtl,
    sender: args.sender,
  });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Wormhole open: ${result.code}`);
    console.log(`Expires: ${result.expiresAt}`);
    console.log(`Payload sha256: ${result.payloadHash}`);
  }
}

async function receiveCommand(argv) {
  const args = parseArgs(argv);
  const code = args._[0];
  if (!code) throw new Error("receive requires a wormhole code.");

  const result = await claimWormhole(code, {
    store: args.store,
    receiver: args.receiver,
  });

  if (args.out) {
    const outPath = await writeClaimedPayload(result, path.resolve(args.out));
    if (args.json) {
      console.log(JSON.stringify({ ...stripPayload(result), outPath }, null, 2));
    } else {
      console.log(`Claimed: ${result.id}`);
      console.log(`Wrote: ${outPath}`);
    }
    return;
  }

  if (args.json) {
    console.log(JSON.stringify({ ...stripPayload(result), payload: result.payload.toString("base64") }, null, 2));
  } else if ((result.contentType || "").startsWith("text/")) {
    process.stdout.write(result.payload.toString("utf8"));
    if (!result.payload.toString("utf8").endsWith("\n")) process.stdout.write("\n");
  } else {
    process.stdout.write(result.payload);
  }
}

async function inspectCommand(argv) {
  const args = parseArgs(argv);
  const code = args._[0];
  if (!code) throw new Error("inspect requires a wormhole code or id.");
  const result = await inspectWormhole(code, { store: args.store });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Wormhole: ${result.id}`);
    console.log(`Status: ${result.status}`);
    console.log(`Expires: ${result.expiresAt}`);
    console.log(`Payload sha256: ${result.payloadHash}`);
    if (result.note) console.log(`Note: ${result.note}`);
  }
}

async function cleanupCommand(argv) {
  const args = parseArgs(argv);
  const result = await cleanupWormholes({
    store: args.store,
    deleteClaimedOlderThan: args.deleteClaimedOlderThan,
    dryRun: args.dryRun,
  });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Scanned: ${result.scanned}`);
    console.log(`Deleted: ${result.deleted}`);
    console.log(`Kept: ${result.kept}`);
  }
}

async function serveCommand(argv) {
  const args = parseArgs(argv);
  const host = args.host || "127.0.0.1";
  const port = Number(args.port || 8787);
  await listen({
    host,
    port,
    store: args.store,
    maxPayloadBytes: args.maxPayload,
    maxTtl: args.maxTtl,
    bankrEndpointUrl: args.bankrEndpointUrl,
  });
  console.log(`agent-wormhole listening on http://${host}:${port}`);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }

    const [rawKey, inlineValue] = token.slice(2).split("=", 2);
    const key = rawKey.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
    if (key === "json" || key === "dryRun") {
      args[key] = true;
      continue;
    }

    const value = inlineValue ?? argv[++i];
    if (value == null || value.startsWith("--")) throw new Error(`Missing value for --${rawKey}.`);
    args[key] = value;
  }
  return args;
}

function stripPayload(result) {
  const { payload: _payload, ...rest } = result;
  return rest;
}

function printHelp() {
  console.log(`agent-wormhole

Commands:
  send --text <text> [--ttl 10m] [--store .agent-wormholes]
  send --file <path> [--note <text>]
  receive <code> [--out ./received]
  inspect <code-or-id>
  cleanup [--delete-claimed-older-than 0ms]
  serve [--host 127.0.0.1] [--port 8787]
`);
}

await main();
