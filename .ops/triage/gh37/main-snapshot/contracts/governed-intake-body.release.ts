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
  "governed-intake-body.evaluate.ts": "contracts/governed-intake-body.evaluate.ts",
  "triage-evaluator.ts": "contracts/governed-intake-triage-state.evaluate.ts",
  "governed-intake-triage-state.evaluate.ts": "contracts/governed-intake-triage-state.evaluate.ts",
  "generator.ts": "contracts/governed-intake-body.generate.ts",
  "verify.ts": "contracts/governed-intake-release.verify.ts",
  "task.md": "contracts/generated/governed-intake/task.md",
  "task.yml": ".github/ISSUE_TEMPLATE/task.yml",
  "feature.md": "contracts/generated/governed-intake/feature.md",
  "feature.yml": ".github/ISSUE_TEMPLATE/feature.yml",
  "governed-intake-triage-policy.v1.json": "contracts/governed-intake-triage-policy.v1.json",
  "policy.json": "contracts/governed-intake-triage-policy.v1.json",
  "governed-intake-triage-policy.evaluate.ts": "contracts/governed-intake-triage-policy.evaluate.ts",
  "policy-evaluator.ts": "contracts/governed-intake-triage-policy.evaluate.ts",
  "governed-intake-triage-state.migrate.ts": "contracts/governed-intake-triage-state.migrate.ts",
  "delta-planner.ts": "contracts/governed-intake-triage-state.migrate.ts",
  "governed-intake-triage.compose.ts": "contracts/governed-intake-triage.compose.ts",
  "governed-intake-taxonomy.evaluate.ts": "contracts/governed-intake-taxonomy.evaluate.ts",
  "taxonomy-evaluator.ts": "contracts/governed-intake-taxonomy.evaluate.ts",
  "compose.ts": "contracts/governed-intake-triage.compose.ts",
  "governed-intake-policy-binding.ts": "contracts/governed-intake-policy-binding.ts",
  "policy-binding.ts": "contracts/governed-intake-policy-binding.ts",
  "governed-intake-task-profile.v1.json": "contracts/governed-intake-task-profile.v1.json",
  "task-profile-contract.json": "contracts/governed-intake-task-profile.v1.json",
  "governed-intake-task-profile.evaluate.ts": "contracts/governed-intake-task-profile.evaluate.ts",
  "task-profile-evaluator.ts": "contracts/governed-intake-task-profile.evaluate.ts",
} as const;
/** Every payload's bytes from its source. The one derivation shared by the build and the published-release check. */
export function releasePayloadFiles(readSource: (source: string) => Buffer): Record<string, Buffer> {
  const files: Record<string, Buffer> = {};
  for (const [payload, source] of Object.entries(RELEASE_SOURCE_FILES)) files[payload] = readSource(source);
  const executableJavaScript = (typescript: string): Buffer => {
    const stripped = stripTypeScriptTypes(typescript, { mode: "strip" });
    // Portable JS consumers import sibling .js payloads; leave JSON specifiers unchanged.
    return Buffer.from(stripped.replaceAll(/(["'])(\.\.?\/[^"']+)\.ts\1/g, "$1$2.js$1"), "utf8");
  };
  for (const payload of Object.keys(files).filter((name) => name.endsWith(".ts"))) {
    // Ship/hash the actual JavaScript that compiled consumers execute, not only TypeScript.
    files[payload.replace(/\.ts$/, ".js")] = executableJavaScript(files[payload].toString("utf8"));
  }
  return files;
}
export function releaseFileEntries(files: Record<string, Buffer>): Record<string, GovernedIntakeReleaseFileEntry> {
  const entries: Record<string, GovernedIntakeReleaseFileEntry> = {};
  for (const name of Object.keys(files).sort()) {
    entries[name] = { path: name, sha256: sha256(files[name]), byteLength: files[name].length };
  }
  return entries;
}
export const REPUBLISH_COMMAND = "node --experimental-strip-types contracts/governed-intake-body.release.ts --source-commit <full SHA of the commit holding the changed sources>";
export type PublishedReleaseCheck = { ok: true } | { ok: false; mismatches: string[]; message: string };
/** .github#43: the committed release must describe the payload bytes this tree would release.
 * Compares payload digests and byteLengths only. `producer.commit` is deliberately not compared:
 * it names the pre-squash source commit, which is never the commit that lands on main.
 */
export function checkPublishedReleaseMatchesSource(repoRoot: string = REPO_ROOT): PublishedReleaseCheck {
  const root = path.resolve(repoRoot);
  const releaseDir = path.join(root, "contracts/generated/governed-intake");
  const mismatches: string[] = [];
  try {
    const manifest: unknown = JSON.parse(readFileSync(path.join(releaseDir, "manifest.json"), "utf8"));
    const recorded: Record<string, Partial<GovernedIntakeReleaseFileEntry> | undefined> =
      manifest !== null && typeof manifest === "object" && "files" in manifest && manifest.files !== null && typeof manifest.files === "object"
        ? manifest.files as Record<string, GovernedIntakeReleaseFileEntry> : {};
    const current = releaseFileEntries(releasePayloadFiles((source) => readFileSync(path.join(root, source))));
    const sources: Record<string, string | undefined> = RELEASE_SOURCE_FILES;
    for (const name of [...new Set([...Object.keys(current), ...Object.keys(recorded)])].sort()) {
      const now = current[name], then = recorded[name];
      const source = sources[name] ?? sources[name.replace(/\.js$/, ".ts")] ?? "no release source";
      if (!now) mismatches.push(`${name}: recorded in the published manifest but no longer built from any release source`);
      else if (!then) mismatches.push(`${name}: built from ${source} but absent from the published manifest`);
      else if (now.sha256 !== then.sha256 || now.byteLength !== then.byteLength) {
        mismatches.push(`${name}: ${source} is now sha256 ${now.sha256} (${now.byteLength} bytes); the published manifest records ${String(then.sha256)} (${String(then.byteLength)} bytes)`);
      }
    }
  } catch (error) {
    mismatches.push(`release sources or published manifest unreadable: ${String(error)}`);
  }
  // The same structural read every consumer performs on default-branch bytes.
  const verified = verifyGovernedIntakeRelease(releaseDir);
  if (!verified.ok) mismatches.push(`published release directory refuses verification: ${verified.code}: ${verified.error}`);
  if (mismatches.length === 0) return { ok: true };
  return {
    ok: false, mismatches,
    message: [
      "Released governed-intake payload bytes differ from the published release manifest (contracts/generated/governed-intake/manifest.json).",
      "Consumers refuse this tree with corrupt_file, so it must not land on main (.github#43).",
      ...mismatches.map((line) => `  - ${line}`),
      "Republish in this same change: commit the source change, then run",
      `  ${REPUBLISH_COMMAND}`,
      "and commit the regenerated contracts/generated/governed-intake/ files to the same pull request.",
    ].join("\n"),
  };
}
export type BuildReleaseOptions = { repoRoot?: string; outputDir?: string; commit: string };
export function buildGovernedIntakeRelease(options: BuildReleaseOptions) {
  const root = path.resolve(options.repoRoot ?? REPO_ROOT);
  assertProducerCheckout(root);
  assert.match(options.commit ?? "", /^(?!0{40}$)[0-9a-f]{40}$/, "explicit nonzero full source commit required");
  const commit = options.commit;
  // A source tree, abbreviated ref, branch or unrelated commit is not a release identity.
  assert.equal(execFileSync("git", ["cat-file", "-t", commit], { cwd: root, encoding: "utf8", windowsHide: true }).trim(), "commit");
  checkProjections(root);
  const files = releasePayloadFiles((source) => {
    const bytes = readFileSync(path.join(root, source));
    const committed = execFileSync("git", ["show", `${commit}:${source}`], { cwd: root, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    assert.ok(bytes.equals(committed), `source does not match ${commit}: ${source}`);
    return committed;
  });
  // The producer implementation itself must also be committed at this source identity.
  for (const source of ["contracts/governed-intake-body.release.ts", "contracts/governed-intake-body.generate.ts"]) {
    assert.ok(readFileSync(path.join(root, source)).equals(execFileSync("git", ["show", `${commit}:${source}`], { cwd: root, windowsHide: true })), `uncommitted producer: ${source}`);
  }
  const contract = JSON.parse(files["contract.json"].toString("utf8"));
  assert.equal(contract.schema, RELEASE_SCHEMA_FAMILY);
  assert.equal(contract.owner, RELEASE_PRODUCER);
  assert.ok(Number.isSafeInteger(contract.version) && contract.version > 0);
  const entries = releaseFileEntries(files);
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
  } else if (args[0] === "--check") {
    const result = checkPublishedReleaseMatchesSource();
    if (!result.ok) { console.error(result.message); process.exit(1); }
    console.log("published governed-intake release matches the release sources in this tree");
  } else {
    assert.equal(args[0], "--source-commit", "usage: --source-commit <full SHA> [output-directory] | --verify [directory] | --check");
    const result = buildGovernedIntakeRelease({ commit: args[1], outputDir: args[2] ? path.resolve(args[2]) : DEFAULT_RELEASE_DIR });
    console.log(JSON.stringify(result.manifest, null, 2));
  }
}
