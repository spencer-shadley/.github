/** .github#43: released payload bytes and the published manifest must change together. */
import test from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, cpSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkPublishedReleaseMatchesSource, REPUBLISH_COMMAND } from "../contracts/governed-intake-body.release.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function copyOfProducer(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "published-release-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const tree of ["contracts", ".github/ISSUE_TEMPLATE"]) cpSync(path.join(root, tree), path.join(dir, tree), { recursive: true });
  return dir;
}

test("published release manifest matches the payload bytes this tree would release (.github#43)", () => {
  const result = checkPublishedReleaseMatchesSource(root);
  assert.ok(result.ok, result.ok ? "" : result.message);
});

test("a payload change without a republished manifest fails, naming the file and the republish command", (t) => {
  const cases = [
    // Source and payload are the same file: the exact .github#41 shape.
    { source: "contracts/generated/governed-intake/feature.md", payloads: ["feature.md"] },
    // Source lives outside the release directory, which still verifies on its own.
    { source: ".github/ISSUE_TEMPLATE/task.yml", payloads: ["task.yml"] },
    { source: "contracts/governed-intake-body.v1.json", payloads: ["contract.json", "governed-intake-body.v1.json"] },
    { source: "contracts/governed-intake-triage.compose.ts", payloads: ["compose.ts", "compose.js"] },
  ];
  for (const { source, payloads } of cases) {
    const dir = copyOfProducer(t);
    assert.equal(checkPublishedReleaseMatchesSource(dir).ok, true, "unchanged copy must pass");
    appendFileSync(path.join(dir, source), "\n");
    const result = checkPublishedReleaseMatchesSource(dir);
    assert.equal(result.ok, false, source);
    if (result.ok) continue;
    for (const payload of payloads) {
      assert.ok(result.mismatches.some((line) => line.startsWith(`${payload}: ${source} is now sha256 `)), `${source} -> ${payload}\n${result.message}`);
    }
    assert.ok(result.message.includes(REPUBLISH_COMMAND), result.message);
  }
});
