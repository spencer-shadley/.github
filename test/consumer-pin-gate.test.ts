/** Automatic consumer-pin merge gate (spencer-shadley/code#8036). Replays the recorded .github#40,
 * #43 and #55 shapes through the same entrypoint `fleet-cli gh pr-merge` and Code's lander run,
 * with every network read injected. Offline and deterministic.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CONSUMER_FILES, checkoutHeadMismatch, loadRecordedCase, type ConsumerReader, type ConsumerSnapshot, type GateInput } from "../contracts/governed-intake-consumer-pin.check.ts";
import {
  RECEIPT_PREFIX, formatReceipt, gateExitCode, main, redactCredentials, releaseTouchingPaths, runConsumerPinGate,
  type GateDeps, type GateReceipt,
} from "../contracts/governed-intake-consumer-pin.gate.ts";
import { PRODUCER_MANIFEST_PATH, PRODUCER_SOURCE_PATH, PRODUCER_TASK_FORM_PATH } from "../contracts/governed-intake-worker-admission.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const load = (name: string) => loadRecordedCase(path.join(root, "test/fixtures/consumer-pin", `${name}.case.json`)).input;
const HEAD = "d7ea7346f7649e43d0981ac86c911cb6b92ace61";
const MERGE_BASE = "c64477c380cc80e92ad918d464512aaf2cfec28e";
const offline = () => { throw new Error("must not be read"); };

type Fake = {
  input: GateInput;
  changed?: string[];
  prHead?: string;
  body?: string;
  master?: ConsumerSnapshot;
  deployed?: ConsumerSnapshot | null;
  paired?: { number: number; state: string; merged: boolean; snapshot: ConsumerSnapshot };
  drift?: (commit: string) => string[];
  health?: () => Promise<unknown>;
};

function fakeDeps(fake: Fake, reads: string[] = []): GateDeps {
  const snapshots = new Map<string, ConsumerSnapshot>();
  const master = fake.master ?? fake.input.consumer;
  for (const snapshot of [master, fake.deployed ?? master, fake.paired?.snapshot]) if (snapshot) snapshots.set(snapshot.commit, snapshot);
  const consumer: ConsumerReader = {
    resolve(ref) { reads.push(`resolve ${ref}`); return ref === "master" ? master.commit : ref; },
    read(commit, file) {
      reads.push(`read ${commit}`);
      const bytes = snapshots.get(commit)?.files[file];
      if (!bytes) throw new Error(`no ${file} at ${commit}`);
      return bytes;
    },
    pullRequest(number) {
      reads.push(`pr code#${number}`);
      if (!fake.paired || fake.paired.number !== number) throw new Error(`no code#${number}`);
      return { state: fake.paired.state, merged: fake.paired.merged, baseRef: "master", head: fake.paired.snapshot.commit };
    },
  };
  const candidate: Record<string, Uint8Array> = {
    [PRODUCER_MANIFEST_PATH]: fake.input.candidate.manifest,
    [PRODUCER_SOURCE_PATH]: fake.input.candidate.source,
    [PRODUCER_TASK_FORM_PATH]: fake.input.candidate.taskForm,
  };
  return {
    git(args) {
      if (args[0] === "rev-parse") return `${HEAD}\n`;
      if (args[0] === "merge-base") return `${MERGE_BASE}\n`;
      if (args[0] === "diff") return `${(fake.changed ?? [PRODUCER_MANIFEST_PATH]).join("\n")}\n`;
      if (args[0] === "show" && fake.input.baseManifest) return new TextDecoder().decode(fake.input.baseManifest);
      throw new Error(`unexpected git ${args.join(" ")}`);
    },
    readCandidate: (file) => candidate[file],
    pullRequest(number) { reads.push(`pr .github#${number}`); return { number, head: fake.prHead ?? HEAD, body: fake.body ?? "", state: "open", baseRef: "main" }; },
    pullRequestsForHead(sha) { reads.push(`pulls ${sha}`); return [{ number: 55, head: fake.prHead ?? HEAD, body: fake.body ?? "", state: "open", baseRef: "main" }]; },
    consumer,
    drift: (_reader, commit) => fake.drift?.(commit) ?? [],
    workerHealth: fake.health ?? (async () => ({ deployed_commit: (fake.deployed ?? master).commit })),
  };
}

const run = (fake: Fake, argv: string[] = ["--pr", "55"], reads?: string[]) => runConsumerPinGate(argv, fakeDeps(fake, reads));
const text = (receipt: GateReceipt) => receipt.lines.join("\n");

test("trigger paths are exactly the three inputs the worker verifies", () => {
  assert.deepEqual(releaseTouchingPaths([
    "contracts/generated/governed-intake/manifest.json", "contracts/generated/governed-intake/task.yml",
    "contracts/governed-intake-body.v1.json", ".github/ISSUE_TEMPLATE/task.yml",
    "contracts/generated/governed-intake-other/x", ".github/ISSUE_TEMPLATE/feature.yml", "docs/governed-intake-ssot.md",
  ]), ["contracts/generated/governed-intake/manifest.json", "contracts/generated/governed-intake/task.yml", "contracts/governed-intake-body.v1.json", ".github/ISSUE_TEMPLATE/task.yml"]);
});

test("a non-release PR passes untouched: no PR, consumer, or worker read", async () => {
  const reads: string[] = [];
  const deps = fakeDeps({ input: load("dotgithub-40-same-revision-republish"), changed: ["docs/governed-intake-ssot.md", "test/x.test.ts"], health: offline as never }, reads);
  deps.pullRequest = offline; deps.pullRequestsForHead = offline;
  const receipt = await runConsumerPinGate([], deps);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.code, "not-release-touching");
  assert.deepEqual(reads, []);
  assert.equal(gateExitCode(receipt), 0);
});

test(".github#40 pin drift warns with values and proceeds, exit 0", async () => {
  const receipt = await run({ input: load("dotgithub-40-same-revision-republish") });
  assert.equal(receipt.code, "consumer-drift-warning");
  assert.equal(receipt.ok, true);
  assert.equal(gateExitCode(receipt), 0);
  assert.match(text(receipt), /commit_mismatch.*producer.producerCommit: pinned value = d2ee7995.*current value = f2257602.*admission proceeds/);
  assert.equal(receipt.consumer.masterCommit, "c144fbd12ab67c046e9f5fafff5859113397347e");
  assert.equal(receipt.consumer.deployedCommit, receipt.consumer.masterCommit);
});

test(".github#43 unpublished source bytes warn and proceed", async () => {
  const receipt = await run({ input: load("dotgithub-43-unpublished-source-change"), changed: [PRODUCER_SOURCE_PATH] });
  assert.equal(receipt.code, "producer-warning");
  assert.equal(receipt.ok, true);
  assert.equal(gateExitCode(receipt), 0);
  assert.match(text(receipt), /corrupt_file.*admission proceeds/);
});

test(".github#55 proceeds with or without pairing and diagnoses a lagging deployed consumer", async () => {
  const input = load("dotgithub-55-paired-with-code-8014");
  const code8014 = input.paired!.consumer;
  const reads: string[] = [];
  const open = await run({ input, body: "Consumer-Pin-Pair: spencer-shadley/code#8014", paired: { number: 8014, state: "open", merged: false, snapshot: code8014 } }, undefined, reads);
  assert.equal(open.code, "consumer-drift-warning");
  assert.equal(gateExitCode(open), 0);
  assert.ok(!reads.includes("pr code#8014"));
  assert.doesNotMatch(text(open), /merge .* first|REFUSED/);
  const lagging = await run({ input, master: code8014, deployed: input.consumer });
  assert.equal(lagging.code, "consumer-drift-warning");
  assert.equal(lagging.verdict.master, "admitted");
  assert.equal(lagging.verdict.deployed, "consumer-drift-warning");
  assert.equal(lagging.consumer.deployedCommit, input.consumer.commit);
  assert.equal(gateExitCode(lagging), 0);
  const live = await run({ input, master: code8014, deployed: code8014 });
  assert.equal(live.code, "admitted");
});

test("exact head: a checkout that is not the PR's current head, or not --head, is indeterminate", async () => {
  const input = load("main-0a9a6cbd-unchanged");
  const moved = await run({ input, prHead: "1".repeat(40) });
  assert.equal(moved.code, "indeterminate");
  assert.equal(gateExitCode(moved), 0);
  assert.match(text(moved), /is not spencer-shadley\/\.github#55's current head 1{40}/);
  const wrong = await run({ input }, ["--pr", "55", "--head", "2".repeat(40)]);
  assert.equal(wrong.code, "indeterminate");
  const found = await run({ input }, []);
  assert.equal(found.producer.pullRequest, 55);
  assert.equal(checkoutHeadMismatch(HEAD, undefined, { number: 1, head: HEAD }), null);
  assert.match(checkoutHeadMismatch(HEAD, "abc", null) ?? "", /full 40-hex/);
});

test("worker-rule drift at master or at the deployed commit warns and proceeds", async () => {
  const input = load("main-0a9a6cbd-unchanged");
  const atMaster = await run({ input, drift: () => ["DRIFT spencer-shadley/code@c144fbd1 verifyLiveManifest re-vendor"] });
  assert.equal(atMaster.code, "worker-rules-drifted");
  assert.equal(gateExitCode(atMaster), 0);
  const deployed: ConsumerSnapshot = { ...input.consumer, commit: "3".repeat(40) };
  const atDeployed = await run({ input, deployed, drift: (commit) => commit === deployed.commit ? ["DRIFT re-vendor"] : [] });
  assert.equal(atDeployed.code, "worker-rules-drifted");
});

test("unreadable worker health or missing deployed_commit warns and proceeds", async () => {
  const input = load("main-0a9a6cbd-unchanged");
  const down = await run({ input, health: async () => { throw new Error("fetch failed"); } });
  assert.equal(down.code, "indeterminate");
  assert.equal(gateExitCode(down), 0);
  const blank = await run({ input, health: async () => ({ deployed_commit: null }) });
  assert.equal(blank.code, "indeterminate");
  const ok = await run({ input });
  assert.equal(ok.code, "admitted");
});

test("refusal and indeterminate output carry no token or credential-bearing URL", async () => {
  const input = load("main-0a9a6cbd-unchanged");
  const secret = "ghp_" + "A".repeat(36);
  const deps = fakeDeps({ input });
  deps.consumer = { ...deps.consumer, resolve() { throw new Error(`git fetch https://x-access-token:${secret}@github.com/spencer-shadley/code.git failed; token=${secret}`); } };
  const receipt = await runConsumerPinGate(["--pr", "55"], deps);
  const printed = formatReceipt(receipt).join("\n");
  assert.equal(receipt.code, "indeterminate");
  assert.ok(!printed.includes(secret));
  assert.ok(!/x-access-token:/.test(printed));
  assert.match(printed, /https:\/\/\[REDACTED\]@github\.com/);
  assert.equal(redactCredentials(`Authorization: Bearer ${"x".repeat(26)}`), "Authorization: Bearer [REDACTED]");
  assert.equal(redactCredentials(`github_pat_${"b".repeat(40)}`), "[REDACTED]");
});

test("the CLI prints the verdict and one bound receipt line, with gate exit codes", async () => {
  const lines: string[] = [];
  const exit = await main(["--pr", "55"], fakeDeps({ input: load("dotgithub-40-same-revision-republish") }), (line) => lines.push(line));
  assert.equal(exit, 0);
  assert.ok(lines.includes("verdict: consumer-drift-warning"));
  const receiptLine = lines.find((line) => line.startsWith(RECEIPT_PREFIX));
  assert.ok(receiptLine);
  const receipt = JSON.parse(receiptLine.slice(RECEIPT_PREFIX.length)) as GateReceipt;
  assert.equal(receipt.schema, "GovernedIntakeConsumerPinGateReceiptV1");
  assert.equal(receipt.producer.head, HEAD);
  assert.equal(receipt.producer.pullRequest, 55);
  assert.equal(receipt.consumer.masterCommit, "c144fbd12ab67c046e9f5fafff5859113397347e");
  assert.equal(receipt.ok, true);
});

test("check CLI --pr N warns (exit 0) when the checkout is not PR N's current head (.github#57 review)", async () => {
  const { main: checkMain } = await import("../contracts/governed-intake-consumer-pin.check.ts");
  const lines: string[] = [];
  const write = process.stdout.write;
  process.stdout.write = ((chunk: string) => { lines.push(String(chunk)); return true; }) as typeof process.stdout.write;
  let exit: number;
  try {
    exit = checkMain(["--base", "HEAD", "--pr", "57"], (apiPath) => {
      if (apiPath === "/repos/spencer-shadley/.github/pulls/57") return { body: "", state: "open", head: { sha: "4".repeat(40) }, base: { ref: "main" } };
      throw new Error(`must not read ${apiPath}`);
    }, root);
  } finally {
    process.stdout.write = write;
  }
  assert.equal(exit, 0);
  assert.match(lines.join(""), /WARNING diagnostic unavailable: checkout HEAD [0-9a-f]{40} is not spencer-shadley\/\.github#57's current head 4{40}/);
});

test("a gate checkout without origin/main fetches it once; a base that still cannot be found is indeterminate", async () => {
  const input = load("main-0a9a6cbd-unchanged");
  const calls: string[] = [];
  const deps = fakeDeps({ input, changed: ["README.md"] });
  const git = deps.git;
  let fetched = false;
  deps.git = (args) => {
    calls.push(args[0]);
    if (args[0] === "merge-base" && !fetched) throw new Error("Not a valid object name origin/main");
    if (args[0] === "fetch") { fetched = true; return ""; }
    return git(args);
  };
  const receipt = await runConsumerPinGate([], deps);
  assert.equal(receipt.code, "not-release-touching");
  assert.deepEqual(calls, ["rev-parse", "merge-base", "fetch", "merge-base", "diff"]);
  deps.git = (args) => { if (args[0] === "merge-base" || args[0] === "fetch") throw new Error("offline"); return git(args); };
  const lost = await runConsumerPinGate([], deps);
  assert.equal(lost.code, "indeterminate");
});

test("local-ci runs consumer diagnostics only as a warning step", async () => {
  const { readFileSync } = await import("node:fs");
  const ci = JSON.parse(readFileSync(path.join(root, "local-ci.json"), "utf8"));
  assert.equal(ci.commands["consumer-pin-gate"].failureDisposition, "warning");
});

test("malformed consumer JSON warns with exact repository, commit and file; proceeds", async () => {
  const input = load("main-0a9a6cbd-unchanged");
  const malformed = { ...input.consumer, files: { ...input.consumer.files,
    [CONSUMER_FILES.publishedPin]: new TextEncoder().encode("{") } };
  const receipt = await run({ input, master: malformed });
  assert.equal(receipt.ok, true);
  assert.equal(gateExitCode(receipt), 0);
  assert.ok(text(receipt).includes(`${input.consumer.repository}@${input.consumer.commit}:${CONSUMER_FILES.publishedPin}`));
  assert.match(text(receipt), /invalid UTF-8 JSON.*admission proceeds/);
});
