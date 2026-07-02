#!/usr/bin/env node

import fs from "node:fs";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";

const args = process.argv.slice(2);
const date = args.find((arg) => !arg.startsWith("--"));

function option(name, fallback) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) {
  console.error(
    "Usage: node scripts/verify-site-publication.mjs YYYY-MM-DD [--base-url URL] [--attempts N] [--delay-ms N] [--timeout-ms N]",
  );
  process.exit(2);
}

const cname = fs.readFileSync("CNAME", "utf8").trim();
const baseUrl = option("--base-url", `https://${cname}`).replace(/\/$/, "");
const attempts = Number(option("--attempts", "72"));
const delayMs = Number(option("--delay-ms", "10000"));
const timeoutMs = Number(option("--timeout-ms", "15000"));
const localPath = `entries/${date}.md`;

if (
  !Number.isInteger(attempts) ||
  attempts < 1 ||
  !Number.isFinite(delayMs) ||
  delayMs < 0 ||
  !Number.isFinite(timeoutMs) ||
  timeoutMs < 1
) {
  console.error("attempts must be positive; delay-ms must be non-negative; timeout-ms must be positive");
  process.exit(2);
}

if (!baseUrl.startsWith("https://")) {
  console.error("base-url must use HTTPS");
  process.exit(2);
}

let lastError = "publication not checked";

for (let attempt = 1; attempt <= attempts; attempt += 1) {
  const cacheBust = `${Date.now()}-${attempt}`;
  try {
    const localEntries = JSON.parse(fs.readFileSync("entries.json", "utf8"));
    const localEntry = localEntries.find((candidate) => candidate.id === date && candidate.date === date);
    if (!localEntry) throw new Error(`local index does not contain ${date}`);
    const localMarkdown = fs.readFileSync(localPath, "utf8").replace(/\r\n/g, "\n").trim();

    const indexResponse = await fetch(`${baseUrl}/entries.json?verify=${cacheBust}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!indexResponse.ok) throw new Error(`entries.json returned ${indexResponse.status}`);
    const entries = await indexResponse.json();
    const entry = entries.find((candidate) => candidate.id === date && candidate.date === date);
    if (!entry) throw new Error(`live index does not contain ${date}`);
    if (JSON.stringify(entry) !== JSON.stringify(localEntry)) {
      throw new Error("live index metadata does not match the local index");
    }

    const articleResponse = await fetch(`${baseUrl}/${entry.path}?verify=${cacheBust}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!articleResponse.ok) throw new Error(`${entry.path} returned ${articleResponse.status}`);
    const liveMarkdown = (await articleResponse.text()).replace(/\r\n/g, "\n").trim();
    if (liveMarkdown !== localMarkdown) throw new Error("live Markdown does not match the local entry");

    const markers = [...liveMarkdown.matchAll(/^##\s+([1-4])\.[^\n]*\n/gm)];
    if (markers.length !== 4) throw new Error(`live entry has ${markers.length} numbered sections`);
    for (let index = 0; index < markers.length; index += 1) {
      const start = markers[index].index + markers[index][0].length;
      const end = markers[index + 1]?.index ?? liveMarkdown.length;
      if (!liveMarkdown.slice(start, end).trim()) throw new Error(`live section ${index + 1} is empty`);
    }

    console.log(
      JSON.stringify(
        { ok: true, date, baseUrl, attempt, path: entry.path, liveSections: markers.length },
        null,
        2,
      ),
    );
    process.exit(0);
  } catch (error) {
    lastError = error.message;
    if (attempt === 1 || attempt % 6 === 0 || attempt === attempts) {
      console.log(`WAIT attempt=${attempt}/${attempts} reason=${lastError}`);
    }
    if (attempt < attempts) await sleep(delayMs);
  }
}

console.error(`FAIL ${date}: ${lastError}`);
process.exit(1);
