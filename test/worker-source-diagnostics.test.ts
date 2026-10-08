import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  WORKER_DIAGNOSTIC_PATHS, WORKER_SOURCE_CAPTURE, describeWorkerSourceDrift,
  fingerprintWorkerFile, fingerprintWorkerFiles, workerSourceCaptureProblem, type WorkerSourceCapture,
} from "../contracts/governed-intake-worker-diagnostics.ts";

const encode = (value: string) => new TextEncoder().encode(value);
const files = Object.fromEntries(WORKER_DIAGNOSTIC_PATHS.map(file => [file, encode(`// ${file}\nconst initial = true;\n`)]));
const baseline = (): WorkerSourceCapture => ({
  schema: "GovernedIntakeWorkerSourceDiagnosticsV1", consumerCommit: "a".repeat(40),
  files: fingerprintWorkerFiles(file => files[file]!),
});

test("raw file diagnostics cover state declarations, imports, closures and non-normalized bytes", () => {
  const record = baseline(), resolver = WORKER_DIAGNOSTIC_PATHS[0];
  assert.deepEqual(describeWorkerSourceDrift(file => files[file]!, "b".repeat(40), record), []);
  for (const change of [
    "let memoBytes: number = 1;\n", "const typed: { x: number } = {\n  x: 2,\n};\n",
    "const closure = () => false;\n", "import \"./different-helper.ts\";\n", " \n",
  ]) {
    const warnings = describeWorkerSourceDrift(file => file === resolver
      ? encode(new TextDecoder().decode(files[file]!) + change) : files[file]!, "b".repeat(40), record);
    assert.equal(warnings.length, 1); assert.ok(warnings[0]!.includes(resolver));
    assert.match(warnings[0]!, /admission proceeds/);
  }
  assert.notDeepEqual(fingerprintWorkerFile(encode("a\r\n")), fingerprintWorkerFile(encode("a\n")));
});

test("each declared transport/observation dependency is independently checked", () => {
  const record = baseline();
  for (const changed of WORKER_DIAGNOSTIC_PATHS) {
    const warnings = describeWorkerSourceDrift(file => file === changed ? encode("changed") : files[file]!, "b".repeat(40), record);
    assert.equal(warnings.length, 1); assert.ok(warnings[0]!.includes(changed));
    const missing = describeWorkerSourceDrift(file => {
      if (file === changed) throw new Error("missing immutable object");
      return files[file]!;
    }, "b".repeat(40), record);
    assert.equal(missing.length, 1); assert.ok(missing[0]!.includes(changed));
    assert.match(missing[0]!, /compatibility has not been established/);
  }
});

test("incomplete captures remain explicitly unknown without manufacturing landed evidence", () => {
  const pending: WorkerSourceCapture = { schema: "GovernedIntakeWorkerSourceDiagnosticsV1", consumerCommit: null, files: {} };
  assert.match(workerSourceCaptureProblem(pending)!, /has not been captured/);
  assert.match(describeWorkerSourceDrift(() => { throw new Error("must not read"); }, "b".repeat(40), pending)[0]!, /unavailable/);
  const broken = baseline(); delete broken.files[WORKER_DIAGNOSTIC_PATHS[1]];
  assert.match(workerSourceCaptureProblem(broken)!, /inventory/);
  const malformed = baseline(); malformed.files[WORKER_DIAGNOSTIC_PATHS[0]]!.byteLength = -1;
  assert.match(workerSourceCaptureProblem(malformed)!, /invalid source fingerprint/);
});

test("final captured source fixtures are exact Git bytes; staged capture stays visibly pending", () => {
  if (WORKER_SOURCE_CAPTURE.consumerCommit === null) {
    assert.deepEqual(WORKER_SOURCE_CAPTURE.files, {});
    return;
  }
  assert.equal(workerSourceCaptureProblem(WORKER_SOURCE_CAPTURE), null);
  for (const file of WORKER_DIAGNOSTIC_PATHS) {
    const expected = WORKER_SOURCE_CAPTURE.files[file]!;
    const bytes = readFileSync(new URL(`./fixtures/consumer-pin/blobs/${expected.blobSha}`, import.meta.url));
    assert.deepEqual(fingerprintWorkerFile(bytes), expected, file);
  }
});
