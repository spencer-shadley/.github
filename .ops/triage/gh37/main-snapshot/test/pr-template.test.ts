import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const prTemplatePath = path.join(root, ".github", "PULL_REQUEST_TEMPLATE.md");
const agentsPath = path.join(root, "AGENTS.md");

test("PULL_REQUEST_TEMPLATE.md contains referenced canonical sections and marker", () => {
  assert.equal(existsSync(prTemplatePath), true, "PULL_REQUEST_TEMPLATE.md must exist");
  const content = readFileSync(prTemplatePath, "utf8");

  assert.match(
    content,
    /^##\s+Agent Provenance Labels\s*$/m,
    "PULL_REQUEST_TEMPLATE.md must contain '## Agent Provenance Labels' heading",
  );
  assert.match(
    content,
    /^##\s+Agent Cost Summary\s*$/m,
    "PULL_REQUEST_TEMPLATE.md must contain '## Agent Cost Summary' heading",
  );
  assert.match(
    content,
    /<!--\s*agent-cost-summary-v1\s*-->/,
    "PULL_REQUEST_TEMPLATE.md must contain '<!-- agent-cost-summary-v1 -->' marker",
  );
});

test("AGENTS.md points to PR template contract without redefining semantics", () => {
  assert.equal(existsSync(agentsPath), true, "AGENTS.md must exist");
  const content = readFileSync(agentsPath, "utf8");

  assert.match(
    content,
    /\.github\/PULL_REQUEST_TEMPLATE\.md/,
    "AGENTS.md must reference .github/PULL_REQUEST_TEMPLATE.md",
  );
  assert.match(
    content,
    /Agent Provenance Labels/,
    "AGENTS.md must reference 'Agent Provenance Labels'",
  );
  assert.match(
    content,
    /Agent Cost Summary/,
    "AGENTS.md must reference 'Agent Cost Summary'",
  );
  assert.match(
    content,
    /<!--\s*agent-cost-summary-v1\s*-->/,
    "AGENTS.md must reference '<!-- agent-cost-summary-v1 -->'",
  );

  // Invariant: AGENTS.md must not duplicate detailed metric or accounting semantics
  const forbiddenRestatements = [
    "summed agent wall-clock",
    "process-tree CPU",
    "subscription-cycle consumption",
    "effective subscription cost",
    "filed-by-<model>-<effort>",
    "triaged-by-<model>-<effort>",
  ];

  for (const phrase of forbiddenRestatements) {
    assert.equal(
      content.includes(phrase),
      false,
      `AGENTS.md must not restate detailed semantics: found '${phrase}'`,
    );
  }
});
