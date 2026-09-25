import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { generate, renderPolicyGuide } from '../contracts/governed-intake-triage-policy.generate.ts';
import policy from '../contracts/governed-intake-triage-policy.v1.json' with { type: 'json' };

test('checked-in policy guide is a deterministic same-source projection', () => {
  assert.doesNotThrow(() => generate(true));
  const first = renderPolicyGuide(policy, 'test-digest');
  assert.equal(first, renderPolicyGuide(policy, 'test-digest'));
  assert.ok(first.includes(policy.effortRubric.definitions.high));
  assert.ok(first.includes('not a deployment receipt'));
});
test('a changed definition changes the generated guide, not a private skill copy', () => {
  const altered = structuredClone(policy); altered.effortRubric.definitions.low = 'Changed source definition.';
  const changed = renderPolicyGuide(altered, 'changed-digest');
  assert.ok(changed.includes('Changed source definition.'));
  assert.notEqual(changed, renderPolicyGuide(policy, 'test-digest'));
});
test('generation check actually rejects drift without touching the checkout', () => {
  const root = mkdtempSync(join(tmpdir(), 'triage-policy-drift-'));
  try {
    mkdirSync(join(root, 'contracts')); mkdirSync(join(root, 'docs'));
    writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
    for (const file of ['governed-intake-triage-policy.generate.ts', 'governed-intake-triage-policy.evaluate.ts', 'governed-intake-triage-policy.v1.json']) {
      copyFileSync(new URL(`../contracts/${file}`, import.meta.url), join(root, 'contracts', file));
    }
    const original = readFileSync(new URL('../docs/triage-policy.md', import.meta.url), 'utf8');
    writeFileSync(join(root, 'docs', 'triage-policy.md'), `${original}\nUnapproved manual drift.\n`);
    const result = spawnSync(process.execPath, ['--experimental-strip-types', join(root, 'contracts', 'governed-intake-triage-policy.generate.ts'), '--check'], { encoding: 'utf8' });
    assert.equal(result.status, 1); assert.match(result.stderr, /triage_policy_documentation_drift/);
    assert.equal(readFileSync(new URL('../docs/triage-policy.md', import.meta.url), 'utf8'), original);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
