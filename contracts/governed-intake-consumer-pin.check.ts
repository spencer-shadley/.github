/** Pre-merge consumer-pin integration check for governed-intake releases (spencer-shadley/code#8013).
 *
 * Runs the candidate release on this checkout through the github-mcp-worker's own
 * resolution (vendored in governed-intake-worker-admission.ts) against the worker
 * pins on Code's default branch, read at one exact commit. The verdict:
 * - admitted: Code master's deployed worker accepts this release. Pass.
 * - unchanged-pre-existing-drift: the release manifest is byte-identical to the base
 *   and only manifest identity is refused. This PR did not cause it. Pass with a warning.
 * - admitted-by-paired-consumer-pr: refused by master, but the PR declares
 *   `Consumer-Pin-Pair: spencer-shadley/code#N`, and that open (or merged) PR's head
 *   pins admit the release. Pass, and print the required merge order.
 * - refused: fail. The message names the consumer file, the field and both values.
 *
 * Spencer (2026-10-06 7:31 PM PT): a consumer test in .github is fine when it is an
 * example or a real integration test (refines .github#37). This is the integration test.
 * The offline gate (test/consumer-pin-admission.test.ts) replays recorded consumer
 * snapshots. The networked mode below reads the live consumer through `gh api`.
 *
 * Usage (repository root):
 *   node --experimental-strip-types contracts/governed-intake-consumer-pin.check.ts [--base origin/main] [--pr N | --paired-pr N] [--consumer-git <code clone>]
 *   node --experimental-strip-types contracts/governed-intake-consumer-pin.check.ts --case test/fixtures/consumer-pin/<name>.case.json
 * Exit codes: 0 pass, 1 refused (or worker rules drifted from the vendored copy), 2 indeterminate (read failure).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PRODUCER_MANIFEST_PATH, PRODUCER_SOURCE_PATH, PRODUCER_TASK_FORM_PATH, VENDORED_WORKER_RESOLUTION,
  gitBlobSha, resolveWorkerAdmission, workerResolutionDrift,
  type ProducerRelease, type WorkerConsumerPins, type WorkerRefusal, type WorkerResolution,
} from "./governed-intake-worker-admission.ts";

export const CONSUMER_REPOSITORY = "spencer-shadley/code" as const;
export const CONSUMER_DEFAULT_BRANCH = "master" as const;
export const CONSUMER_FILES = {
  publishedPin: "tools/work-spine/governed-intake-worker-published-release.pin.json",
  publishedManifest: "contracts/generated/governed-intake-worker-published/manifest.json",
  preparedPin: "tools/work-spine/governed-intake-candidate-release.pin.json",
  preparedManifest: "contracts/generated/governed-intake-candidate/manifest.json",
} as const;
/** The explicit escape: one trailer line in the .github PR body naming the paired Code PR. */
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
export type GateOutcome = "admitted" | "unchanged-pre-existing-drift" | "admitted-by-paired-consumer-pr" | "refused";
export type GateVerdict = { ok: boolean; outcome: GateOutcome; lines: string[]; master: WorkerResolution; paired?: WorkerResolution };

const MANIFEST_IDENTITY_CODES = new Set(["invalid_pin", "invalid_manifest", "repository_mismatch", "commit_mismatch", "revision_mismatch", "digest_mismatch", "manifest_blob_mismatch"]);
const short = (sha: string | undefined) => (sha ?? "?").slice(0, 8);
const equalBytes = (a: Uint8Array, b: Uint8Array) => a.byteLength === b.byteLength && a.every((byte, index) => byte === b[index]);

export function consumerPinsFromSnapshot(snapshot: ConsumerSnapshot): WorkerConsumerPins {
  const json = (file: string) => {
    const bytes = snapshot.files[file];
    if (!bytes) throw new Error(`consumer snapshot ${snapshot.repository}@${short(snapshot.commit)} is missing ${file}`);
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
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
  return `REFUSED ${refusal.message} [${refusal.stage}, ${refusal.slot} slot]: ${snapshot.repository}@${short(snapshot.commit)}:${file} `
    + `${refusal.field} = ${refusal.expected}; candidate release has ${refusal.actual}`;
}

function describeAdmission(snapshot: ConsumerSnapshot, resolution: Extract<WorkerResolution, { ok: true }>): string {
  const id = resolution.identity;
  return `RESOLVED ${snapshot.repository}@${short(snapshot.commit)} worker ${resolution.slot} slot admits revision ${id.revision} `
    + `producer ${id.producerCommit} digest ${id.payloadDigest}`;
}

/** Pure, deterministic verdict over already-read inputs. */
export function evaluateConsumerPinGate(input: GateInput): GateVerdict {
  const lines: string[] = [];
  const master = resolveWorkerAdmission(input.candidate, consumerPinsFromSnapshot(input.consumer));
  if (master.ok) {
    lines.push(describeAdmission(input.consumer, master));
    return { ok: true, outcome: "admitted", lines, master };
  }
  lines.push(describeRefusal(input.consumer, master.refusal));
  const unchanged = input.baseManifest !== null && equalBytes(input.baseManifest, input.candidate.manifest);
  if (unchanged && MANIFEST_IDENTITY_CODES.has(master.refusal.code)) {
    lines.push("PASS (pre-existing drift): the release manifest is byte-identical to the base, so this PR does not change what the worker sees. "
      + `The deployed worker already refuses the base release. Restore ${CONSUMER_REPOSITORY} pins separately (spencer-shadley/code#8013).`);
    return { ok: true, outcome: "unchanged-pre-existing-drift", lines, master };
  }
  if (input.pairedPullRequest == null) {
    lines.push(`FAIL: ${CONSUMER_REPOSITORY} ${CONSUMER_DEFAULT_BRANCH} would refuse this release${unchanged ? " (released bytes changed without republishing)" : ""}. `
      + `Either publish a release the deployed worker admits, or open the paired ${CONSUMER_REPOSITORY} PR that admits exactly this release `
      + `and declare it in this PR body as "Consumer-Pin-Pair: ${CONSUMER_REPOSITORY}#<number>".`);
    return { ok: false, outcome: "refused", lines, master };
  }
  const paired = input.paired;
  if (!paired || paired.pullRequest !== input.pairedPullRequest) {
    lines.push(`FAIL: declared pairing ${CONSUMER_REPOSITORY}#${input.pairedPullRequest} could not be read.`);
    return { ok: false, outcome: "refused", lines, master };
  }
  if (paired.baseRef !== CONSUMER_DEFAULT_BRANCH || (paired.state !== "open" && !paired.merged)) {
    lines.push(`FAIL: paired ${CONSUMER_REPOSITORY}#${paired.pullRequest} must be open or merged into ${CONSUMER_DEFAULT_BRANCH} `
      + `(state ${paired.state}, merged ${String(paired.merged)}, base ${paired.baseRef}).`);
    return { ok: false, outcome: "refused", lines, master };
  }
  const pairedResolution = resolveWorkerAdmission(input.candidate, consumerPinsFromSnapshot(paired.consumer));
  if (!pairedResolution.ok) {
    lines.push(describeRefusal(paired.consumer, pairedResolution.refusal));
    lines.push(`FAIL: paired ${CONSUMER_REPOSITORY}#${paired.pullRequest} head ${short(paired.consumer.commit)} does not admit this release either.`);
    return { ok: false, outcome: "refused", lines, master, paired: pairedResolution };
  }
  lines.push(describeAdmission(paired.consumer, pairedResolution));
  lines.push(`PASS (paired): merge ${CONSUMER_REPOSITORY}#${paired.pullRequest} at head ${paired.consumer.commit} first`
    + (pairedResolution.slot === "prepared"
      ? `. It stages the ${pairedResolution.slot} slot, so the deployed worker keeps serving the current release. Read back worker health, then merge this PR.`
      : `, then this PR as soon as that deploy is live. The ${pairedResolution.slot} slot admits one identity per revision, so expect a short paired-merge window. Read back worker health after both merges.`));
  return { ok: true, outcome: "admitted-by-paired-consumer-pr", lines, master, paired: pairedResolution };
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
  const source = new TextDecoder("utf-8", { fatal: true }).decode(reader.read(commit, VENDORED_WORKER_RESOLUTION.path));
  return workerResolutionDrift(source).map((drift) => `DRIFT ${CONSUMER_REPOSITORY}@${short(commit)}:${VENDORED_WORKER_RESOLUTION.path} ${drift.function} `
    + `sha256 ${drift.actual ?? "missing"} != vendored ${drift.expected}; re-vendor contracts/governed-intake-worker-admission.ts before trusting this verdict.`);
}

export function readPairedConsumer(reader: ConsumerReader, pullRequest: number): PairedConsumer {
  const pr = reader.pullRequest(pullRequest);
  if (!/^[0-9a-f]{40}$/.test(pr.head)) throw new Error(`could not read ${CONSUMER_REPOSITORY}#${pullRequest}`);
  return { pullRequest, state: pr.state, merged: pr.merged, baseRef: pr.baseRef, consumer: readConsumerSnapshot(reader, pr.head) };
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
      return verdict.ok ? 0 : 1;
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
      out(`INDETERMINATE: cannot read ${PRODUCER_MANIFEST_PATH} at base ${baseRef}; fetch it or pass --base <ref>.`);
      return 2;
    }
    const prNumber = option(argv, "--pr");
    const explicitPair = option(argv, "--paired-pr");
    let pairedPullRequest: number | null = explicitPair ? Number(explicitPair) : null;
    if (pairedPullRequest === null && prNumber) {
      const pr = (consumerGit
        ? JSON.parse(run("gh", ["pr", "view", String(Number(prNumber)), "--repo", "spencer-shadley/.github", "--json", "body"]))
        : api(`/repos/spencer-shadley/.github/pulls/${Number(prNumber)}`)) as { body?: string | null };
      pairedPullRequest = parsePairingTrailer(pr?.body);
    }
    const consumer = readConsumerSnapshot(reader, option(argv, "--consumer-ref") ?? CONSUMER_DEFAULT_BRANCH);
    out(`candidate: spencer-shadley/.github@${head} (base ${baseRef}); consumer: ${CONSUMER_REPOSITORY}@${consumer.commit}`);
    const drift = readWorkerDrift(reader, consumer.commit);
    let paired: PairedConsumer | null = null;
    const verdict0 = evaluateConsumerPinGate({ candidate, baseManifest, consumer, pairedPullRequest: null });
    if (!verdict0.ok && pairedPullRequest !== null) {
      paired = readPairedConsumer(reader, pairedPullRequest);
      drift.push(...readWorkerDrift(reader, paired.consumer.commit));
    }
    drift.forEach(out);
    const verdict = paired || (!verdict0.ok && pairedPullRequest !== null)
      ? evaluateConsumerPinGate({ candidate, baseManifest, consumer, pairedPullRequest, paired })
      : verdict0;
    verdict.lines.forEach(out);
    out(`verdict: ${drift.length > 0 ? "refused (worker rules drifted)" : verdict.outcome}`);
    return drift.length === 0 && verdict.ok ? 0 : 1;
  } catch (error) {
    out(`INDETERMINATE: ${(error as Error).message}`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
