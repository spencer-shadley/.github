import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Docs name canonical repo-root paths, including from nested files such as profile/README.md.
const ISSUE_TEMPLATE_REF = /\.github\/ISSUE_TEMPLATE\/[A-Za-z0-9._/-]+/g;
const LIVE_TASK_MD = ".github/ISSUE_TEMPLATE/task.md";

type TemplateReference = {
  file: string;
  line: number;
  ref: string;
};

function trackedMarkdown(): string[] {
  const output = execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
  });
  return output
    .split("\0")
    .filter((file) => file.length > 0)
    .map((file) => file.replaceAll("\\", "/"))
    .filter((file) => file.endsWith(".md"));
}

function normalizeRef(raw: string): string {
  return raw.replace(/[.,:;)\].>]+$/u, "").replace(/\/+$/u, "");
}

function referencesIn(file: string, content: string): TemplateReference[] {
  const found: TemplateReference[] = [];
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    for (const match of lines[index].matchAll(ISSUE_TEMPLATE_REF)) {
      found.push({
        file,
        line: index + 1,
        ref: normalizeRef(match[0]),
      });
    }
  }
  return found;
}

function markdownTemplateReferences(): TemplateReference[] {
  const found: TemplateReference[] = [];
  for (const file of trackedMarkdown()) {
    const content = readFileSync(path.join(root, file), "utf8");
    found.push(...referencesIn(file, content));
  }
  return found;
}

test("tracked markdown .github/ISSUE_TEMPLATE references exist", () => {
  const found = markdownTemplateReferences();
  assert.ok(
    found.length > 0,
    "expected tracked markdown to reference .github/ISSUE_TEMPLATE/",
  );

  const missing = found
    .filter(({ ref }) => !existsSync(path.join(root, ref)))
    .map(({ file, line, ref }) => `${file}:${line} ${ref}`);

  assert.deepEqual(
    missing,
    [],
    "every referenced .github/ISSUE_TEMPLATE relative path must exist",
  );
});

test("no markdown presents .github/ISSUE_TEMPLATE/task.md as a live template", () => {
  const live = markdownTemplateReferences()
    .filter(({ ref }) => ref === LIVE_TASK_MD)
    .map(({ file, line, ref }) => `${file}:${line} ${ref}`);

  assert.deepEqual(
    live,
    [],
    "markdown must not present .github/ISSUE_TEMPLATE/task.md as a live template",
  );
});
