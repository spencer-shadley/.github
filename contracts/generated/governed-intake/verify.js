/** Portable release admission, owned by spencer-shadley/.github (#13).
 * No model or GitHub effects. Verify against a separately admitted pin before use.
 */
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";

export const RELEASE_MANIFEST_SCHEMA = "GovernedIntakeReleaseManifestV1";
export const RELEASE_SCHEMA_FAMILY = "GovernedIntakeBodyV1";
export const RELEASE_PRODUCER = "spencer-shadley/.github";
export const REQUIRED_RELEASE_PAYLOADS = [
  "contract.json", "governed-intake-body.v1.json", "evaluator.ts", "evaluator.js",
  "governed-intake-body.evaluate.ts", "governed-intake-body.evaluate.js",
  "triage-evaluator.ts", "triage-evaluator.js",
  "governed-intake-triage-state.evaluate.ts", "governed-intake-triage-state.evaluate.js",
  "task.md", "task.yml", "feature.md", "feature.yml",
  "generator.ts", "generator.js", "verify.ts", "verify.js",
  "governed-intake-triage-policy.v1.json", "policy.json",
  "governed-intake-triage-policy.evaluate.ts", "governed-intake-triage-policy.evaluate.js",
  "policy-evaluator.ts", "policy-evaluator.js",
  "governed-intake-triage-state.migrate.ts", "governed-intake-triage-state.migrate.js",
  "delta-planner.ts", "delta-planner.js",
  "governed-intake-triage.compose.ts", "governed-intake-triage.compose.js",
  "compose.ts", "compose.js",
  "governed-intake-policy-binding.ts", "governed-intake-policy-binding.js",
  "policy-binding.ts", "policy-binding.js",
]         ;
                                                                                                  
                                             
                                            
                                       
                   
                                                   
                        
                                                        
                                                
  
                                    
                      
                              
                            
                          
                                 
  
                                        
                                      
                 
                   
                        
  
                                                                                                   
                                                                                       
                                                    
                                                                                       
                                                                                                  
const fullCommit = (value         )                  =>
  typeof value === "string" && /^[0-9a-f]{40}$/.test(value) && !/^0+$/.test(value);
const digest = (value         )                  => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const object = (value         )                                   =>
  value !== null && typeof value === "object" && !Array.isArray(value);
export const sha256 = (bytes                 )         => createHash("sha256").update(bytes).digest("hex");
export function computePayloadDigest(files                                                )         {
  return sha256(Object.keys(files).sort().map((key) => {
    const entry = files[key];
    return `${entry.path}:${entry.sha256}:${String(entry.byteLength)}`;
  }).join("\n"));
}
const fail = (code                        , error        )                      => ({ ok: false, code, error });

/** Structural/integrity check; use admitGovernedIntakeRelease for external identity admission. */
export function verifyGovernedIntakeRelease(
  releaseDirOrManifest                                        ,
  options                       = {},
)                      {
  let raw         ;
  const dir = typeof releaseDirOrManifest === "string" ? releaseDirOrManifest : options.releaseDir;
  try {
    if (typeof releaseDirOrManifest === "string") {
      const file = path.join(releaseDirOrManifest, "manifest.json");
      const stat = lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink()) return fail("invalid_manifest", "manifest must be a regular file");
      raw = JSON.parse(readFileSync(file, "utf8"));
    } else raw = releaseDirOrManifest;
  } catch (error) {
    return fail((error                         ).code === "ENOENT" ? "missing_manifest" : "invalid_manifest", String(error));
  }
  if (!object(raw)) return fail("invalid_manifest", "manifest must be an object");
  if (raw.schema !== RELEASE_MANIFEST_SCHEMA || raw.schemaFamily !== RELEASE_SCHEMA_FAMILY) {
    return fail("unsupported_schema", "unsupported governed-intake release schema or family");
  }
  if (!Number.isSafeInteger(raw.revision) || Number(raw.revision) < 1) return fail("invalid_manifest", "revision must be a positive safe integer");
  if (!object(raw.producer) || !fullCommit(raw.producer.commit)) return fail("invalid_manifest", "producer.commit must be a nonzero full lowercase commit SHA");
  if (raw.producer.repository !== RELEASE_PRODUCER || (options.expectedRepository !== undefined && raw.producer.repository !== options.expectedRepository)) {
    return fail("repository_mismatch", `producer.repository must be ${RELEASE_PRODUCER}`);
  }
  if (options.expectedRevision !== undefined && raw.revision !== options.expectedRevision) return fail("revision_mismatch", "release revision differs from admitted revision");
  if (options.expectedCommit !== undefined && raw.producer.commit !== options.expectedCommit) return fail("commit_mismatch", "producer commit differs from admitted commit");
  if (!digest(raw.payloadDigest) || !object(raw.files)) return fail("invalid_manifest", "invalid payload digest or file map");
  for (const name of REQUIRED_RELEASE_PAYLOADS) {
    if (!Object.hasOwn(raw.files, name)) return fail("invalid_manifest", `manifest missing required payload entry: ${name}`);
  }
  for (const [name, entry] of Object.entries(raw.files)) {
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(name) || !object(entry) || entry.path !== name
      || !digest(entry.sha256) || !Number.isSafeInteger(entry.byteLength) || Number(entry.byteLength) < 0) {
      return fail("invalid_manifest", `invalid payload path or metadata: ${name}`);
    }
  }
  const manifest = raw                                 ;
  if (computePayloadDigest(manifest.files) !== manifest.payloadDigest) return fail("digest_mismatch", "manifest payloadDigest does not match file metadata");
  if (options.expectedPayloadDigest !== undefined && manifest.payloadDigest !== options.expectedPayloadDigest) return fail("digest_mismatch", "payloadDigest differs from admitted digest");
  if (dir) {
    try {
      for (const [name, entry] of Object.entries(manifest.files)) {
        const file = path.join(dir, name);
        const stat = lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink()) return fail("corrupt_file", `payload must be a regular, non-symlink file: ${name}`);
        const bytes = readFileSync(file);
        if (bytes.length !== entry.byteLength || sha256(bytes) !== entry.sha256) return fail("corrupt_file", `payload digest or byteLength mismatch: ${name}`);
      }
      const alias = readFileSync(path.join(dir, "contract.json"));
      const canonical = readFileSync(path.join(dir, "governed-intake-body.v1.json"));
      if (!alias.equals(canonical)) return fail("corrupt_file", "contract aliases contain different bytes");
      const policyAlias = readFileSync(path.join(dir, "policy.json"));
      const policyCanonical = readFileSync(path.join(dir, "governed-intake-triage-policy.v1.json"));
      if (!policyAlias.equals(policyCanonical)) return fail("corrupt_file", "policy aliases contain different bytes");
      const contract          = JSON.parse(canonical.toString("utf8"));
      if (!object(contract) || contract.schema !== RELEASE_SCHEMA_FAMILY || contract.version !== manifest.revision || contract.owner !== RELEASE_PRODUCER) {
        return fail("corrupt_file", "contract schema, revision or owner differs from release identity");
      }
      const policy          = JSON.parse(policyCanonical.toString("utf8"));
      if (!object(policy) || policy.schema !== "GovernedTriagePolicyV1" || policy.owner !== RELEASE_PRODUCER) {
        return fail("corrupt_file", "policy schema or owner differs from producer identity");
      }
    } catch (error) {
      return fail((error                         ).code === "ENOENT" ? "missing_file" : "corrupt_file", String(error));
    }
  }
  return { ok: true, manifest };
}

/** Never derive this pin from the same untrusted manifest being admitted. */
export function admitGovernedIntakeRelease(dir        , pin                          )                      {
  if (!object(pin) || pin.repository !== RELEASE_PRODUCER || !fullCommit(pin.commit)
    || !Number.isSafeInteger(pin.revision) || pin.revision < 1 || !digest(pin.payloadDigest)) {
    return fail("invalid_pin", "a separately admitted repository/commit/revision/payloadDigest pin is required");
  }
  return verifyGovernedIntakeRelease(dir, {
    expectedRepository: pin.repository, expectedCommit: pin.commit,
    expectedRevision: pin.revision, expectedPayloadDigest: pin.payloadDigest,
  });
}

export function loadGovernedIntakeRelease(dir        , options                       = {}) {
  const result = verifyGovernedIntakeRelease(dir, options);
  if (!result.ok) throw new Error(`governed-intake release: ${result.code}: ${result.error}`);
  return {
    manifest: result.manifest,
    contract: JSON.parse(readFileSync(path.join(dir, "contract.json"), "utf8")),
    evaluatorSource: readFileSync(path.join(dir, "evaluator.ts"), "utf8"),
    triageEvaluatorSource: readFileSync(path.join(dir, "triage-evaluator.ts"), "utf8"),
    templateMarkdown: readFileSync(path.join(dir, "task.md"), "utf8"),
    releaseDir: dir,
  };
}
