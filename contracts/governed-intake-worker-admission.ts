/** Producer-current release resolution with advisory consumer drift (code#8212, code#7736).
 * Historical worker fingerprints and consumer snapshots are diagnostic evidence only.
 * Admission uses the producer manifest; consumer pins never select release identity.
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
  commit: "3b2495a79ec7857922337f8b1e20f0a89c0049c9",
  blobSha: "289332c58c526e95dcfe3a00827cf0233f4ec3ba",
  /** Every worker function the resolution path runs, helpers included (.github#57 review). */
  functions: {
    requireString: "9e1c4f5927bdb40a4f1de4c56ff5d5ce86339be2f22cf53a6271fb0aac88c8d9",
    sha256Utf8: "ea4476dec1b3d1a989ce48ef38925bfbadfde1e9dbc043757bb9cb424652a5f0",
    decodeProducerContent: "21a9ece172e0daf76f53feffff553da039f451e9208d322eedb057ab34e2be22",
    verifyProducerPayload: "8fc590015083635920b514371ff8b826ffb2691fd76069a6e21c61295ad67fb4",
    verifyLiveManifest: "d012432ffe78317dc43659d79696b4fdd992308f3f2d1a4f539122302b0b0d9a",
    selectAdmittedRelease: "24b80ca992aad9e6a9265954ffb8c46ab7962fe79c47787f941780fca6c59b12",
    resolveGovernedIntakeRuntime: "39f46204eb3922329d693726893983ee12e37a367d42d1df025d8ea730f6313e",
  },
  /** Module constants those functions compare against, fingerprinted by their declaration line. */
  declarations: {
    PRODUCER_REPOSITORY: "4a7a284d07c0a100f7bbeadd4cf64bc12d992b9af46b043571eff59fc96f5f07",
    PRODUCER_SOURCE_PATH: "ed7f389e5d71a2dbe159cf9faab5497e3778fa3c9043a04cc0726d8c00e74f7c",
  },
} as const;
export type VendoredWorkerResolution = { functions: Readonly<Record<string, string>>; declarations: Readonly<Record<string, string>> };

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
export type ProducerRelease = { manifest: Uint8Array; source: Uint8Array; taskForm: Uint8Array; commit?: string };

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
  | { ok: true; slot: WorkerSlot; identity: { producerCommit: string; releaseCommit: string; revision: number; payloadDigest: string; sourceBlobSha: string }; warnings: WorkerRefusal[] }
  | { ok: false; refusal: WorkerRefusal };

export const sha256Hex = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");
/** Git blob object id (what the GitHub contents API returns as `sha`). */
export function gitBlobSha(bytes: Uint8Array): string {
  return createHash("sha1").update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex");
}
const decodeUtf8 = (bytes: Uint8Array): string => new TextDecoder("utf-8", { fatal: true }).decode(bytes);
const show = (value: unknown): string => (typeof value === "string" ? value : JSON.stringify(value) ?? "undefined");

/** Legacy slot names identify the consumer file in diagnostics, never admission authority. */
export function selectAdmittedSlot(liveManifest: unknown, pins: WorkerConsumerPins): WorkerSlot {
  const live = liveManifest as ReleaseManifest | null;
  return pins.prepared && live?.revision === pins.prepared.pin?.revision ? "prepared" : "published";
}

/** Resolve the current producer identity and report every consumer comparison as a warning. */
export function resolveWorkerAdmission(release: ProducerRelease, pins: WorkerConsumerPins): WorkerResolution {
  const warnings: WorkerRefusal[] = [];
  let slot: WorkerSlot = "published";
  const finding = (code: WorkerRefusalCode, field: string, expected: unknown, actual: unknown): WorkerRefusal => ({
    code, stage: "runtime", slot, field, expected: show(expected), actual: show(actual),
    message: `governed-intake ${code}`,
  });
  let live: ReleaseManifest;
  try { live = JSON.parse(decodeUtf8(release.manifest)); }
  catch (error) { return { ok: false, refusal: finding("invalid_manifest", PRODUCER_MANIFEST_PATH, "UTF-8 JSON", String(error)) }; }
  if (!live || live.schema !== "GovernedIntakeReleaseManifestV1" || live.schemaFamily !== "GovernedIntakeBodyV1"
    || !live.files || !Number.isSafeInteger(live.revision) || typeof live.producer?.commit !== "string") {
    return { ok: false, refusal: finding("invalid_manifest", PRODUCER_MANIFEST_PATH, "valid producer manifest", live) };
  }
  if (live.producer.repository !== PRODUCER_REPOSITORY) {
    return { ok: false, refusal: finding("repository_mismatch", "producer.repository", PRODUCER_REPOSITORY, live.producer.repository) };
  }
  const entries = Object.entries(live.files);
  for (const [name, entry] of entries) {
    if (!entry || entry.path !== name || !/^[0-9a-f]{64}$/.test(entry.sha256)
      || !Number.isSafeInteger(entry.byteLength) || entry.byteLength < 0) {
      return { ok: false, refusal: finding("invalid_manifest", `manifest.files[${name}]`, "valid file entry", entry) };
    }
  }
  const digest = sha256Hex(entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([, entry]) => `${entry.path}:${entry.sha256}:${entry.byteLength}`).join("\n"));
  if (digest !== live.payloadDigest) return { ok: false, refusal: finding("digest_mismatch", "manifest.payloadDigest", digest, live.payloadDigest) };
  for (const [name, bytes] of [["governed-intake-body.v1.json", release.source], ["task.yml", release.taskForm]] as const) {
    const entry = live.files[name];
    if (!entry || bytes.byteLength !== entry.byteLength || sha256Hex(bytes) !== entry.sha256) {
      return { ok: false, refusal: finding("corrupt_file", `manifest.files[${name}]`, entry ?? "entry present",
        `sha256:${sha256Hex(bytes)} (${bytes.byteLength} bytes)`) };
    }
  }
  slot = selectAdmittedSlot(live, pins);
  const bundle = slot === "prepared" ? pins.prepared! : pins.published;
  const compare = (code: WorkerRefusalCode, field: string, pinned: unknown, current: unknown) => {
    if (pinned !== current) warnings.push(finding(code, field, pinned, current));
  };
  compare("invalid_pin", "schema", bundle.pin?.schema, "GovernedIntakeCurrentReleasePinV1");
  compare("repository_mismatch", "producer.repository", bundle.pin?.producer?.repository, live.producer.repository);
  compare("commit_mismatch", "producer.producerCommit", bundle.pin?.producer?.producerCommit, live.producer.commit);
  compare("revision_mismatch", "revision", bundle.pin?.revision, live.revision);
  compare("digest_mismatch", "payloadDigest", bundle.pin?.payloadDigest, `sha256:${digest}`);
  compare("digest_mismatch", "cached manifest payloadDigest", bundle.manifest?.payloadDigest, digest);
  const sourceBlobSha = gitBlobSha(release.source);
  compare("source_blob_mismatch", "producer.sourceBlobSha", bundle.pin?.producer?.sourceBlobSha, sourceBlobSha);
  compare("manifest_blob_mismatch", "producer.releaseManifestBlobSha", bundle.pin?.producer?.releaseManifestBlobSha, gitBlobSha(release.manifest));
  return { ok: true, slot, warnings, identity: {
    producerCommit: live.producer.commit, releaseCommit: release.commit ?? live.producer.commit,
    revision: live.revision as number, payloadDigest: `sha256:${digest}`, sourceBlobSha,
  } };
}

/** Text of one top-level function in the worker source, normalized for fingerprinting. */
export function extractWorkerFunction(source: string, name: string): string | null {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => new RegExp(`^(export )?(async )?function ${name}[(<]`).test(line));
  if (start < 0) return null;
  const end = lines.findIndex((line, index) => index > start && line === "}");
  if (end < 0) return null;
  return lines.slice(start, end + 1).map((line) => line.trimEnd()).join("\n");
}

/** One top-level `const NAME` declaration line in the worker source, normalized for fingerprinting. */
export function extractWorkerDeclaration(source: string, name: string): string | null {
  const line = source.replace(/\r\n/g, "\n").split("\n").find((candidate) => new RegExp(`^(export )?const ${name}\\b`).test(candidate));
  return line === undefined ? null : line.trimEnd();
}

/** Every fingerprint in `VENDORED_WORKER_RESOLUTION.functions` and `.declarations` as a source would produce it. */
export function fingerprintWorkerSource(source: string, names: VendoredWorkerResolution = VENDORED_WORKER_RESOLUTION): VendoredWorkerResolution {
  const hash = (text: string | null) => (text === null ? "missing" : sha256Hex(text));
  return {
    functions: Object.fromEntries(Object.keys(names.functions).map((name) => [name, hash(extractWorkerFunction(source, name))])),
    declarations: Object.fromEntries(Object.keys(names.declarations).map((name) => [name, hash(extractWorkerDeclaration(source, name))])),
  };
}

/** Mirrored functions and constants whose current worker text differs from the vendored fingerprint. */
export function workerResolutionDrift(source: string, vendored: VendoredWorkerResolution = VENDORED_WORKER_RESOLUTION): Array<{ function: string; expected: string; actual: string | null }> {
  const drift = (extract: (name: string) => string | null, table: Readonly<Record<string, string>>) => Object.entries(table).flatMap(([name, expected]) => {
    const text = extract(name);
    const actual = text === null ? null : sha256Hex(text);
    return actual === expected ? [] : [{ function: name, expected, actual }];
  });
  return [
    ...drift((name) => extractWorkerFunction(source, name), vendored.functions),
    ...drift((name) => extractWorkerDeclaration(source, name), vendored.declarations),
  ];
}
