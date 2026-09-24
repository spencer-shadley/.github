import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const guide = "docs/governed-intake-ssot.md";
const canonicalGuideUrl = `https://github.com/spencer-shadley/.github/blob/main/${guide}`;
const entrypoints = ["AGENTS.md", "README.md", "CONTRIBUTING.md", "profile/README.md", "SUPPORT.md", "skills/full-validation/SKILL.md"];

function linksToGuide(file: string, content: string): boolean {
  for (const match of content.matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)) {
    const target = match[1].split("#")[0];
    if (target === canonicalGuideUrl) return true;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(target) &&
        path.resolve(root, path.dirname(file), target) === path.resolve(root, guide)) return true;
  }
  return false;
}

// Narrow regressions from #15, not a substitute for a semantic documentation review.
function retiredInstructions(content: string): string[] {
  const text = content.replace(/\s+/g, " ");
  const patterns: Array<[string, RegExp]> = [
    ["reversed ownership", /which is the source of truth for the file conventions this `\.github` repository mirrors at account scope/i],
    ["automatic workflow inheritance", /a workflow file living in `\.github` would apply account-wide by default/i],
    ["repository-wide writer serialization", /one writer per repository at a time/i],
    ["non-GitHub human escalation", /human escalation for anything time-sensitive goes through the fleet's ntfy\.sh channel, not GitHub/i],
  ];
  return patterns.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}

test("active entrypoints link to the one canonical intake guide", () => {
  assert.ok(existsSync(path.join(root, guide)), "canonical intake guide must exist");
  for (const file of entrypoints) {
    assert.ok(linksToGuide(file, readFileSync(path.join(root, file), "utf8")), `${file}: missing canonical guide link`);
  }
});

test("canonical guide link checking resolves relative paths and rejects lookalikes", () => {
  assert.equal(linksToGuide("skills/full-validation/SKILL.md", "[guide](../../docs/governed-intake-ssot.md#authority)"), true);
  assert.equal(linksToGuide("README.md", `[guide](${canonicalGuideUrl})`), true);
  assert.equal(linksToGuide("README.md", "[guide](other/docs/governed-intake-ssot.md)"), false);
  assert.equal(linksToGuide("README.md", "docs/governed-intake-ssot.md"), false);
  assert.equal(linksToGuide("README.md", `[guide](${canonicalGuideUrl}.old)`), false);
});

test("active entrypoints do not reintroduce the known retired instructions", () => {
  for (const file of [...entrypoints, guide]) {
    assert.deepEqual(retiredInstructions(readFileSync(path.join(root, file), "utf8")), [], file);
  }
});

test("retired-instruction regression checks catch wrapped original wording", () => {
  assert.deepEqual(retiredInstructions("which is the source of truth for the file conventions this `.github` repository mirrors at\naccount scope"), ["reversed ownership"]);
  assert.deepEqual(retiredInstructions("a workflow file living in `.github` would apply account-wide by default"), ["automatic workflow inheritance"]);
  assert.deepEqual(retiredInstructions("One writer per repository\nat a time."), ["repository-wide writer serialization"]);
  assert.deepEqual(retiredInstructions("Human escalation for anything time-sensitive goes through the fleet's ntfy.sh channel, not\nGitHub"), ["non-GitHub human escalation"]);
  assert.deepEqual(retiredInstructions("Repo Template owns bootstrap conformance; .github owns the account forms."), []);
});
