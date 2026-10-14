/** .github#33: one payload name per release source; alias names are not part of the release. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  IDENTICAL_PAYLOAD_ALLOWLIST, RELEASE_SOLE_NAME_EXCEPTIONS, RELEASE_SOURCES,
  identicalPayloadWarnings, planReleasePayloads, releaseFileEntries, releasePayloadFiles,
} from "../contracts/governed-intake-body.release.ts";
import {
  REQUIRED_RELEASE_PAYLOADS, RELEASE_MANIFEST_SCHEMA, RELEASE_PRODUCER, RELEASE_SCHEMA_FAMILY,
  computePayloadDigest, loadGovernedIntakeRelease, sha256, verifyGovernedIntakeRelease,
} from "../contracts/governed-intake-release.verify.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RETIRED_ALIAS_NAMES = [
  "contract.json", "evaluator.ts", "evaluator.js", "triage-evaluator.ts", "triage-evaluator.js",
  "policy.json", "policy-evaluator.ts", "policy-evaluator.js", "delta-planner.ts", "delta-planner.js",
  "compose.ts", "compose.js", "policy-binding.ts", "policy-binding.js",
  "task-profile-contract.json", "task-profile-evaluator.ts", "task-profile-evaluator.js",
  "taxonomy-evaluator.ts", "taxonomy-evaluator.js",
] as const;

test("each release source is declared once and emits its basename, plus a javascript twin from that source", () => {
  const seen = new Set<string>();
  for (const source of RELEASE_SOURCES) {
    assert.equal(seen.has(source), false, source);
    seen.add(source);
  }
  const plan = planReleasePayloads(RELEASE_SOURCES, RELEASE_SOLE_NAME_EXCEPTIONS);
  for (const source of RELEASE_SOURCES) {
    const expected = Object.hasOwn(RELEASE_SOLE_NAME_EXCEPTIONS, source)
      ? RELEASE_SOLE_NAME_EXCEPTIONS[source]
      : path.basename(source);
    const declared = plan.find((entry) => entry.kind === "source" && entry.source === source);
    assert.equal(declared?.name, expected, source);
  }
  assert.deepEqual(RELEASE_SOLE_NAME_EXCEPTIONS, {
    "contracts/governed-intake-release.verify.ts": "verify.ts",
    "contracts/governed-intake-body.generate.ts": "generator.ts",
  });
  for (const javascript of plan.filter((entry) => entry.kind === "javascript")) {
    const declared = plan.find((entry) => entry.kind === "source" && entry.source === javascript.source);
    assert.ok(declared, javascript.source);
    assert.equal(javascript.name, `${declared.name.slice(0, -".ts".length)}.js`);
    assert.equal(javascript.source.endsWith(".ts"), true);
  }
  assert.deepEqual(plan.map((entry) => entry.name).sort(), [...REQUIRED_RELEASE_PAYLOADS].sort());
});

test("the builder rejects a repeated source and an output-name collision, including a generated javascript name", () => {
  assert.throws(() => planReleasePayloads(["contracts/a.ts", "contracts/a.ts"]), /repeated release source: contracts\/a\.ts/);
  assert.throws(() => planReleasePayloads(["contracts/a.ts", "other/a.ts"]), /output-name collision: a\.ts/);
  assert.throws(() => planReleasePayloads(["contracts/a.ts", "contracts/a.js"]), /output-name collision: a\.js/);
  assert.throws(() => planReleasePayloads(
    ["contracts/governed-intake-release.verify.ts", "contracts/verify.ts"],
    { "contracts/governed-intake-release.verify.ts": "verify.ts" },
  ), /output-name collision: verify\.ts/);
  assert.throws(
    () => releasePayloadFiles(() => Buffer.from(""), ["contracts/a.ts", "contracts/a.ts"], {}),
    /repeated release source/,
  );
});

test("built payloads use canonical names only", () => {
  const files = releasePayloadFiles((source) => readFileSync(path.join(root, source)));
  for (const name of RETIRED_ALIAS_NAMES) assert.equal(files[name], undefined, name);
  assert.deepEqual(Object.keys(files).sort(), [...REQUIRED_RELEASE_PAYLOADS].sort());
  assert.equal(files["verify.ts"].equals(readFileSync(path.join(root, "contracts/governed-intake-release.verify.ts"))), true);
  assert.equal(files["generator.ts"].equals(readFileSync(path.join(root, "contracts/governed-intake-body.generate.ts"))), true);
});

test("identical bytes are a producer warning unless the pair is allowlisted", () => {
  const same = Buffer.from("export const n = 1;\n");
  const files = {
    "governed-intake-policy-binding.ts": same,
    "governed-intake-policy-binding.js": same,
    "task.md": Buffer.from("same\n"),
    "feature.md": Buffer.from("same\n"),
  };
  const warnings = identicalPayloadWarnings(files);
  assert.deepEqual(IDENTICAL_PAYLOAD_ALLOWLIST, []);
  assert.ok(warnings.some((warning) => warning.includes("task.md") && warning.includes("feature.md")), warnings.join("\n"));
  assert.equal(warnings.some((warning) => warning.includes("governed-intake-policy-binding")), false);
  const published = releasePayloadFiles((source) => readFileSync(path.join(root, source)));
  assert.deepEqual(identicalPayloadWarnings(published), []);
});

test("the verifier refuses an old alias name and still accepts an allowlisted identical javascript pair", (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "release-names-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const files = releasePayloadFiles((source) => readFileSync(path.join(root, source)));
  const contract = JSON.parse(files["governed-intake-body.v1.json"].toString("utf8")) as { version: number };
  const entries = releaseFileEntries(files);
  const manifest = {
    schema: RELEASE_MANIFEST_SCHEMA,
    schemaFamily: RELEASE_SCHEMA_FAMILY,
    revision: contract.version,
    producer: { repository: RELEASE_PRODUCER, commit: "a".repeat(40) },
    payloadDigest: computePayloadDigest(entries),
    files: entries,
  };
  for (const [name, bytes] of Object.entries(files)) writeFileSync(path.join(dir, name), bytes);
  writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest));
  assert.equal(verifyGovernedIntakeRelease(dir).ok, true);
  const loaded = loadGovernedIntakeRelease(dir);
  assert.equal(loaded.contract.version, contract.version);
  assert.match(loaded.evaluatorSource, /validateGovernedIntakeBody/);
  assert.match(loaded.triageEvaluatorSource, /evaluateTriageChecklistStructure/);

  const typescript = Buffer.from(files["governed-intake-policy-binding.ts"]);
  files["governed-intake-policy-binding.js"] = typescript;
  files["feature.md"] = Buffer.from(files["task.md"]);
  for (const name of ["governed-intake-policy-binding.js", "feature.md"] as const) {
    writeFileSync(path.join(dir, name), files[name]);
    entries[name] = { path: name, sha256: sha256(files[name]), byteLength: files[name].length };
  }
  manifest.payloadDigest = computePayloadDigest(entries);
  writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest));
  assert.equal(verifyGovernedIntakeRelease(dir).ok, true, "identical bytes are not a release-validity failure");
  const warnings = identicalPayloadWarnings(files);
  assert.equal(warnings.some((warning) => warning.includes("governed-intake-policy-binding")), false);
  assert.ok(warnings.some((warning) => warning.includes("feature.md") && warning.includes("task.md")), warnings.join("\n"));

  const alias = Buffer.from("{}\n");
  writeFileSync(path.join(dir, "contract.json"), alias);
  const stray = verifyGovernedIntakeRelease(dir);
  assert.equal(stray.ok, false);
  if (!stray.ok) assert.match(stray.error, /unexpected payload: contract\.json/);

  const listed = structuredClone(manifest);
  listed.files["contract.json"] = { path: "contract.json", sha256: sha256(alias), byteLength: alias.length };
  listed.payloadDigest = computePayloadDigest(listed.files);
  writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(listed));
  const admitted = verifyGovernedIntakeRelease(dir);
  assert.equal(admitted.ok, false);
  if (!admitted.ok) assert.match(admitted.error, /unexpected payload: contract\.json/);
});
