/** Portable projection of the existing closed AO direction-receipt envelope.
 * This is bookkeeping recognition, never signature/freshness/completion proof.
 * Structural checks bind its work-unit key; semantic scope additionally supplies
 * the independently observed repository and issue identity.
 */
import contractJson from "./governed-intake-body.v1.json" with { type: "json" };
import { validateGovernedWorkUnitKey } from "./governed-intake-body.evaluate.ts";

export interface ReceiptSubjectIdentity { repository: string; issueNumber: number }

export function stripDirectionReceiptMetadata(body: string, identity?: ReceiptSubjectIdentity): string {
  if (identity && (!/^[^/\s]+\/[^/\s]+$/.test(identity.repository)
    || !Number.isSafeInteger(identity.issueNumber) || identity.issueNumber < 1)) return body;
  const key = validateGovernedWorkUnitKey(body);
  if (!key.ok || !key.key) return body;
  const fields = ["schema", "version", "repository", "issueNumber", "workUnitKey", "triageRevision", "directionCheckedAt", "evidenceFingerprint"].sort().join(",");
  return body.replace(/^<!-- triage-direction-receipt-v1 -->\n\n?```json\n([\s\S]*?)\n```(?=\n|$)/gm, (section, json: string) => {
    let receipt: Record<string, unknown>;
    try { receipt = JSON.parse(json); } catch { return section; }
    if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)
      || Object.keys(receipt).sort().join(",") !== fields || JSON.stringify(receipt, null, 2) !== json
      || receipt.schema !== "TriageDirectionReceiptV1" || receipt.version !== 1
      || typeof receipt.repository !== "string" || !/^[^/\s]+\/[^/\s]+$/.test(receipt.repository)
      || !Number.isSafeInteger(receipt.issueNumber) || Number(receipt.issueNumber) < 1
      || (identity && (receipt.repository.toLowerCase() !== identity.repository.toLowerCase() || receipt.issueNumber !== identity.issueNumber))
      || receipt.workUnitKey !== key.key
      || !Number.isSafeInteger(receipt.triageRevision) || Number(receipt.triageRevision) < 1 || Number(receipt.triageRevision) > contractJson.version
      || typeof receipt.directionCheckedAt !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(receipt.directionCheckedAt)
      || !Number.isFinite(Date.parse(receipt.directionCheckedAt))
      || typeof receipt.evidenceFingerprint !== "string" || !/^sha256:[0-9a-f]{64}$/.test(receipt.evidenceFingerprint)) return section;
    const normalizedTime = receipt.directionCheckedAt.replace(/(?:\.(\d{1,3}))?Z$/, (_match, fraction: string | undefined) => `.${(fraction ?? "").padEnd(3, "0")}Z`);
    if (new Date(receipt.directionCheckedAt).toISOString() !== normalizedTime) return section;
    return "";
  });
}
