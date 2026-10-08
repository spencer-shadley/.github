/** Advisory consumer compatibility step (code#8212, code#7736).
 * Preserves exact-head diagnostic receipts and deployed-worker readback, always exits 0.
 * Consumer drift, changed historical rules, and unreadable inputs are specific warnings.
 * Usage: node --experimental-strip-types contracts/governed-intake-consumer-pin.gate.ts
 *   [--pr N] [--head <sha>] [--base origin/main]
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONSUMER_REPOSITORY, checkoutHeadMismatch, evaluateConsumerPinGate, ghApi, parsePairingTrailer,
  readConsumerSnapshot, readProducerPullRequest, readWorkerDrift, restConsumerReader,
  type ConsumerReader, type GateOutcome, type GithubJson, type ProducerPullRequest,
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

export type GateCode =
  | "not-release-touching" | "admitted" | "consumer-drift-warning" | "producer-warning" | "worker-rules-drifted" | "indeterminate";
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

/** One gate run. Never throws: every unavailable diagnostic becomes a warning receipt. */
export async function runConsumerPinGate(argv: string[], deps: GateDeps): Promise<GateReceipt> {
  const base = option(argv, "--base") ?? "origin/main";
  const prOption = option(argv, "--pr");
  const expectedHead = option(argv, "--head");
  const receipt: GateReceipt = {
    schema: "GovernedIntakeConsumerPinGateReceiptV1", ok: true, code: "indeterminate",
    producer: { repository: PRODUCER_REPOSITORY, pullRequest: prOption ? Number(prOption) : null, head: "", base, mergeBase: null, triggerPaths: [] },
    consumer: { repository: CONSUMER_REPOSITORY, masterCommit: null, deployedCommit: null, pairedPullRequest: null, pairedHead: null },
    verdict: { master: null, deployed: null },
    lines: [],
  };
  const say = (line: string) => receipt.lines.push(redactCredentials(line));
  const finish = (code: GateCode) => { receipt.code = code; return receipt; };
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
      return finish("not-release-touching");
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

    // 1. Code master: compare historical consumer evidence to the current producer.
    const master = readConsumerSnapshot(deps.consumer, "master");
    receipt.consumer.masterCommit = master.commit;
    say(`candidate: ${PRODUCER_REPOSITORY}#${pr.number}@${receipt.producer.head} (merge base ${receipt.producer.mergeBase}); consumer: ${CONSUMER_REPOSITORY}@${master.commit}`);
    const drift = deps.drift(deps.consumer, master.commit);
    const verdict = evaluateConsumerPinGate({ candidate, baseManifest, consumer: master });
    drift.forEach(say);
    verdict.lines.forEach(say);
    receipt.verdict.master = verdict.outcome;

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
    if (drift.length || deployedDrift.length) return finish("worker-rules-drifted");
    if (verdict.outcome === "producer-warning" || live.outcome === "producer-warning") return finish("producer-warning");
    if (verdict.outcome === "consumer-drift-warning" || live.outcome === "consumer-drift-warning") return finish("consumer-drift-warning");
    return finish("admitted");
  } catch (error) {
    say(`WARNING diagnostic unavailable: producer ${PRODUCER_REPOSITORY}@${receipt.producer.head || "unknown"}; consumer ${CONSUMER_REPOSITORY}@${receipt.consumer.masterCommit ?? "unknown"}; ${error instanceof Error ? error.message : String(error)}; compatibility could not be assessed; admission proceeds.`);
    return finish("indeterminate");
  }
}

export function gateExitCode(receipt: GateReceipt): number {
  return 0; // Diagnostic findings never participate in merge authority.
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
