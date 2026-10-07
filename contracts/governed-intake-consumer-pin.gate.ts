/** Automatic merge gate for release-touching pull requests (spencer-shadley/code#8036).
 *
 * `fleet-cli gh pr-merge` runs this repository's `local-ci.json` commands in a checkout of the
 * exact PR head before any merge effect, and Code's native lander runs this file from the base
 * branch against the same head. Nobody has to remember `npm run consumer-pin:check`.
 *
 * - Not release-touching (the PR changes none of RELEASE_TRIGGER_PATHS): pass, offline, no reads.
 * - Release-touching: bind to the exact PR head, run the consumer-pin check against Code `master`
 *   (governed-intake-consumer-pin.check.ts), then read back the deployed github-mcp-worker and run
 *   the same check against the Code commit it actually serves. Both must admit the release.
 *   `admitted-by-paired-consumer-pr` is never enough to merge: the paired Code PR merges first,
 *   its deploy is read back, and only then does this gate pass (the master and deployed runs admit).
 * - Anything else refuses: exit 1 for a refusal (including `DRIFT … re-vendor`), exit 2 when an
 *   input could not be read. A missing receipt is never a pass.
 *
 * Every run prints one `consumer-pin-gate-receipt: {json}` line binding the `.github` head, the
 * Code master commit, the deployed Code commit, the paired PR and the verdict lines. Output is
 * scrubbed of tokens and credential-bearing URLs.
 *
 * Usage (repository root, at the PR head):
 *   node --experimental-strip-types contracts/governed-intake-consumer-pin.gate.ts [--pr N] [--head <sha>] [--base origin/main]
 * Without `--pr`, the PR is the single open PR to main whose head is the checkout HEAD.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONSUMER_REPOSITORY, checkoutHeadMismatch, evaluateConsumerPinGate, ghApi, parsePairingTrailer,
  readConsumerSnapshot, readPairedConsumer, readProducerPullRequest, readWorkerDrift, restConsumerReader,
  type ConsumerReader, type GateOutcome, type GithubJson, type PairedConsumer, type ProducerPullRequest,
} from "./governed-intake-consumer-pin.check.ts";
import { PRODUCER_MANIFEST_PATH, PRODUCER_REPOSITORY, PRODUCER_SOURCE_PATH, PRODUCER_TASK_FORM_PATH } from "./governed-intake-worker-admission.ts";

/** The three inputs the worker verifies on every request. A directory entry ends in `/`. */
export const RELEASE_TRIGGER_PATHS = [
  "contracts/generated/governed-intake/",
  PRODUCER_SOURCE_PATH,
  PRODUCER_TASK_FORM_PATH,
] as const;
export const WORKER_HEALTH_URL = "https://github-mcp-worker.spencer-shadley.workers.dev/";
export const RECEIPT_PREFIX = "consumer-pin-gate-receipt: ";
export const MERGEABLE_OUTCOMES: ReadonlySet<GateOutcome> = new Set(["admitted", "unchanged-pre-existing-drift"]);

export type GateCode =
  | "not-release-touching" | "admitted" | "refused" | "worker-rules-drifted"
  | "paired-consumer-not-landed" | "deployed-worker-refuses" | "indeterminate";
export type GateReceipt = {
  schema: "GovernedIntakeConsumerPinGateReceiptV1";
  ok: boolean;
  code: GateCode;
  producer: { repository: string; pullRequest: number | null; head: string; base: string; mergeBase: string | null; triggerPaths: string[] };
  consumer: { repository: string; masterCommit: string | null; deployedCommit: string | null; pairedPullRequest: number | null; pairedHead: string | null };
  verdict: { master: GateOutcome | null; deployed: GateOutcome | null };
  lines: string[];
};

export interface GateDeps {
  /** git in the candidate checkout. */
  git(args: string[]): string;
  readCandidate(file: string): Uint8Array;
  pullRequest(number: number): ProducerPullRequest;
  /** Open PRs whose head is `sha`. */
  pullRequestsForHead(sha: string): ProducerPullRequest[];
  consumer: ConsumerReader;
  drift(reader: ConsumerReader, commit: string): string[];
  workerHealth(): Promise<unknown>;
}

const CREDENTIAL_PATTERNS: Array<[RegExp, string]> = [
  [/(https?:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/gi, "$1[REDACTED]@"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, "[REDACTED]"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, "[REDACTED]"],
  [/\b(authorization|token|bearer)(\s*[:=]\s*|\s+)("?)[A-Za-z0-9._\-]{16,}\3/gi, "$1$2[REDACTED]"],
];
/** Strip tokens and credential-bearing URLs from anything the gate prints (AC8). */
export function redactCredentials(text: string): string {
  return CREDENTIAL_PATTERNS.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), text);
}

export function releaseTouchingPaths(changed: readonly string[]): string[] {
  return changed.filter((file) => RELEASE_TRIGGER_PATHS.some((trigger) => trigger.endsWith("/") ? file.startsWith(trigger) : file === trigger));
}

function option(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

class Indeterminate extends Error {}

/** One gate run. Never throws: every failure becomes a refusing receipt. */
export async function runConsumerPinGate(argv: string[], deps: GateDeps): Promise<GateReceipt> {
  const base = option(argv, "--base") ?? "origin/main";
  const prOption = option(argv, "--pr");
  const expectedHead = option(argv, "--head");
  const receipt: GateReceipt = {
    schema: "GovernedIntakeConsumerPinGateReceiptV1", ok: false, code: "indeterminate",
    producer: { repository: PRODUCER_REPOSITORY, pullRequest: prOption ? Number(prOption) : null, head: "", base, mergeBase: null, triggerPaths: [] },
    consumer: { repository: CONSUMER_REPOSITORY, masterCommit: null, deployedCommit: null, pairedPullRequest: null, pairedHead: null },
    verdict: { master: null, deployed: null },
    lines: [],
  };
  const say = (line: string) => receipt.lines.push(redactCredentials(line));
  const finish = (code: GateCode, ok: boolean) => { receipt.code = code; receipt.ok = ok; return receipt; };
  try {
    receipt.producer.head = deps.git(["rev-parse", "HEAD"]).trim();
    const early = checkoutHeadMismatch(receipt.producer.head, expectedHead, null);
    if (early) throw new Indeterminate(early);
    try {
      receipt.producer.mergeBase = deps.git(["merge-base", base, "HEAD"]).trim();
    } catch {
      // A gate checkout without the base ref: fetch the public default branch once, then retry.
      try {
        if (base !== "origin/main") throw new Error("explicit base");
        deps.git(["fetch", "--quiet", "--no-tags", "origin", "+refs/heads/main:refs/remotes/origin/main"]);
        receipt.producer.mergeBase = deps.git(["merge-base", base, "HEAD"]).trim();
      } catch {
        throw new Indeterminate(`cannot find the merge base of HEAD and ${base}; fetch the base branch or pass --base <ref>.`);
      }
    }
    const changed = deps.git(["diff", "--name-only", "--no-renames", receipt.producer.mergeBase, "HEAD"]).split("\n").map((line) => line.trim()).filter(Boolean);
    receipt.producer.triggerPaths = releaseTouchingPaths(changed);
    if (receipt.producer.triggerPaths.length === 0) {
      say(`not release-touching: the PR changes none of ${RELEASE_TRIGGER_PATHS.join(", ")}.`);
      return finish("not-release-touching", true);
    }
    say(`release-touching: ${receipt.producer.triggerPaths.join(", ")}`);

    // Exact head: the PR's current head must be this checkout (and --head when given).
    let pr: ProducerPullRequest;
    if (prOption) {
      pr = deps.pullRequest(Number(prOption));
    } else {
      const open = deps.pullRequestsForHead(receipt.producer.head).filter((candidate) => candidate.head === receipt.producer.head && candidate.baseRef === "main");
      if (open.length !== 1) throw new Indeterminate(`expected exactly one open ${PRODUCER_REPOSITORY} PR to main at head ${receipt.producer.head}, found ${open.length}; pass --pr N.`);
      pr = open[0];
    }
    receipt.producer.pullRequest = pr.number;
    const mismatch = checkoutHeadMismatch(receipt.producer.head, expectedHead, { number: pr.number, head: pr.head });
    if (mismatch) throw new Indeterminate(mismatch);
    const pairedPullRequest = parsePairingTrailer(pr.body);
    receipt.consumer.pairedPullRequest = pairedPullRequest;

    const candidate = {
      commit: receipt.producer.head,
      manifest: deps.readCandidate(PRODUCER_MANIFEST_PATH),
      source: deps.readCandidate(PRODUCER_SOURCE_PATH),
      taskForm: deps.readCandidate(PRODUCER_TASK_FORM_PATH),
    };
    let baseManifest: Uint8Array | null = null;
    try { baseManifest = new Uint8Array(Buffer.from(deps.git(["show", `${receipt.producer.mergeBase}:${PRODUCER_MANIFEST_PATH}`]), "utf8")); } catch { baseManifest = null; }

    // 1. Code master, with the declared pairing when master alone refuses.
    const master = readConsumerSnapshot(deps.consumer, "master");
    receipt.consumer.masterCommit = master.commit;
    say(`candidate: ${PRODUCER_REPOSITORY}#${pr.number}@${receipt.producer.head} (merge base ${receipt.producer.mergeBase}); consumer: ${CONSUMER_REPOSITORY}@${master.commit}`);
    const drift = deps.drift(deps.consumer, master.commit);
    let verdict = evaluateConsumerPinGate({ candidate, baseManifest, consumer: master, pairedPullRequest: null });
    if (!verdict.ok && pairedPullRequest !== null) {
      const paired: PairedConsumer = readPairedConsumer(deps.consumer, pairedPullRequest);
      receipt.consumer.pairedHead = paired.consumer.commit;
      drift.push(...deps.drift(deps.consumer, paired.consumer.commit));
      verdict = evaluateConsumerPinGate({ candidate, baseManifest, consumer: master, pairedPullRequest, paired });
    }
    drift.forEach(say);
    verdict.lines.forEach(say);
    receipt.verdict.master = verdict.outcome;
    if (drift.length > 0) {
      say("REFUSED: the worker's resolution rules changed since contracts/governed-intake-worker-admission.ts was vendored.");
      return finish("worker-rules-drifted", false);
    }
    if (!verdict.ok) return finish("refused", false);
    if (verdict.outcome === "admitted-by-paired-consumer-pr") {
      say(`REFUSED (merge order): merge ${CONSUMER_REPOSITORY}#${String(pairedPullRequest)} at head ${String(receipt.consumer.pairedHead)} first, `
        + "wait until worker health reports that deploy, then merge this PR. This gate passes on its own once Code master and the deployed worker admit the release.");
      return finish("paired-consumer-not-landed", false);
    }

    // 2. Deployed readback: the Code commit the live worker was built from must admit it too.
    const health = await deps.workerHealth() as { deployed_commit?: unknown } | null;
    const deployedCommit = typeof health?.deployed_commit === "string" ? health.deployed_commit : "";
    if (!/^[0-9a-f]{40}$/.test(deployedCommit)) throw new Indeterminate(`worker health did not report a 40-hex deployed_commit (got ${JSON.stringify(health?.deployed_commit ?? null)}).`);
    receipt.consumer.deployedCommit = deployedCommit;
    const deployed = deployedCommit === master.commit ? master : readConsumerSnapshot(deps.consumer, deployedCommit);
    const deployedDrift = deployedCommit === master.commit ? [] : deps.drift(deps.consumer, deployedCommit);
    const live = evaluateConsumerPinGate({ candidate, baseManifest, consumer: deployed, pairedPullRequest: null });
    deployedDrift.forEach(say);
    say(`deployed worker: ${CONSUMER_REPOSITORY}@${deployedCommit}`);
    live.lines.forEach(say);
    receipt.verdict.deployed = live.outcome;
    if (deployedDrift.length > 0) return finish("worker-rules-drifted", false);
    if (!live.ok || !MERGEABLE_OUTCOMES.has(live.outcome)) {
      say(`REFUSED: the deployed worker (${CONSUMER_REPOSITORY}@${deployedCommit}) would refuse this release. Wait for the Code deploy that admits it, then re-run.`);
      return finish("deployed-worker-refuses", false);
    }
    return finish("admitted", true);
  } catch (error) {
    say(`INDETERMINATE: ${error instanceof Error ? error.message : String(error)}`);
    return finish("indeterminate", false);
  }
}

export function gateExitCode(receipt: GateReceipt): number {
  if (receipt.ok) return 0;
  return receipt.code === "indeterminate" ? 2 : 1;
}

export function formatReceipt(receipt: GateReceipt): string[] {
  return [
    ...receipt.lines,
    `verdict: ${receipt.code}`,
    `${RECEIPT_PREFIX}${redactCredentials(JSON.stringify(receipt))}`,
  ];
}

export function defaultGateDeps(root: string, api: GithubJson = ghApi, fetchFn: typeof fetch = fetch): GateDeps {
  const git = (args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  return {
    git,
    readCandidate: (file) => new Uint8Array(readFileSync(path.join(root, file))),
    pullRequest: (number) => readProducerPullRequest(number, api),
    pullRequestsForHead: (sha) => {
      const pulls = api(`/repos/${PRODUCER_REPOSITORY}/commits/${sha}/pulls`) as Array<{ number?: number; state?: string; body?: string | null; head?: { sha?: string }; base?: { ref?: string } }>;
      return (Array.isArray(pulls) ? pulls : []).filter((pr) => pr?.state === "open").map((pr) => ({
        number: Number(pr.number), head: String(pr.head?.sha ?? ""), body: pr.body ?? "", state: "open", baseRef: String(pr.base?.ref ?? ""),
      }));
    },
    consumer: restConsumerReader(api),
    drift: readWorkerDrift,
    async workerHealth() {
      const url = process.env.GOVERNED_INTAKE_WORKER_HEALTH_URL || WORKER_HEALTH_URL;
      const response = await fetchFn(url, { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(`worker health GET ${url} returned ${String(response.status)}`);
      return response.json();
    },
  };
}

export async function main(argv: string[], deps: GateDeps = defaultGateDeps(process.cwd()), out = (line: string) => { process.stdout.write(`${line}\n`); }): Promise<number> {
  const receipt = await runConsumerPinGate(argv, deps);
  formatReceipt(receipt).forEach(out);
  return gateExitCode(receipt);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
