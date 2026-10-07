/** Vendored github-mcp-worker release resolution (spencer-shadley/code#8013).
 *
 * This is the consumer's own decision procedure, copied check-for-check from
 * spencer-shadley/code `tools/github-mcp-worker/src/triage-checklist-state.ts`
 * (`resolveGovernedIntakeRuntime`, `verifyLiveManifest`, `verifyProducerPayload`)
 * at the commit recorded in VENDORED_WORKER_RESOLUTION. It answers one question
 * offline and deterministically: would the deployed worker, built from a given
 * set of consumer pins and caches, refuse this producer release?
 *
 * Why vendored rather than imported: the worker functions are not exported, they
 * bind module-level JSON imports of Code's caches and Code-internal helpers, and
 * Code is a separate private repository that this repository does not depend on
 * or execute. A port with recorded per-function fingerprints keeps the verdict
 * faithful. `contracts/governed-intake-consumer-pin.check.ts` re-reads the worker
 * source at the exact consumer commit it checks against and fails closed when any
 * fingerprint differs, so a change to the worker's rules forces a re-vendor
 * instead of silently diverging.
 *
 * Differences from the worker, all deliberate:
 * - Bundles (pin + cached manifest) are parameters instead of module imports.
 * - Refusals are returned as typed values that name the field and both values,
 *   instead of thrown `Error`s. The first refusal wins, in the worker's order.
 * - `invalid_pin` omits the worker's `producer.CURRENT_TRIAGE_REVISION` term.
 *   Code's build admission already equates it with the cached manifest revision.
 * - One build-admission check runs after the runtime checks: the release manifest
 *   git blob must equal the pin's `releaseManifestBlobSha`. Code admits a
 *   byte-exact cache recorded by that blob.
 */
import { createHash } from "node:crypto";

export const PRODUCER_REPOSITORY = "spencer-shadley/.github" as const;
export const PRODUCER_SOURCE_PATH = "contracts/governed-intake-body.v1.json" as const;
export const PRODUCER_MANIFEST_PATH = "contracts/generated/governed-intake/manifest.json" as const;
export const PRODUCER_TASK_FORM_PATH = ".github/ISSUE_TEMPLATE/task.yml" as const;

/** The worker source this file mirrors, with a sha256 per mirrored function body. */
export const VENDORED_WORKER_RESOLUTION = {
  repository: "spencer-shadley/code",
  path: "tools/github-mcp-worker/src/triage-checklist-state.ts",
  commit: "b6ecfbf7cab9fdfbdf71af7e7ac912d3dc6af338",
  blobSha: "653aa1f3602f447586f0ca8f33603091e7eb2e1e",
  functions: {
    verifyProducerPayload: "8fc590015083635920b514371ff8b826ffb2691fd76069a6e21c61295ad67fb4",
    verifyLiveManifest: "d012432ffe78317dc43659d79696b4fdd992308f3f2d1a4f539122302b0b0d9a",
    resolveGovernedIntakeRuntime: "96b96c683342b04d482d00a0c7877687b2d7f9433268367ea8154fb76e3be98b",
  },
} as const;

export type WorkerPin = {
  schema: string;
  producer: {
    repository: string;
    defaultBranch: string;
    releaseCommit: string;
    producerCommit: string;
    sourcePath: string;
    sourceBlobSha: string;
    releaseManifestPath: string;
    releaseManifestBlobSha: string;
  };
  revision: number;
  payloadDigest: string;
};
type ManifestEntry = { path: string; sha256: string; byteLength: number };
export type ReleaseManifest = {
  schema?: unknown;
  schemaFamily?: unknown;
  revision?: unknown;
  producer?: { repository?: unknown; commit?: unknown };
  payloadDigest?: unknown;
  files?: Record<string, ManifestEntry>;
};
/** One worker release slot: an admitted pin plus Code's byte-exact cached manifest. */
export type WorkerReleaseBundle = { pin: WorkerPin; manifest: ReleaseManifest };
/** The worker's two slots: `published` (current) and the revision-keyed `prepared` candidate. */
export type WorkerConsumerPins = { published: WorkerReleaseBundle; prepared: WorkerReleaseBundle | null };
/** What the worker reads from the producer's default branch at one immutable commit. */
export type ProducerRelease = { manifest: Uint8Array; source: Uint8Array; taskForm: Uint8Array };

export type WorkerRefusalCode = "invalid_pin" | "invalid_manifest" | "repository_mismatch" | "commit_mismatch"
  | "revision_mismatch" | "digest_mismatch" | "corrupt_file" | "source_blob_mismatch" | "manifest_blob_mismatch";
export type WorkerSlot = "published" | "prepared";
export type WorkerRefusal = {
  code: WorkerRefusalCode;
  stage: "runtime" | "admission";
  slot: WorkerSlot;
  /** Pin or cached-manifest field the worker compared. */
  field: string;
  /** Value the consumer admitted. */
  expected: string;
  /** Value the producer release carries. */
  actual: string;
  message: string;
};
export type WorkerResolution =
  | { ok: true; slot: WorkerSlot; identity: { producerCommit: string; releaseCommit: string; revision: number; payloadDigest: string; sourceBlobSha: string } }
  | { ok: false; refusal: WorkerRefusal };

export const sha256Hex = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");
/** Git blob object id (what the GitHub contents API returns as `sha`). */
export function gitBlobSha(bytes: Uint8Array): string {
  return createHash("sha1").update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex");
}
const decodeUtf8 = (bytes: Uint8Array): string => new TextDecoder("utf-8", { fatal: true }).decode(bytes);
const show = (value: unknown): string => (typeof value === "string" ? value : JSON.stringify(value) ?? "undefined");

class Refused extends Error {
  readonly refusal: WorkerRefusal;
  constructor(refusal: WorkerRefusal) { super(refusal.message); this.refusal = refusal; }
}

/** The worker's `verifyLiveManifest`, check for check. */
function verifyLiveManifest(value: unknown, bundle: WorkerReleaseBundle, slot: WorkerSlot): void {
  const pin = bundle.pin;
  const cached = bundle.manifest;
  const refuse = (code: WorkerRefusalCode, field: string, expected: unknown, actual: unknown, detail: string): never => {
    throw new Refused({ code, stage: "runtime", slot, field, expected: show(expected), actual: show(actual), message: `governed-intake ${code}${detail} (${PRODUCER_REPOSITORY})` });
  };
  const manifest = value as ReleaseManifest | null;
  if (!manifest || manifest.schema !== "GovernedIntakeReleaseManifestV1"
    || manifest.schemaFamily !== "GovernedIntakeBodyV1" || !manifest.files) refuse("invalid_manifest", "manifest.schema/schemaFamily/files", "GovernedIntakeReleaseManifestV1/GovernedIntakeBodyV1", `${show(manifest?.schema)}/${show(manifest?.schemaFamily)}`, "");
  if (manifest!.producer?.repository !== PRODUCER_REPOSITORY) refuse("repository_mismatch", "producer.repository", PRODUCER_REPOSITORY, manifest!.producer?.repository, "");
  if (manifest!.producer?.commit !== pin.producer.producerCommit) refuse("commit_mismatch", "producer.producerCommit", pin.producer.producerCommit, manifest!.producer?.commit, ": admit the new producer release before deployment");
  if (manifest!.revision !== pin.revision) refuse("revision_mismatch", "revision", pin.revision, manifest!.revision, ": admit the new producer release before deployment");
  const files = manifest!.files!;
  const frame = Object.keys(files).sort().map((key) => {
    const entry = files[key];
    if (!entry || entry.path !== key || !/^[0-9a-f]{64}$/.test(entry.sha256)
      || !Number.isSafeInteger(entry.byteLength) || entry.byteLength < 0) refuse("invalid_manifest", `manifest.files[${key}]`, "valid file entry", entry, " file table");
    return `${entry.path}:${entry.sha256}:${String(entry.byteLength)}`;
  }).join("\n");
  const digest = sha256Hex(frame);
  if (`sha256:${digest}` !== pin.payloadDigest) refuse("digest_mismatch", "payloadDigest", pin.payloadDigest, `sha256:${digest}`, "");
  if (digest !== manifest!.payloadDigest) refuse("digest_mismatch", "manifest.payloadDigest (recomputed from file table)", digest, manifest!.payloadDigest, "");
  if (digest !== cached.payloadDigest) refuse("digest_mismatch", "cached manifest payloadDigest", cached.payloadDigest, digest, "");
}

/** The worker's `verifyProducerPayload` for one released file against the selected slot. */
function verifyPayload(name: string, bytes: Uint8Array, bundle: WorkerReleaseBundle, slot: WorkerSlot): void {
  const entry = bundle.manifest.files?.[name];
  const content = decodeUtf8(bytes);
  const encoded = new TextEncoder().encode(content);
  if (!entry || encoded.byteLength !== entry.byteLength || sha256Hex(encoded) !== entry.sha256) {
    throw new Refused({
      code: "corrupt_file", stage: "runtime", slot, field: `cached manifest files[${name}]`,
      expected: entry ? `sha256:${entry.sha256} (${entry.byteLength} bytes)` : "entry present",
      actual: `sha256:${sha256Hex(encoded)} (${encoded.byteLength} bytes)`,
      message: `governed-intake corrupt_file: ${name}`,
    });
  }
}

/**
 * Mirror of the worker's `resolveGovernedIntakeRuntime` (plus the `task.yml` read that
 * every create request performs), against the release the producer would publish.
 */
export function resolveWorkerAdmission(release: ProducerRelease, pins: WorkerConsumerPins): WorkerResolution {
  const published = pins.published;
  try {
    const pin = published.pin;
    if (pin?.schema !== "GovernedIntakeCurrentReleasePinV1" || pin.producer?.repository !== PRODUCER_REPOSITORY
      || pin.revision !== published.manifest.revision
      || pin.payloadDigest !== `sha256:${String(published.manifest.payloadDigest)}`) {
      throw new Refused({ code: "invalid_pin", stage: "runtime", slot: "published", field: "published pin vs cached manifest",
        expected: `revision ${show(published.manifest.revision)} sha256:${show(published.manifest.payloadDigest)}`,
        actual: `revision ${show(pin?.revision)} ${show(pin?.payloadDigest)}`, message: `governed-intake invalid_pin (${PRODUCER_REPOSITORY})` });
    }
    let live: unknown;
    try {
      live = JSON.parse(decodeUtf8(release.manifest));
    } catch (error) {
      throw new Refused({ code: "invalid_manifest", stage: "runtime", slot: "published", field: PRODUCER_MANIFEST_PATH, expected: "UTF-8 JSON", actual: String(error), message: `governed-intake invalid_manifest (${PRODUCER_REPOSITORY})` });
    }
    // A candidate is selected only when the published manifest's revision matches it;
    // a failed candidate never falls back to the published slot (worker semantics).
    const slot: WorkerSlot = pins.prepared && (live as ReleaseManifest | null)?.revision === pins.prepared.pin.revision ? "prepared" : "published";
    const bundle = slot === "prepared" ? pins.prepared! : published;
    verifyLiveManifest(live, bundle, slot);
    verifyPayload("governed-intake-body.v1.json", release.source, bundle, slot);
    const sourceBlobSha = gitBlobSha(release.source);
    if (sourceBlobSha !== bundle.pin.producer.sourceBlobSha) {
      throw new Refused({ code: "source_blob_mismatch", stage: "runtime", slot, field: "producer.sourceBlobSha", expected: bundle.pin.producer.sourceBlobSha, actual: sourceBlobSha, message: `governed-intake source blob mismatch (${PRODUCER_REPOSITORY})` });
    }
    verifyPayload("task.yml", release.taskForm, bundle, slot);
    const manifestBlobSha = gitBlobSha(release.manifest);
    if (manifestBlobSha !== bundle.pin.producer.releaseManifestBlobSha) {
      throw new Refused({ code: "manifest_blob_mismatch", stage: "admission", slot, field: "producer.releaseManifestBlobSha", expected: bundle.pin.producer.releaseManifestBlobSha, actual: manifestBlobSha, message: `governed-intake release manifest blob is not the admitted cache (${PRODUCER_REPOSITORY})` });
    }
    return { ok: true, slot, identity: {
      producerCommit: bundle.pin.producer.producerCommit, releaseCommit: bundle.pin.producer.releaseCommit,
      revision: bundle.pin.revision, payloadDigest: bundle.pin.payloadDigest, sourceBlobSha,
    } };
  } catch (error) {
    if (error instanceof Refused) return { ok: false, refusal: error.refusal };
    if (error instanceof TypeError) {
      return { ok: false, refusal: { code: "corrupt_file", stage: "runtime", slot: "published", field: "UTF-8", expected: "valid UTF-8", actual: String(error), message: "governed-intake corrupt_file: invalid UTF-8" } };
    }
    throw error;
  }
}

/** Text of one top-level function in the worker source, normalized for fingerprinting. */
export function extractWorkerFunction(source: string, name: string): string | null {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => new RegExp(`^(export )?(async )?function ${name}\\(`).test(line));
  if (start < 0) return null;
  const end = lines.findIndex((line, index) => index > start && line === "}");
  if (end < 0) return null;
  return lines.slice(start, end + 1).map((line) => line.trimEnd()).join("\n");
}

/** Mirrored functions whose current worker text differs from the vendored fingerprint. */
export function workerResolutionDrift(source: string): Array<{ function: string; expected: string; actual: string | null }> {
  return Object.entries(VENDORED_WORKER_RESOLUTION.functions).flatMap(([name, expected]) => {
    const text = extractWorkerFunction(source, name);
    const actual = text === null ? null : sha256Hex(text);
    return actual === expected ? [] : [{ function: name, expected, actual }];
  });
}
