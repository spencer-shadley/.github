/** Producer-owned semantic identities; no filesystem, network, clock, or model calls. */
import { createHash } from "node:crypto";
import policyJson from "./governed-intake-triage-policy.v1.json" with { type: "json" };
import contractJson from "./governed-intake-body.v1.json" with { type: "json" };
import { assertTriagePolicy, type BoundTriagePolicy, type TriagePolicy } from "./governed-intake-triage-policy.evaluate.ts";
import { normalizeLf, validateGovernedWorkUnitKey } from "./governed-intake-body.evaluate.ts";

/** Canonical JSON ignores object-key order, not array order or substantive values. */
export function canonicalPolicyJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalPolicyJson).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalPolicyJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  throw new TypeError("policy identity requires finite plain JSON");
}
const digest = (value: unknown): string => `sha256:${createHash("sha256").update(canonicalPolicyJson(value), "utf8").digest("hex")}`;

/** File-integrity SHA-256 remains in the release manifest; these are semantic identities. */
export function bindTriagePolicy(policy: TriagePolicy): BoundTriagePolicy {
  assertTriagePolicy(policy);
  const immutableInput = JSON.parse(canonicalPolicyJson(policy)) as TriagePolicy;
  return { policy: immutableInput, policyIdentity: digest(immutableInput), rubricIdentity: digest(immutableInput.effortRubric) };
}
export function boundTriagePolicyFromProducer(): BoundTriagePolicy {
  return bindTriagePolicy(policyJson as TriagePolicy);
}

export interface IssueScopeSource {
  repository: string;
  issueNumber: number;
  title: string;
  body: string;
}

/** Checklist checks and machine completion markers do not change the implementation scope. */
export function normalizeIssueScopeBody(body: string): string {
  const checklist = contractJson.triageChecklist;
  const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let text = normalizeLf(body);
  const block = new RegExp(`<!--\\s*${escape(checklist.sectionMarkerName)}:[\\s\\S]*?<!--\\s*\\/${escape(checklist.sectionMarkerName)}\\s*-->`, "g");
  text = text.replace(block, "");
  text = text.replace(new RegExp(`<!--\\s*${escape(checklist.completionMarkerName)}:[\\s\\S]*?-->`, "g"), "");
  text = text.replace(/^<!--\s*(?:Generated (?:against|from)|Intake form observed:)[^\n]*-->\s*$/gm, "");
  // Remove only an empty canonical checklist heading left by the delimited block.
  text = text.replace(new RegExp(`^##\\s+${escape(checklist.heading)}\\s*\\n(?=\\s*(?:## |$))`, "gm"), "");
  return text.trim();
}

/** Bind an assessment to the actual GitHub subject, not a caller-supplied matching pair. */
export function fingerprintIssueScope(source: IssueScopeSource): string {
  if (!/^[^/\s]+\/[^/\s]+$/.test(source.repository) || !Number.isSafeInteger(source.issueNumber) || source.issueNumber < 1 || !source.title.trim()) {
    throw new TypeError("invalid issue scope source identity");
  }
  const key = validateGovernedWorkUnitKey(source.body);
  if (!key.ok || !key.key) throw new TypeError(`invalid issue work-unit key:${key.reason}`);
  return digest({ repository: source.repository.toLowerCase(), issueNumber: source.issueNumber, title: source.title.trim(), workUnitKey: key.key, body: normalizeIssueScopeBody(source.body) });
}
