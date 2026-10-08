/** Full-byte diagnostics for the consumer release/read transport.
 *
 * These hashes describe observed source, never admission authority. Mutable producer
 * identity and actual consumer/runtime acceptance still need their own fresh reads.
 * Full file bytes intentionally cover imports, typed/let state, arrow functions and
 * helper bodies which the historical top-level-function extractor cannot cover.
 */
import { createHash } from "node:crypto";
import capture from "./governed-intake-worker-diagnostics.v1.json" with { type: "json" };

export const WORKER_DIAGNOSTIC_PATHS = [
  "tools/github-mcp-worker/src/triage-checklist-state.ts",
  "tools/github-mcp-worker/src/triage-runtime-producer-content.ts",
  "tools/github-mcp-worker/src/index.ts",
  "tools/github-mcp-worker/src/triage-runtime-request.ts",
  "tools/github-mcp-worker/src/triage-runtime-observation.ts",
  "tools/github-mcp-worker/src/triage-runtime-continuation.ts",
  "tools/github-mcp-worker/src/triage-runtime-rest-page.ts",
  "tools/github-mcp-worker/src/triage-runtime-hash-work.ts",
  "tools/github-mcp-worker/src/triage-runtime-sha256.ts",
  "tools/github-mcp-worker/src/triage-runtime-identities.ts",
  "tools/github-mcp-worker/src/github-api-error.ts",
] as const;

export type WorkerSourceFingerprint = { blobSha: string; sha256: string; byteLength: number };
export type WorkerSourceCapture = {
  schema: "GovernedIntakeWorkerSourceDiagnosticsV1";
  /** Null while the consumer source has not landed; never substitute an unmerged head. */
  consumerCommit: string | null;
  files: Record<string, WorkerSourceFingerprint>;
};
export const WORKER_SOURCE_CAPTURE = capture as WorkerSourceCapture;

export function fingerprintWorkerFile(bytes: Uint8Array): WorkerSourceFingerprint {
  return {
    blobSha: createHash("sha1").update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex"),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    byteLength: bytes.byteLength,
  };
}

/** Produce a complete capture from exact immutable Git bytes, without normalizing text. */
export function fingerprintWorkerFiles(read: (file: string) => Uint8Array): Record<string, WorkerSourceFingerprint> {
  return Object.fromEntries(WORKER_DIAGNOSTIC_PATHS.map(file => [file, fingerprintWorkerFile(read(file))]));
}

export function workerSourceCaptureProblem(record: WorkerSourceCapture): string | null {
  if (record.schema !== "GovernedIntakeWorkerSourceDiagnosticsV1") return "unrecognized source diagnostic schema";
  if (record.consumerCommit === null) return "final landed consumer source has not been captured";
  if (!/^[0-9a-f]{40}$/.test(record.consumerCommit)) return "consumer commit is not a full Git commit";
  if (!record.files || typeof record.files !== "object" || Array.isArray(record.files)) return "missing source file table";
  if (Object.keys(record.files).sort().join("\n") !== [...WORKER_DIAGNOSTIC_PATHS].sort().join("\n"))
    return "source diagnostic file inventory is incomplete or unexpected";
  for (const file of WORKER_DIAGNOSTIC_PATHS) {
    const entry = record.files[file];
    if (!entry || !/^[0-9a-f]{40}$/.test(entry.blobSha) || !/^[0-9a-f]{64}$/.test(entry.sha256)
      || !Number.isSafeInteger(entry.byteLength) || entry.byteLength < 0) return `invalid source fingerprint for ${file}`;
  }
  return null;
}

/** Every unavailable or changed file is explicit; warnings never claim compatibility PASS. */
export function describeWorkerSourceDrift(
  read: (file: string) => Uint8Array, observedCommit: string, record: WorkerSourceCapture = WORKER_SOURCE_CAPTURE,
): string[] {
  const problem = workerSourceCaptureProblem(record);
  if (problem) return [`WARNING worker source coverage unavailable: ${problem}; compatibility has not been established; admission proceeds.`];
  return WORKER_DIAGNOSTIC_PATHS.flatMap(file => {
    const expected = record.files[file]!;
    let actual: WorkerSourceFingerprint;
    try { actual = fingerprintWorkerFile(read(file)); }
    catch (error) {
      return [`WARNING worker source unavailable spencer-shadley/code@${observedCommit}:${file}: ${error instanceof Error ? error.message : String(error)}; compatibility has not been established; admission proceeds.`];
    }
    if (actual.blobSha === expected.blobSha && actual.sha256 === expected.sha256 && actual.byteLength === expected.byteLength) return [];
    return [`WARNING worker source drift spencer-shadley/code@${observedCommit}:${file}: `
      + `captured at ${record.consumerCommit} blob ${expected.blobSha} sha256 ${expected.sha256} bytes ${expected.byteLength}; `
      + `observed blob ${actual.blobSha} sha256 ${actual.sha256} bytes ${actual.byteLength}; compatibility prediction may be stale; admission proceeds.`];
  });
}
