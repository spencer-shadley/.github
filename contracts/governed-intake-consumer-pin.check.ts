/** Advisory consumer drift diagnostics (code#8212, code#7736).
 * Every finding names the consumer file and both values. Exit 0 always permits progress;
 * unreadable inputs warn that compatibility could not be assessed. No paired PR is required.
 * Usage: node --experimental-strip-types contracts/governed-intake-consumer-pin.check.ts
 *   [--case <fixture>] [--pr N] [--head <sha>] [--consumer-git <clone>]
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PRODUCER_MANIFEST_PATH, PRODUCER_REPOSITORY, PRODUCER_SOURCE_PATH, PRODUCER_TASK_FORM_PATH,
  gitBlobSha, resolveWorkerAdmission,
  type ProducerRelease, type WorkerConsumerPins, type WorkerRefusal, type WorkerResolution,
} from "./governed-intake-worker-admission.ts";

import { describeWorkerSourceDrift } from "./governed-intake-worker-diagnostics.ts";

export const CONSUMER_REPOSITORY = "spencer-shadley/code" as const;
export const CONSUMER_DEFAULT_BRANCH = "master" as const;
export const CONSUMER_FILES = {
  publishedPin: "tools/work-spine/governed-intake-worker-published-release.pin.json",
  publishedManifest: "contracts/generated/governed-intake-worker-published/manifest.json",
  preparedPin: "tools/work-spine/governed-intake-candidate-release.pin.json",
  preparedManifest: "contracts/generated/governed-intake-candidate/manifest.json",
} as const;
/** Historical fixture trailer: one trailer line in the .github PR body naming the paired Code PR. */
export const PAIRING_TRAILER = /^Consumer-Pin-Pair:[ \t]*spencer-shadley\/code#(\d+)[ \t]*$/m;

export type ConsumerSnapshot = { repository: string; commit: string; files: Record<string, Uint8Array> };
export type PairedConsumer = { pullRequest: number; state: string; merged: boolean; baseRef: string; consumer: ConsumerSnapshot };
export type GateInput = {
  candidate: ProducerRelease & { commit?: string };
  /** Release manifest bytes on the base branch, or null when absent. */
  baseManifest: Uint8Array | null;
  consumer: ConsumerSnapshot;
  pairedPullRequest?: number | null;
  paired?: PairedConsumer | null;
};
export type GateOutcome = "admitted" | "consumer-drift-warning" | "producer-warning";
export type GateVerdict = { ok: boolean; outcome: GateOutcome; lines: string[]; master: WorkerResolution; paired?: WorkerResolution };

const commitValue = (sha: string | undefined) => sha ?? "?";

export function consumerPinsFromSnapshot(snapshot: ConsumerSnapshot): WorkerConsumerPins {
  const json = (file: string) => {
    const bytes = snapshot.files[file];
    if (!bytes) throw new Error(`consumer snapshot ${snapshot.repository}@${commitValue(snapshot.commit)} is missing ${file}`);
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch (error) {
      throw new Error(`consumer snapshot ${snapshot.repository}@${snapshot.commit}:${file} invalid UTF-8 JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const hasPrepared = snapshot.files[CONSUMER_FILES.preparedPin] !== undefined;
  return {
    published: { pin: json(CONSUMER_FILES.publishedPin), manifest: json(CONSUMER_FILES.publishedManifest) },
    prepared: hasPrepared ? { pin: json(CONSUMER_FILES.preparedPin), manifest: json(CONSUMER_FILES.preparedManifest) } : null,
  };
}

function describeRefusal(snapshot: ConsumerSnapshot, refusal: WorkerRefusal): string {
  const file = refusal.field.startsWith("cached manifest")
    ? (refusal.slot === "prepared" ? CONSUMER_FILES.preparedManifest : CONSUMER_FILES.publishedManifest)
    : (refusal.slot === "prepared" ? CONSUMER_FILES.preparedPin : CONSUMER_FILES.publishedPin);
  return `WARNING ${refusal.message} [${refusal.stage}, ${refusal.slot} slot]: ${snapshot.repository}@${commitValue(snapshot.commit)}:${file} `
    + `${refusal.field}: pinned value = ${refusal.expected}; current value = ${refusal.actual}; admission proceeds. `
    + "Consumer compatibility may differ; weigh the reported values against the current producer release.";
}

function describeAdmission(snapshot: ConsumerSnapshot, resolution: Extract<WorkerResolution, { ok: true }>): string {
  const id = resolution.identity;
  return `RESOLVED ${snapshot.repository}@${commitValue(snapshot.commit)} current producer resolves revision ${id.revision} `
    + `producer ${id.producerCommit} digest ${id.payloadDigest}`;
}

/** Pure diagnostics. Consumer snapshots are evidence, never a merge prerequisite. */
export function evaluateConsumerPinGate(input: GateInput): GateVerdict {
  const master = resolveWorkerAdmission(input.candidate, consumerPinsFromSnapshot(input.consumer));
  const lines: string[] = [];
  if (!master.ok) {
    lines.push(`WARNING producer ${PRODUCER_REPOSITORY}@${input.candidate.commit ?? "working-tree"}: ${master.refusal.field} `
      + `${master.refusal.code}; expected value = ${master.refusal.expected}; current value = ${master.refusal.actual}; `
      + "admission proceeds. Repair the reported producer bytes before relying on this release.");
    return { ok: true, outcome: "producer-warning", lines, master };
  }
  master.warnings.forEach((warning) => lines.push(describeRefusal(input.consumer, warning)));
  lines.push(describeAdmission(input.consumer, master));
  return { ok: true, outcome: master.warnings.length ? "consumer-drift-warning" : "admitted", lines, master };
}

export function parsePairingTrailer(body: string | null | undefined): number | null {
  const match = PAIRING_TRAILER.exec(body ?? "");
  return match ? Number(match[1]) : null;
}

// ---------------------------------------------------------------------------
// Networked reads. Default: `gh api` REST (the same contents endpoints the worker uses).
// `--consumer-git <code clone>` reads the same exact-commit objects over git instead
// (no REST quota); PR metadata then comes from `gh pr view` (GraphQL).

export type GithubJson = (apiPath: string) => unknown;
export type PullRequestMeta = { state: string; merged: boolean; baseRef: string; head: string };
export interface ConsumerReader {
  resolve(ref: string): string;
  read(commit: string, file: string): Uint8Array;
  pullRequest(number: number): PullRequestMeta;
}

export function ghApi(apiPath: string): unknown {
  return JSON.parse(run("gh", ["api", apiPath]));
}

function run(command: string, args: string[], cwd?: string): string {
  try {
    return execFileSync(command, args, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? error);
    throw new Error(`${command} ${args.join(" ")} failed: ${stderr.trim().split("\n").slice(-2).join(" ")}`);
  }
}

export function restConsumerReader(api: GithubJson = ghApi): ConsumerReader {
  return {
    resolve(ref) {
      return String((api(`/repos/${CONSUMER_REPOSITORY}/commits/${encodeURIComponent(ref)}`) as { sha?: string })?.sha);
    },
    read(commit, file) {
      const response = api(`/repos/${CONSUMER_REPOSITORY}/contents/${file}?ref=${commit}`) as { content?: string; encoding?: string; sha?: string };
      if (response?.encoding !== "base64" || typeof response.content !== "string") throw new Error(`${CONSUMER_REPOSITORY}@${commit}:${file} did not return base64 content`);
      const bytes = new Uint8Array(Buffer.from(response.content.replaceAll("\n", ""), "base64"));
      if (gitBlobSha(bytes) !== response.sha) throw new Error(`${CONSUMER_REPOSITORY}@${commit}:${file} bytes do not hash to blob ${String(response.sha)}`);
      return bytes;
    },
    pullRequest(number) {
      const pr = api(`/repos/${CONSUMER_REPOSITORY}/pulls/${number}`) as { state?: string; merged?: boolean; base?: { ref?: string }; head?: { sha?: string } };
      return { state: String(pr?.state), merged: pr?.merged === true, baseRef: String(pr?.base?.ref), head: String(pr?.head?.sha) };
    },
  };
}

export function gitConsumerReader(clone: string): ConsumerReader {
  const git = (...args: string[]) => run("git", args, clone);
  // A shallow (e.g. `--depth=1 --filter=blob:none`) clone stays shallow; a full clone is never made shallow.
  const fetch = (ref: string) => git("fetch", "--quiet", "--no-tags", ...(git("rev-parse", "--is-shallow-repository").trim() === "true" ? ["--depth=1"] : []), "origin", ref);
  return {
    resolve(ref) {
      fetch(ref);
      return git("rev-parse", "FETCH_HEAD").trim();
    },
    read(commit, file) {
      return new Uint8Array(execFileSync("git", ["cat-file", "blob", `${commit}:${file}`], { cwd: clone, maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }));
    },
    pullRequest(number) {
      const pr = JSON.parse(run("gh", ["pr", "view", String(number), "--repo", CONSUMER_REPOSITORY, "--json", "state,baseRefName,headRefOid"])) as { state?: string; baseRefName?: string; headRefOid?: string };
      fetch(`pull/${number}/head`);
      const fetched = git("rev-parse", "FETCH_HEAD").trim();
      if (fetched !== pr.headRefOid) throw new Error(`${CONSUMER_REPOSITORY}#${number} head moved while reading (${String(pr.headRefOid)} vs ${fetched})`);
      return { state: String(pr.state).toLowerCase() === "merged" ? "closed" : String(pr.state).toLowerCase(), merged: pr.state === "MERGED", baseRef: String(pr.baseRefName), head: fetched };
    },
  };
}

export function readConsumerSnapshot(reader: ConsumerReader, ref: string): ConsumerSnapshot {
  const commit = reader.resolve(ref);
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`could not resolve ${CONSUMER_REPOSITORY}@${ref} to a commit`);
  const files = Object.fromEntries(Object.values(CONSUMER_FILES).map((file) => [file, reader.read(commit, file)]));
  return { repository: CONSUMER_REPOSITORY, commit, files };
}

export function readWorkerDrift(reader: ConsumerReader, commit: string): string[] {
  return describeWorkerSourceDrift(file => reader.read(commit, file), commit);
}

export function readPairedConsumer(reader: ConsumerReader, pullRequest: number): PairedConsumer {
  const pr = reader.pullRequest(pullRequest);
  if (!/^[0-9a-f]{40}$/.test(pr.head)) throw new Error(`could not read ${CONSUMER_REPOSITORY}#${pullRequest}`);
  return { pullRequest, state: pr.state, merged: pr.merged, baseRef: pr.baseRef, consumer: readConsumerSnapshot(reader, pr.head) };
}

export type ProducerPullRequest = { number: number; head: string; body: string; state: string; baseRef: string };

/** PR N of this repository: REST through `api`, or `gh pr view` (GraphQL) when `api` is null. */
export function readProducerPullRequest(number: number, api: GithubJson | null): ProducerPullRequest {
  if (api === null) {
    const pr = JSON.parse(run("gh", ["pr", "view", String(number), "--repo", PRODUCER_REPOSITORY, "--json", "body,headRefOid,state,baseRefName"])) as {
      body?: string | null; headRefOid?: string; state?: string; baseRefName?: string;
    };
    return { number, head: String(pr?.headRefOid ?? ""), body: pr?.body ?? "", state: String(pr?.state ?? "").toLowerCase(), baseRef: String(pr?.baseRefName ?? "") };
  }
  const pr = api(`/repos/${PRODUCER_REPOSITORY}/pulls/${number}`) as { body?: string | null; state?: string; head?: { sha?: string }; base?: { ref?: string } };
  return { number, head: String(pr?.head?.sha ?? ""), body: pr?.body ?? "", state: String(pr?.state ?? ""), baseRef: String(pr?.base?.ref ?? "") };
}

/**
 * Exact-head binding (.github#57 review): the checkout must be the commit the verdict is for.
 * Returns a diagnostic reason, or null when the checkout HEAD equals `--head` and PR N's current head.
 */
export function checkoutHeadMismatch(checkoutHead: string, expectedHead: string | undefined, pr: { number: number; head: string } | null): string | null {
  const full = /^[0-9a-f]{40}$/;
  if (expectedHead !== undefined && !full.test(expectedHead)) return `--head must be a full 40-hex commit (got ${JSON.stringify(expectedHead)}).`;
  if ((expectedHead !== undefined || pr) && !full.test(checkoutHead)) return `checkout HEAD is not a commit (${checkoutHead}); cannot bind the verdict to an exact head.`;
  if (expectedHead !== undefined && checkoutHead !== expectedHead) return `checkout HEAD ${checkoutHead} is not the requested --head ${expectedHead}.`;
  if (pr && !full.test(pr.head)) return `could not read the head commit of ${PRODUCER_REPOSITORY}#${pr.number}.`;
  if (pr && checkoutHead !== pr.head) return `checkout HEAD ${checkoutHead} is not ${PRODUCER_REPOSITORY}#${pr.number}'s current head ${pr.head}; check out that exact head and re-run.`;
  return null;
}

// ---------------------------------------------------------------------------
// Recorded cases (offline replay; test/fixtures/consumer-pin/*.case.json).

type CaseFiles = { commit: string; files: Record<string, string> };
export type RecordedCase = {
  schema: "GovernedIntakeConsumerPinCaseV1";
  case: string;
  candidate: CaseFiles;
  base: CaseFiles;
  consumer: CaseFiles & { repository: string };
  paired?: { pullRequest: number; state: string; merged: boolean; baseRef: string; consumer: CaseFiles & { repository: string } };
};

export function loadRecordedCase(caseFile: string): { recorded: RecordedCase; input: GateInput } {
  const recorded = JSON.parse(readFileSync(caseFile, "utf8")) as RecordedCase;
  const blobs = path.join(path.dirname(caseFile), "blobs");
  const blob = (sha: string) => {
    const bytes = new Uint8Array(readFileSync(path.join(blobs, sha)));
    if (gitBlobSha(bytes) !== sha) throw new Error(`fixture blob ${sha} does not hash to its name`);
    return bytes;
  };
  const snapshot = (side: CaseFiles & { repository: string }): ConsumerSnapshot => ({
    repository: side.repository, commit: side.commit,
    files: Object.fromEntries(Object.entries(side.files).map(([file, sha]) => [file, blob(sha)])),
  });
  const input: GateInput = {
    candidate: {
      commit: recorded.candidate.commit,
      manifest: blob(recorded.candidate.files[PRODUCER_MANIFEST_PATH]),
      source: blob(recorded.candidate.files[PRODUCER_SOURCE_PATH]),
      taskForm: blob(recorded.candidate.files[PRODUCER_TASK_FORM_PATH]),
    },
    baseManifest: recorded.base.files[PRODUCER_MANIFEST_PATH] ? blob(recorded.base.files[PRODUCER_MANIFEST_PATH]) : null,
    consumer: snapshot(recorded.consumer),
    pairedPullRequest: recorded.paired?.pullRequest ?? null,
    paired: recorded.paired ? { ...recorded.paired, consumer: snapshot(recorded.paired.consumer) } : null,
  };
  return { recorded, input };
}

// ---------------------------------------------------------------------------
// CLI

function option(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function git(args: string[], root: string): Buffer {
  return execFileSync("git", args, { cwd: root, maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

export function main(argv: string[], api: GithubJson = ghApi, root = process.cwd()): number {
  const consumerGit = option(argv, "--consumer-git");
  const reader = consumerGit ? gitConsumerReader(path.resolve(root, consumerGit)) : restConsumerReader(api);
  const out = (line: string) => process.stdout.write(`${line}\n`);
  try {
    const caseFile = option(argv, "--case");
    if (caseFile) {
      const { recorded, input } = loadRecordedCase(path.resolve(root, caseFile));
      out(`case: ${recorded.case}`);
      const verdict = evaluateConsumerPinGate(input);
      verdict.lines.forEach(out);
      out(`verdict: ${verdict.outcome}`);
      return 0;
    }
    const baseRef = option(argv, "--base") ?? "origin/main";
    const read = (file: string) => new Uint8Array(readFileSync(path.join(root, file)));
    let head = "working-tree";
    try { head = git(["rev-parse", "HEAD"], root).toString().trim(); } catch { /* not a git checkout */ }
    const candidate = { commit: head, manifest: read(PRODUCER_MANIFEST_PATH), source: read(PRODUCER_SOURCE_PATH), taskForm: read(PRODUCER_TASK_FORM_PATH) };
    let baseManifest: Uint8Array | null;
    try {
      baseManifest = new Uint8Array(git(["show", `${baseRef}:${PRODUCER_MANIFEST_PATH}`], root));
    } catch {
      out(`WARNING diagnostic unavailable: cannot read ${PRODUCER_MANIFEST_PATH} at base ${baseRef}; fetch it or pass --base <ref>.`);
      return 0;
    }
    const prNumber = option(argv, "--pr");
    const expectedHead = option(argv, "--head");
    const headMismatch = checkoutHeadMismatch(head, expectedHead, null);
    if (headMismatch) {
      out(`WARNING diagnostic unavailable: ${headMismatch}; compatibility could not be assessed; admission proceeds.`);
      return 0;
    }
    if (prNumber) {
      const pr = readProducerPullRequest(Number(prNumber), consumerGit ? null : api);
      // The verdict is about one exact head: a checkout that is not PR N's current head says nothing about PR N.
      const prMismatch = checkoutHeadMismatch(head, expectedHead, { number: Number(prNumber), head: pr.head });
      if (prMismatch) {
        out(`WARNING diagnostic unavailable: ${prMismatch}; compatibility could not be assessed; admission proceeds.`);
        return 0;
      }
    }
    const consumer = readConsumerSnapshot(reader, option(argv, "--consumer-ref") ?? CONSUMER_DEFAULT_BRANCH);
    out(`candidate: spencer-shadley/.github@${head} (base ${baseRef}); consumer: ${CONSUMER_REPOSITORY}@${consumer.commit}`);
    const drift = readWorkerDrift(reader, consumer.commit);
    const verdict = evaluateConsumerPinGate({ candidate, baseManifest, consumer });
    drift.forEach(out);
    verdict.lines.forEach(out);
    out(`verdict: ${verdict.outcome}${drift.length > 0 ? " (worker-rule drift warning)" : ""}; admission proceeds`);
    return 0;
  } catch (error) {
    out(`WARNING diagnostic unavailable: ${(error as Error).message}; compatibility could not be assessed; admission proceeds.`);
    return 0;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
