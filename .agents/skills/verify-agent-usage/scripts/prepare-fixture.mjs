#!/usr/bin/env node
import { mkdir, readFile, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";

const [source, destinationDir] = process.argv.slice(2);
if (!source || !destinationDir) {
  process.stderr.write("Usage: prepare-fixture.mjs <source.jsonl> <destination-dir>\n");
  process.exit(2);
}

const input = await readFile(source, "utf8");
const timestamps = [...input.matchAll(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z/g)].map(
  ([value]) => new Date(value).getTime(),
);
const first = Math.min(...timestamps);
const targetStart = Date.now() - 15 * 60 * 1000;
const shifted = input.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z/g, (value) =>
  new Date(targetStart + new Date(value).getTime() - first).toISOString(),
);
const destination = join(destinationDir, "verify-session.jsonl");
await mkdir(destinationDir, { recursive: true });
await writeFile(destination, shifted);
const now = new Date();
await utimes(destination, now, now);
process.stdout.write(`${destination}\n`);
