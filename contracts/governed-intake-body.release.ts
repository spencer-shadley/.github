/** Account-owned release producer. Origin: Code #4974; custody: .github#13.
 * Build only from committed source; never fabricate a commit or relabel a Code payload.
 * The source commit precedes the release-carrier commit, avoiding a self-referential hash.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertProducerCheckout, checkProjections } from "./governed-intake-body.generate.ts";
import {
  computePayloadDigest, sha256, RELEASE_MANIFEST_SCHEMA, RELEASE_SCHEMA_FAMILY, RELEASE_PRODUCER,
  verifyGovernedIntakeRelease, type GovernedIntakeReleaseManifest, type GovernedIntakeReleaseFileEntry,
} from "./governed-intake-release.verify.ts";
export * from "./governed-intake-release.verify.ts";
const THIS_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(THIS_FILE), "..");
export const DEFAULT_RELEASE_DIR = path.join(REPO_ROOT, "contracts/generated/governed-intake");
export const RELEASE_SOURCE_FILES = {
  "contract.json": "contracts/governed-intake-body.v1.json",
  "governed-intake-body.v1.json": "contracts/governed-intake-body.v1.json",
  "evaluator.ts": "contracts/governed-intake-body.evaluate.ts",
  "triage-evaluator.ts": "contracts/governed-intake-triage-state.evaluate.ts",
  "generator.ts": "contracts/governed-intake-body.generate.ts",
  "verify.ts": "contracts/governed-intake-release.verify.ts",
  "task.md": "contracts/generated/governed-intake/task.md",
  "task.yml": ".github/ISSUE_TEMPLATE/task.yml",
} as const;
export type BuildReleaseOptions = { repoRoot?: string; outputDir?: string; commit: string };
export function buildGovernedIntakeRelease(options: BuildReleaseOptions) {
  const root = path.resolve(options.repoRoot ?? REPO_ROOT);
  assertProducerCheckout(root);
  assert.match(options.commit ?? "", /^(?!0{40}$)[0-9a-f]{40}$/, "explicit nonzero full source commit required");
  const commit = options.commit;
  // A source tree, abbreviated ref, branch or unrelated commit is not a release identity.
  assert.equal(execFileSync("git", ["cat-file", "-t", commit], { cwd: root, encoding: "utf8", windowsHide: true }).trim(), "commit");
  checkProjections(root);
  const files: Record<string, Buffer> = {};
  for (const [payload, source] of Object.entries(RELEASE_SOURCE_FILES)) {
    const bytes = readFileSync(path.join(root, source));
    const committed = execFileSync("git", ["show", `${commit}:${source}`], { cwd: root, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    assert.ok(bytes.equals(committed), `source does not match ${commit}: ${source}`);
    files[payload] = committed;
  }
  // The producer implementation itself must also be committed at this source identity.
  for (const source of ["contracts/governed-intake-body.release.ts", "contracts/governed-intake-body.generate.ts"]) {
    assert.ok(readFileSync(path.join(root, source)).equals(execFileSync("git", ["show", `${commit}:${source}`], { cwd: root, windowsHide: true })), `uncommitted producer: ${source}`);
  }
  for (const payload of ["evaluator.ts", "triage-evaluator.ts", "generator.ts", "verify.ts"]) {
    // Ship/hash the actual JavaScript that compiled consumers execute, not only TypeScript.
    files[payload.replace(/\.ts$/, ".js")] = Buffer.from(stripTypeScriptTypes(files[payload].toString("utf8"), { mode: "strip" }), "utf8");
  }
  const contract = JSON.parse(files["contract.json"].toString("utf8"));
  assert.equal(contract.schema, RELEASE_SCHEMA_FAMILY);
  assert.equal(contract.owner, RELEASE_PRODUCER);
  assert.ok(Number.isSafeInteger(contract.version) && contract.version > 0);
  const entries: Record<string, GovernedIntakeReleaseFileEntry> = {};
  for (const name of Object.keys(files).sort()) {
    entries[name] = { path: name, sha256: sha256(files[name]), byteLength: files[name].length };
  }
  const manifest: GovernedIntakeReleaseManifest = {
    schema: RELEASE_MANIFEST_SCHEMA, schemaFamily: RELEASE_SCHEMA_FAMILY,
    revision: contract.version, producer: { repository: RELEASE_PRODUCER, commit },
    payloadDigest: computePayloadDigest(entries), files: entries,
    build: { runtime: process.version, compiler: "node:module.stripTypeScriptTypes/strip" },
  };
  const manifestJson = JSON.stringify(manifest, null, 2) + "\n";
  if (options.outputDir) {
    const out = path.resolve(options.outputDir);
    mkdirSync(out, { recursive: true });
    // Build into an isolated candidate directory; consumer admission/swap is a separate action.
    for (const [name, bytes] of Object.entries(files)) writeFileSync(path.join(out, name), bytes);
    writeFileSync(path.join(out, "manifest.json"), manifestJson, "utf8");
    const verified = verifyGovernedIntakeRelease(out);
    assert.ok(verified.ok, JSON.stringify(verified));
  }
  return { manifest, manifestJson, files };
}
if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
  const args = process.argv.slice(2);
  if (args[0] === "--verify") {
    const result = verifyGovernedIntakeRelease(args[1] ? path.resolve(args[1]) : DEFAULT_RELEASE_DIR);
    if (!result.ok) { console.error(JSON.stringify(result)); process.exit(1); }
    console.log(`verified ${result.manifest.producer.repository}@${result.manifest.producer.commit} revision ${result.manifest.revision} ${result.manifest.payloadDigest}`);
  } else {
    assert.equal(args[0], "--source-commit", "usage: --source-commit <full SHA> [output-directory] | --verify [directory]");
    const result = buildGovernedIntakeRelease({ commit: args[1], outputDir: args[2] ? path.resolve(args[2]) : DEFAULT_RELEASE_DIR });
    console.log(JSON.stringify(result.manifest, null, 2));
  }
}
