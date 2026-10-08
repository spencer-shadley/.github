/** Consumer drift diagnostics (code#8212): warnings never control admission.
 * Fixtures are byte-exact git blobs recorded from spencer-shadley/.github and spencer-shadley/code
 * (each named by its git blob id and re-hashed on load). Offline and deterministic.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  CONSUMER_FILES, evaluateConsumerPinGate, loadRecordedCase, main, parsePairingTrailer, type GateInput,
} from "../contracts/governed-intake-consumer-pin.check.ts";
import {
  VENDORED_WORKER_RESOLUTION, extractWorkerDeclaration, extractWorkerFunction, fingerprintWorkerSource, gitBlobSha, resolveWorkerAdmission, sha256Hex, workerResolutionDrift,
} from "../contracts/governed-intake-worker-admission.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = path.join(root, "test/fixtures/consumer-pin");
const load = (name: string) => loadRecordedCase(path.join(fixtures, `${name}.case.json`));
const encode = (value: unknown) => new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
const decode = (bytes: Uint8Array) => JSON.parse(new TextDecoder().decode(bytes));
const withConsumerFile = (input: GateInput, file: string, edit: (value: any) => void): GateInput => {
  const value = decode(input.consumer.files[file]);
  edit(value);
  return { ...input, consumer: { ...input.consumer, files: { ...input.consumer.files, [file]: encode(value) } } };
};

test("every recorded fixture blob is the byte-exact git object it is named after", () => {
  const blobs = readdirSync(path.join(fixtures, "blobs"));
  assert.ok(blobs.length > 0);
  for (const name of blobs) {
    const bytes = new Uint8Array(readFileSync(path.join(fixtures, "blobs", name)));
    assert.equal(gitBlobSha(bytes), name);
  }
});

test(".github#40 drift warns with exact consumer, file and values; current producer is admitted", () => {
  const { input } = load("dotgithub-40-same-revision-republish");
  const verdict = evaluateConsumerPinGate(input);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.outcome, "consumer-drift-warning");
  assert.ok(verdict.master.ok);
  assert.equal(verdict.master.identity.producerCommit, "f2257602988ba9f5d5e94470958a1eb3ba469940");
  const lines = verdict.lines.join("\n");
  assert.match(lines, /WARNING governed-intake commit_mismatch/);
  assert.ok(lines.includes(`spencer-shadley/code@${input.consumer.commit}:${CONSUMER_FILES.publishedPin}`));
  assert.match(lines, /producer.producerCommit: pinned value = d2ee7995026cfceba4ecb1d459a19dd893a28948; current value = f2257602988ba9f5d5e94470958a1eb3ba469940; admission proceeds/);
  assert.match(lines, /Consumer compatibility may differ/);
  assert.doesNotMatch(lines, /REFUSED|FAIL|Consumer-Pin-Pair/);
});

test(".github#43 producer corruption remains a specific diagnostic and admission proceeds", () => {
  const { input } = load("dotgithub-43-unpublished-source-change");
  const verdict = evaluateConsumerPinGate(input);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.outcome, "producer-warning");
  assert.ok(!verdict.master.ok && verdict.master.refusal.code === "corrupt_file");
  assert.match(verdict.lines.join("\n"), /WARNING producer spencer-shadley\/\.github@.*manifest.files\[governed-intake-body.v1.json\].*corrupt_file.*admission proceeds/);
});

test("unchanged producer resolves without warnings when the consumer evidence matches", () => {
  const { input } = load("main-0a9a6cbd-unchanged");
  const verdict = evaluateConsumerPinGate(input);
  assert.equal(verdict.outcome, "admitted");
  assert.ok(verdict.master.ok);
  assert.deepEqual(verdict.master.warnings, []);
  assert.equal(verdict.master.identity.producerCommit, "69809c201a9650fbc6d9129b2c7be03738bc83de");
});

test("pairing status and merge order never affect admission", () => {
  const { input } = load("dotgithub-55-paired-with-code-8014");
  const alone = evaluateConsumerPinGate({ ...input, pairedPullRequest: null, paired: null });
  for (const paired of [input.paired, null, { ...input.paired!, state: "closed", merged: false, baseRef: "release" }]) {
    assert.deepEqual(evaluateConsumerPinGate({ ...input, paired }), alone);
  }
  assert.equal(alone.ok, true);
  assert.equal(alone.outcome, "consumer-drift-warning");
});

test("every pin comparison warns and never supplies the resolved identity", () => {
  const { input } = load("main-0a9a6cbd-unchanged");
  const edited = withConsumerFile(input, CONSUMER_FILES.publishedPin, (pin) => {
    pin.schema = "old-schema";
    pin.producer.repository = "old/consumer";
    pin.producer.producerCommit = "0".repeat(40);
    pin.producer.sourceBlobSha = "1".repeat(40);
    pin.producer.releaseManifestBlobSha = "2".repeat(40);
    pin.revision = 1;
    pin.payloadDigest = `sha256:${"0".repeat(64)}`;
  });
  const drifted = withConsumerFile(edited, CONSUMER_FILES.publishedManifest, (manifest) => { manifest.payloadDigest = "3".repeat(64); });
  const verdict = evaluateConsumerPinGate(drifted);
  assert.ok(verdict.master.ok);
  assert.equal(verdict.master.identity.revision, 22);
  assert.equal(verdict.master.identity.producerCommit, decode(input.candidate.manifest).producer.commit);
  assert.deepEqual(verdict.master.warnings.map((w) => w.field), ["schema", "producer.repository", "producer.producerCommit", "revision", "payloadDigest", "cached manifest payloadDigest", "producer.sourceBlobSha", "producer.releaseManifestBlobSha"]);
  assert.equal(verdict.ok, true);
  for (const warning of verdict.master.warnings) {
    assert.ok(verdict.lines.some((line) => line.includes(warning.field) && line.includes(warning.expected) && line.includes(warning.actual) && line.includes("admission proceeds")));
  }
  assert.ok(verdict.lines.some((line) => line.includes(`${CONSUMER_FILES.publishedManifest} cached manifest payloadDigest`)));
});

test("prepared slot identifies historical drift but does not pin producer revision or identity", () => {
  const { input } = load("main-0a9a6cbd-unchanged");
  const manifest = decode(input.candidate.manifest);
  manifest.revision = 23;
  const verdict = evaluateConsumerPinGate({ ...input, candidate: { ...input.candidate, manifest: encode(manifest) } });
  assert.equal(verdict.ok, true);
  assert.ok(verdict.master.ok && verdict.master.slot === "prepared" && verdict.master.identity.revision === 23);
  assert.match(verdict.lines.join("\n"), /governed-intake-candidate-release.pin.json producer.producerCommit: pinned value = 6425de19/);
});

test("the PR-body pairing trailer is exact and names a spencer-shadley/code PR", () => {
  assert.equal(parsePairingTrailer("Summary\n\nConsumer-Pin-Pair: spencer-shadley/code#7969\n"), 7969);
  assert.equal(parsePairingTrailer("Consumer-Pin-Pair: spencer-shadley/agent-orchestrator#1"), null);
  assert.equal(parsePairingTrailer("mentions Consumer-Pin-Pair: spencer-shadley/code#1 inline"), null);
  assert.equal(parsePairingTrailer(undefined), null);
});

test("worker-rule drift detection flags a changed or missing mirrored function", () => {
  const source = "function verifyLiveManifest(value) {\n  return value;\n}\n";
  const text = extractWorkerFunction(source, "verifyLiveManifest");
  assert.equal(text, "function verifyLiveManifest(value) {\n  return value;\n}");
  const drift = workerResolutionDrift(source);
  assert.deepEqual(drift.map((entry) => entry.function).sort(),
    [...Object.keys(VENDORED_WORKER_RESOLUTION.functions), ...Object.keys(VENDORED_WORKER_RESOLUTION.declarations)].sort());
  assert.equal(drift.find((entry) => entry.function === "verifyLiveManifest")?.actual, sha256Hex(text!));
  assert.equal(drift.find((entry) => entry.function === "verifyProducerPayload")?.actual, null);
});

test("the CLI replays recorded cases with advisory exit codes", () => {
  const silence = process.stdout.write;
  const lines: string[] = [];
  process.stdout.write = ((chunk: string) => { lines.push(String(chunk)); return true; }) as typeof process.stdout.write;
  try {
    assert.equal(main(["--case", "test/fixtures/consumer-pin/dotgithub-40-same-revision-republish.case.json"], () => { throw new Error("offline"); }, root), 0);
    assert.equal(main(["--case", "test/fixtures/consumer-pin/dotgithub-43-unpublished-source-change.case.json"], () => { throw new Error("offline"); }, root), 0);
    assert.equal(main(["--case", "test/fixtures/consumer-pin/main-0a9a6cbd-unchanged.case.json"], () => { throw new Error("offline"); }, root), 0);
  } finally {
    process.stdout.write = silence;
  }
  assert.match(lines.join(""), /verdict: consumer-drift-warning/);
  assert.match(lines.join(""), /verdict: admitted/);
});

test("fingerprints cover every helper the resolution path copies, and a mutated helper or constant is drift (.github#57 review)", () => {
  assert.deepEqual(Object.keys(VENDORED_WORKER_RESOLUTION.functions).sort(),
    ["decodeProducerContent", "requireString", "resolveGovernedIntakeRuntime", "selectAdmittedRelease", "sha256Utf8", "verifyLiveManifest", "verifyProducerPayload"]);
  assert.deepEqual(Object.keys(VENDORED_WORKER_RESOLUTION.declarations).sort(), ["PRODUCER_REPOSITORY", "PRODUCER_SOURCE_PATH"]);
  // A worker-shaped source: every mirrored function and constant, so only a mutation can differ.
  const source = [
    'const PRODUCER_REPOSITORY = "spencer-shadley/.github" as const;',
    'const PRODUCER_SOURCE_PATH = "contracts/governed-intake-body.v1.json" as const;',
    ...Object.keys(VENDORED_WORKER_RESOLUTION.functions).map((name) => `export function ${name}(value: string): string {\n  return value;\n}`),
  ].join("\n");
  const recorded = fingerprintWorkerSource(source);
  assert.deepEqual(workerResolutionDrift(source, recorded), []);
  assert.equal(extractWorkerDeclaration(source, "PRODUCER_REPOSITORY"), 'const PRODUCER_REPOSITORY = "spencer-shadley/.github" as const;');
  assert.equal(recorded.declarations.PRODUCER_REPOSITORY, VENDORED_WORKER_RESOLUTION.declarations.PRODUCER_REPOSITORY, "the constant line is the worker's");
  assert.equal(recorded.declarations.PRODUCER_SOURCE_PATH, VENDORED_WORKER_RESOLUTION.declarations.PRODUCER_SOURCE_PATH);
  const helper = source.replace("export function decodeProducerContent(value: string): string {\n  return value;", "export function decodeProducerContent(value: string): string {\n  return value.trim();");
  assert.deepEqual(workerResolutionDrift(helper, recorded).map((entry) => entry.function), ["decodeProducerContent"]);
  const removed = source.replace("export function requireString(", "export function requireStringOrEmpty(");
  assert.deepEqual(workerResolutionDrift(removed, recorded).map((entry) => [entry.function, entry.actual]), [["requireString", null]]);
  const constant = source.replace('"spencer-shadley/.github" as const', '"spencer-shadley/github" as const');
  assert.deepEqual(workerResolutionDrift(constant, recorded).map((entry) => entry.function), ["PRODUCER_REPOSITORY"]);
});

test("code#8013 dual accept: a same-revision republish staged in the prepared slot is admitted there; the pinned identity still is too", () => {
  // .github#55 (r22 republished from 69809c20) against code c144fbd1, whose published slot pins d2ee7995.
  const { input } = load("dotgithub-55-paired-with-code-8014");
  const staged = input.paired!.consumer.files;
  const consumer = { ...input.consumer, files: { ...input.consumer.files,
    [CONSUMER_FILES.preparedPin]: staged[CONSUMER_FILES.publishedPin],
    [CONSUMER_FILES.preparedManifest]: staged[CONSUMER_FILES.publishedManifest] } };
  const verdict = evaluateConsumerPinGate({ ...input, consumer, pairedPullRequest: null, paired: null });
  assert.equal(verdict.outcome, "admitted");
  assert.ok(verdict.master.ok && verdict.master.slot === "prepared" && verdict.master.identity.revision === 22);
  assert.equal(verdict.master.ok && verdict.master.identity.producerCommit, "69809c201a9650fbc6d9129b2c7be03738bc83de");
  // Before the producer flip, main's old release (d2ee7995) still resolves through the published slot.
  const before = load("dotgithub-40-same-revision-republish").input;
  assert.equal(before.consumer.commit, input.consumer.commit);
  const stillPinned = resolveWorkerAdmission(input.candidate, {
    published: { pin: decode(staged[CONSUMER_FILES.publishedPin]), manifest: decode(staged[CONSUMER_FILES.publishedManifest]) },
    prepared: { pin: decode(input.consumer.files[CONSUMER_FILES.preparedPin]), manifest: decode(input.consumer.files[CONSUMER_FILES.preparedManifest]) },
  });
  assert.ok(stillPinned.ok && stillPinned.slot === "published");
});
