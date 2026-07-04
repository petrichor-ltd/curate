#!/usr/bin/env node

import process from "node:process";
import { spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const args = process.argv.slice(2);
const date = args.find((arg) => !arg.startsWith("--"));

function option(name, fallback) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

function numberOption(name, fallback, minimum = 0) {
  const value = Number(option(name, String(fallback)));
  if (!Number.isInteger(value) || value < minimum) {
    console.error(`${name} must be an integer greater than or equal to ${minimum}`);
    process.exit(2);
  }
  return value;
}

if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) {
  console.error(
    "Usage: node scripts/recover-pages-publication.mjs YYYY-MM-DD [--max-rebuilds N] [--poll-attempts N] [--delay-ms N] [--dry-run]",
  );
  process.exit(2);
}

const maxRebuilds = numberOption("--max-rebuilds", 2, 1);
const pollAttempts = numberOption("--poll-attempts", 144, 1);
const delayMs = numberOption("--delay-ms", 5000, 0);
const dryRun = args.includes("--dry-run");
const diagnoseRunId = option("--diagnose-run", "");
const transientPatterns = [
  /Deployment failed, try again later/i,
  /deployment_queued/i,
  /timeout reached/i,
  /timed out/i,
  /failed to create deployment/i,
  /service unavailable/i,
  /server error/i,
  /status code 5\d\d/i,
];

function run(command, commandArgs, { allowFailure = false } = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    const detail = (result.stderr || result.stdout || "command failed").trim();
    throw new Error(`${command} ${commandArgs.join(" ")}: ${detail}`);
  }
  return result;
}

function jsonCommand(command, commandArgs) {
  const result = run(command, commandArgs);
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`${command} returned invalid JSON`);
  }
}

function verify(attempts, waitMs) {
  return run(
    process.execPath,
    [
      "scripts/verify-site-publication.mjs",
      date,
      "--attempts",
      String(attempts),
      "--delay-ms",
      String(waitMs),
    ],
    { allowFailure: true },
  );
}

function pagesRunsForSha(sha) {
  const runs = jsonCommand("gh", [
    "run",
    "list",
    "--limit",
    "30",
    "--json",
    "databaseId,name,status,conclusion,headSha,createdAt,updatedAt,url",
  ]);
  return runs
    .filter((runItem) => runItem.name === "pages build and deployment" && runItem.headSha === sha)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function runDetails(runId) {
  return jsonCommand("gh", [
    "run",
    "view",
    String(runId),
    "--json",
    "status,conclusion,jobs,url",
  ]);
}

async function waitForRun(runItem) {
  let current = runItem;
  for (let attempt = 1; attempt <= pollAttempts; attempt += 1) {
    const details = runDetails(current.databaseId);
    current = { ...current, ...details };
    if (current.status === "completed") return current;
    const unchangedForMs = Date.now() - Date.parse(runItem.updatedAt);
    if (current.status === "queued" && (current.jobs ?? []).length === 0 && unchangedForMs >= 120000) {
      return { ...current, stalled: true };
    }
    if (attempt === 1 || attempt % 6 === 0) {
      console.log(`WAIT pages-run=${current.databaseId} status=${current.status}`);
    }
    if (attempt < pollAttempts) await sleep(delayMs);
  }
  throw new Error(`Pages run ${current.databaseId} did not complete within the polling window`);
}

function classifyFailure(runItem) {
  const details = runDetails(runItem.databaseId);
  const jobs = details.jobs ?? [];
  const build = jobs.find((job) => job.name === "build");
  const report = jobs.find((job) => job.name === "report-build-status");
  const deploy = jobs.find((job) => job.name === "deploy");
  const logs = run("gh", ["run", "view", String(runItem.databaseId), "--log-failed"], {
    allowFailure: true,
  });
  const logText = `${logs.stdout}\n${logs.stderr}`;
  const recognizedTransient = transientPatterns.some((pattern) => pattern.test(logText));
  const healthyBuild = build?.conclusion === "success" && report?.conclusion === "success";
  const deployOnlyFailure = deploy?.conclusion === "failure";

  return {
    recoverable: healthyBuild && deployOnlyFailure && recognizedTransient,
    healthyBuild,
    deployOnlyFailure,
    recognizedTransient,
    logExcerpt: logText
      .split("\n")
      .find((line) => transientPatterns.some((pattern) => pattern.test(line)))
      ?.trim(),
  };
}

async function waitForBuild(repo, expectedSha) {
  for (let attempt = 1; attempt <= pollAttempts; attempt += 1) {
    const build = jsonCommand("gh", ["api", `repos/${repo}/pages/builds/latest`]);
    if (build.commit === expectedSha && build.status === "built") return build;
    if (build.commit === expectedSha && build.status === "errored") {
      throw new Error(`fresh Pages build failed: ${build.error?.message || "unknown Pages error"}`);
    }
    if (attempt === 1 || attempt % 6 === 0) {
      console.log(
        `WAIT pages-build attempt=${attempt}/${pollAttempts} status=${build.status} commit=${build.commit}`,
      );
    }
    if (attempt < pollAttempts) await sleep(delayMs);
  }
  throw new Error("fresh Pages build did not finish within the polling window");
}

try {
  run(process.execPath, ["scripts/validate-daily-entry.mjs", date]);
  run("gh", ["auth", "status"]);

  if (diagnoseRunId) {
    const classification = classifyFailure({ databaseId: diagnoseRunId });
    console.log(JSON.stringify({ runId: diagnoseRunId, ...classification }, null, 2));
    process.exit(classification.recoverable ? 0 : 1);
  }

  const repo = run("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"])
    .stdout.trim();
  const localHead = run("git", ["rev-parse", "HEAD"]).stdout.trim();
  const upstreamHead = run("git", ["rev-parse", "@{upstream}"]).stdout.trim();
  if (localHead !== upstreamHead) {
    throw new Error(`local HEAD ${localHead} does not match upstream ${upstreamHead}`);
  }

  const initialVerification = verify(3, delayMs);
  const initialBuild = jsonCommand("gh", ["api", `repos/${repo}/pages/builds/latest`]);
  if (
    initialVerification.status === 0 &&
    initialBuild.commit === upstreamHead &&
    initialBuild.status === "built"
  ) {
    process.stdout.write(initialVerification.stdout);
    process.exit(0);
  }
  if (initialVerification.status === 0) {
    console.log(
      `WAIT public content matches, but latest Pages build is ${initialBuild.status} at ${initialBuild.commit}`,
    );
  }

  let latestRun = pagesRunsForSha(upstreamHead)[0];
  if (latestRun && latestRun.status !== "completed") latestRun = await waitForRun(latestRun);

  if (latestRun?.stalled) {
    console.log(
      `RECOVERABLE Pages run ${latestRun.databaseId} is queued without jobs and has stopped updating`,
    );
  }

  if (latestRun?.conclusion === "success") {
    const postRunVerification = verify(12, delayMs);
    process.stdout.write(postRunVerification.stdout);
    process.stderr.write(postRunVerification.stderr);
    process.exit(postRunVerification.status === 0 ? 0 : 1);
  }

  if (latestRun?.conclusion === "failure") {
    const classification = classifyFailure(latestRun);
    if (!classification.recoverable) {
      console.error(
        `BLOCKED Pages run ${latestRun.databaseId}: buildHealthy=${classification.healthyBuild} deployOnlyFailure=${classification.deployOnlyFailure} transient=${classification.recognizedTransient}`,
      );
      process.exit(1);
    }
    console.log(
      `RECOVERABLE Pages run ${latestRun.databaseId}: ${classification.logExcerpt || "transient deploy failure"}`,
    );
  } else if (!latestRun) {
    console.log(`RECOVERABLE no Pages run found for upstream ${upstreamHead}`);
  }

  if (dryRun) {
    console.log(`DRY_RUN would request a fresh Pages build for ${repo}@${upstreamHead}`);
    process.exit(0);
  }

  for (let rebuild = 1; rebuild <= maxRebuilds; rebuild += 1) {
    if (rebuild > 1) await sleep(delayMs * 3 * rebuild);
    console.log(`RECOVER rebuild=${rebuild}/${maxRebuilds} repo=${repo} sha=${upstreamHead}`);
    jsonCommand("gh", ["api", "-X", "POST", `repos/${repo}/pages/builds`]);

    try {
      await waitForBuild(repo, upstreamHead);
      const finalVerification = verify(12, delayMs);
      process.stdout.write(finalVerification.stdout);
      process.stderr.write(finalVerification.stderr);
      if (finalVerification.status === 0) process.exit(0);
    } catch (error) {
      console.error(`RECOVER rebuild=${rebuild} failed: ${error.message}`);
    }
  }

  console.error(`FAIL ${date}: Pages recovery exhausted after ${maxRebuilds} fresh builds`);
  process.exit(1);
} catch (error) {
  console.error(`FAIL ${date}: ${error.message}`);
  process.exit(1);
}
