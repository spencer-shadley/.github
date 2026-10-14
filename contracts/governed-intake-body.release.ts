/** Account-owned release producer. Origin: Code #4974; custody: .github#13.
 * Build only from committed source; never fabricate a commit or relabel a Code payload.
 * The source commit precedes the release-carrier commit, avoiding a self-referential hash.
 *
 * Each source is declared once. The payload name is the source basename, except the
 * sole-name payloads verify.ts and generator.ts. A .ts source also emits its .js twin
 * from that declaration. The manifest schema stays GovernedIntakeReleaseManifestV1.
 * Dropping a duplicate name does not change the checklist revision; release identity
 * is the producer commit and payloadDigest (.github#33).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
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
/** Payload names that are not the source basename. */
export const RELEASE_SOLE_NAME_EXCEPTIONS: Readonly<Record<string, string>> = {
  "contracts/governed-intake-release.verify.ts": "verify.ts",
  "contracts/governed-intake-body.generate.ts": "generator.ts",
};
/** Additional identical-byte pairs that are not a declared TypeScript payload and its emitted JavaScript. */
export const IDENTICAL_PAYLOAD_ALLOWLIST: readonly (readonly [string, string])[] = [];
export const RELEASE_SOURCES = [
  "contracts/governed-intake-body.v1.json",
  "contracts/governed-intake-body.evaluate.ts",
  "contracts/governed-intake-triage-state.evaluate.ts",
  "contracts/governed-intake-body.generate.ts",
  "contracts/governed-intake-release.verify.ts",
  "contracts/generated/governed-intake/task.md",
  ".github/ISSUE_TEMPLATE/task.yml",
  "contracts/generated/governed-intake/feature.md",
  ".github/ISSUE_TEMPLATE/feature.yml",
  "contracts/governed-intake-triage-policy.v1.json",
  "contracts/governed-intake-triage-policy.evaluate.ts",
  "contracts/governed-intake-triage-state.migrate.ts",
  "contracts/governed-intake-triage.compose.ts",
  "contracts/governed-intake-taxonomy.evaluate.ts",
  "contracts/governed-intake-policy-binding.ts",
  "contracts/governed-intake-task-profile.v1.json",
  "contracts/governed-intake-task-profile.evaluate.ts",
] as const;
export type ReleasePayloadPlanEntry = { source: string; name: string; kind: "source" | "javascript" };
const PAYLOAD_NAME = /^[a-z0-9][a-z0-9._-]*$/;
/** Declare each source once. Reject a repeated source or any output-name collision, including generated .js names. */
export function planReleasePayloads(
  sources: readonly string[],
  exceptions: Readonly<Record<string, string>> = {},
): ReleasePayloadPlanEntry[] {
  const unknown = Object.keys(exceptions).filter((source) => !sources.includes(source)).sort();
  if (unknown.length > 0) throw new Error(`sole-name exception has no declared source: ${unknown.join(", ")}`);
  const seenSources = new Set<string>();
  const claimed = new Set<string>();
  const plan: ReleasePayloadPlanEntry[] = [];
  const claim = (name: string) => {
    if (!PAYLOAD_NAME.test(name)) throw new Error(`invalid release payload name: ${name}`);
    if (claimed.has(name)) throw new Error(`output-name collision: ${name}`);
    claimed.add(name);
  };
  for (const source of sources) {
    if (seenSources.has(source)) throw new Error(`repeated release source: ${source}`);
    seenSources.add(source);
    const name = Object.hasOwn(exceptions, source) ? exceptions[source] : path.basename(source);
    claim(name);
    plan.push({ source, name, kind: "source" });
    if (!source.endsWith(".ts")) continue;
    if (!name.endsWith(".ts")) throw new Error(`typescript payload name must end in .ts: ${name}`);
    const javascript = `${name.slice(0, -".ts".length)}.js`;
    claim(javascript);
    plan.push({ source, name: javascript, kind: "javascript" });
  }
  return plan;
}
export function sourceForReleasePayload(
  name: string,
  sources: readonly string[] = RELEASE_SOURCES,
  exceptions: Readonly<Record<string, string>> = RELEASE_SOLE_NAME_EXCEPTIONS,
): string {
  return planReleasePayloads(sources, exceptions).find((entry) => entry.name === name)?.source ?? "no release source";
}
/** Declared .ts/.js pairs, plus IDENTICAL_PAYLOAD_ALLOWLIST. A type-free .ts may strip to identical .js. */
export function identicalPayloadAllowlist(
  sources: readonly string[] = RELEASE_SOURCES,
  exceptions: Readonly<Record<string, string>> = RELEASE_SOLE_NAME_EXCEPTIONS,
): Array<[string, string]> {
  const plan = planReleasePayloads(sources, exceptions);
  const pairs: Array<[string, string]> = [];
  for (const javascript of plan) {
    if (javascript.kind !== "javascript") continue;
    const typescript = plan.find((entry) => entry.kind === "source" && entry.source === javascript.source);
    if (typescript) pairs.push([typescript.name, javascript.name]);
  }
  for (const [left, right] of IDENTICAL_PAYLOAD_ALLOWLIST) pairs.push([left, right]);
  return pairs;
}
/** Producer warning only. Identical bytes do not make a release invalid. */
export function identicalPayloadWarnings(
  files: Record<string, Buffer>,
  allowlist: ReadonlyArray<readonly [string, string]> = identicalPayloadAllowlist(),
): string[] {
  const allowed = new Set(allowlist.flatMap(([left, right]) => [`${left}\0${right}`, `${right}\0${left}`]));
  const byHash = new Map<string, string[]>();
  for (const [name, bytes] of Object.entries(files)) {
    const hash = sha256(bytes);
    const names = byHash.get(hash) ?? [];
    names.push(name);
    byHash.set(hash, names);
  }
  const warnings: string[] = [];
  for (const names of byHash.values()) {
    const sorted = [...names].sort();
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        if (!allowed.has(`${sorted[i]}\0${sorted[j]}`)) warnings.push(`identical payload bytes: ${sorted[i]} and ${sorted[j]}`);
      }
    }
  }
  return warnings;
}
function executableJavaScript(typescript: string): Buffer {
  const stripped = stripTypeScriptTypes(typescript, { mode: "strip" });
  // Portable JS consumers import sibling .js payloads; leave JSON specifiers unchanged.
  return Buffer.from(stripped.replaceAll(/(["'])(\.\.?\/[^"']+)\.ts\1/g, "$1$2.js$1"), "utf8");
}
/** Every payload's bytes from its declared source. The one derivation shared by the build and the published-release check. */
export function releasePayloadFiles(
  readSource: (source: string) => Buffer,
  sources: readonly string[] = RELEASE_SOURCES,
  exceptions: Readonly<Record<string, string>> = RELEASE_SOLE_NAME_EXCEPTIONS,
): Record<string, Buffer> {
  const plan = planReleasePayloads(sources, exceptions);
  const bytes = new Map<string, Buffer>();
  const files: Record<string, Buffer> = {};
  for (const entry of plan) {
    if (!bytes.has(entry.source)) bytes.set(entry.source, readSource(entry.source));
    const sourceBytes = bytes.get(entry.source)!;
    files[entry.name] = entry.kind === "source" ? sourceBytes : executableJavaScript(sourceBytes.toString("utf8"));
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
    const currentFiles = releasePayloadFiles((source) => readFileSync(path.join(root, source)));
    for (const warning of identicalPayloadWarnings(currentFiles)) console.warn(`governed-intake release: ${warning}`);
    const current = releaseFileEntries(currentFiles);
    for (const name of [...new Set([...Object.keys(current), ...Object.keys(recorded)])].sort()) {
      const now = current[name], then = recorded[name];
      const source = sourceForReleasePayload(name);
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
  for (const warning of identicalPayloadWarnings(files)) console.warn(`governed-intake release: ${warning}`);
  // The producer implementation itself must also be committed at this source identity.
  for (const source of ["contracts/governed-intake-body.release.ts", "contracts/governed-intake-body.generate.ts"]) {
    assert.ok(readFileSync(path.join(root, source)).equals(execFileSync("git", ["show", `${commit}:${source}`], { cwd: root, windowsHide: true })), `uncommitted producer: ${source}`);
  }
  const contract = JSON.parse(files["governed-intake-body.v1.json"].toString("utf8"));
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
    const expected = new Set([...Object.keys(files), "manifest.json"]);
    for (const [name, bytes] of Object.entries(files)) writeFileSync(path.join(out, name), bytes);
    writeFileSync(path.join(out, "manifest.json"), manifestJson, "utf8");
    for (const entry of readdirSync(out, { withFileTypes: true })) {
      if (expected.has(entry.name)) continue;
      if (!entry.isFile()) throw new Error(`unexpected non-file in release directory: ${entry.name}`);
      unlinkSync(path.join(out, entry.name));
    }
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
