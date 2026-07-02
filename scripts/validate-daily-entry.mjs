#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
const date = args.find((arg) => !arg.startsWith("--"));
const asJson = args.includes("--json");

if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) {
  console.error("Usage: node scripts/validate-daily-entry.mjs YYYY-MM-DD [--json]");
  process.exit(2);
}

const root = process.cwd();
const entryPath = path.join(root, "entries", `${date}.md`);
const indexPath = path.join(root, "entries.json");
const strictFormatSince = "2026-07-01";
const strictFormat = date >= strictFormatSince;
const errors = [];
const warnings = [];

function visibleLength(value) {
  return [...value.replace(/[*_#`]/g, "").replace(/\s/g, "")].length;
}

function fail(message) {
  errors.push(message);
}

if (!fs.existsSync(entryPath)) fail(`Missing ${path.relative(root, entryPath)}`);
if (!fs.existsSync(indexPath)) fail("Missing entries.json");

let markdown = "";
let sections = {};
let metrics = {};

if (errors.length === 0) {
  markdown = fs.readFileSync(entryPath, "utf8").replace(/\r\n/g, "\n");
  const markers = [...markdown.matchAll(/^##\s+([1-4])\.[^\n]*\n/gm)];
  if (markers.length !== 4 || markers.map((marker) => marker[1]).join("") !== "1234") {
    fail("Entry must contain exactly four ordered numbered sections");
  } else {
    sections = Object.fromEntries(
      markers.map((marker, index) => {
        const start = marker.index + marker[0].length;
        const end = markers[index + 1]?.index ?? markdown.length;
        return [marker[1], markdown.slice(start, end).trim()];
      }),
    );

    for (const number of ["1", "2", "3", "4"]) {
      if (!sections[number]) fail(`Section ${number} is empty`);
    }

    const polishedChars = visibleLength(sections["2"] ?? "");
    const videoChars = visibleLength(sections["3"] ?? "");
    const videoCoreSentences = (sections["3"]?.match(/\*\*[^*]+\*\*/g) ?? []).length;
    const [articleBody = "", sourcesBlock = ""] = (sections["4"] ?? "").split(/^###\s+參考來源\s*$/m);
    const articleWithoutTitle = articleBody.replace(/^###\s+[^\n]+\n?/, "").trim();
    const articleChars = visibleLength(articleWithoutTitle);
    const sourceLines = sourcesBlock.match(/^-\s+.+https:\/\/\S+/gm) ?? [];

    metrics = {
      originalChars: visibleLength(sections["1"] ?? ""),
      polishedChars,
      videoChars,
      estimatedVideoMinutes: [
        Number((videoChars / 320).toFixed(1)),
        Number((videoChars / 230).toFixed(1)),
      ],
      videoCoreSentences,
      articleChars,
      sourceCount: sourceLines.length,
    };

    const formatChecks = [
      [polishedChars >= 200 && polishedChars <= 300, `AI polished version must be 200-300 visible characters; got ${polishedChars}`],
      [videoChars >= 1600 && videoChars <= 2560, `Video script must be 1600-2560 visible characters; got ${videoChars}`],
      [videoCoreSentences >= 2 && videoCoreSentences <= 4, `Video script must contain 2-4 bold core sentences; got ${videoCoreSentences}`],
      [articleChars >= 1100 && articleChars <= 1300, `Article body must be 1100-1300 visible characters; got ${articleChars}`],
    ];
    for (const [passed, message] of formatChecks) {
      if (!passed) {
        if (strictFormat) fail(message);
        else warnings.push(`Legacy entry before ${strictFormatSince}: ${message}`);
      }
    }
    if (sourceLines.length === 0) {
      warnings.push("No reference source found; confirm that external material is genuinely unnecessary");
    } else if (sourceLines.length > 3) {
      fail(`Article must use at most 3 reference sources; got ${sourceLines.length}`);
    }
  }
}

let indexEntry = null;
if (fs.existsSync(indexPath)) {
  try {
    const entries = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    if (!Array.isArray(entries)) throw new Error("root is not an array");

    const ids = entries.map((entry) => entry.id);
    if (new Set(ids).size !== ids.length) fail("entries.json contains duplicate ids");

    const sortedDates = entries.map((entry) => entry.date).sort((a, b) => b.localeCompare(a));
    if (entries.map((entry) => entry.date).join("|") !== sortedDates.join("|")) {
      fail("entries.json is not sorted newest first");
    }

    indexEntry = entries.find((entry) => entry.id === date || entry.date === date) ?? null;
    if (!indexEntry) {
      fail(`entries.json has no index for ${date}`);
    } else {
      const required = ["id", "date", "title", "summary", "themes", "readingMinutes", "path"];
      for (const key of required) {
        if (indexEntry[key] === undefined || indexEntry[key] === "") fail(`Index field ${key} is missing`);
      }
      if (indexEntry.id !== date || indexEntry.date !== date) fail("Index id/date does not match target date");
      if (indexEntry.path !== `entries/${date}.md`) fail("Index path does not match target entry");
      if (!Array.isArray(indexEntry.themes) || indexEntry.themes.length === 0) fail("Index themes must be non-empty");
      if (!Number.isFinite(indexEntry.readingMinutes) || indexEntry.readingMinutes <= 0) {
        fail("Index readingMinutes must be a positive number");
      }
    }
  } catch (error) {
    fail(`entries.json is invalid: ${error.message}`);
  }
}

const result = {
  ok: errors.length === 0,
  date,
  entry: path.relative(root, entryPath),
  metrics,
  indexEntry,
  warnings,
  errors,
  policy: { strictFormatSince, strictFormat },
};

if (asJson) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`${result.ok ? "PASS" : "FAIL"} ${date}`);
  if (Object.keys(metrics).length) console.log(JSON.stringify(metrics));
  for (const warning of warnings) console.log(`WARN ${warning}`);
  for (const error of errors) console.error(`ERROR ${error}`);
}

process.exit(result.ok ? 0 : 1);
