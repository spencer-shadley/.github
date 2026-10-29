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

/** `Signature: <actor> | model: … | …` (cli-wrappers `agent-signature.ts`): the actor, then at least one
 * known `| key: value` field the signature builder emits. Each value is one token, so prose cannot ride a field. */
const STRUCTURED_SIGNATURE_LINE =
  /^Signature:[ \t]*[^|\n]*[^|\s][^|\n]*(?:[ \t]*\|[ \t]*(?:model|effort|runner|provider|family|session|host|worktree|ver):[ \t]*[^|\s]+)+[ \t]*$/i;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;

/** Remove structured actor-signature paragraphs, and the blank separator a signer adds before each (.github#108).
 * Signing writers append them as bookkeeping. A prose "Signature:" line, a line inside a code fence, a line
 * inside a paragraph, and a signature with unknown fields stay authored content. LF input only.
 */
export function stripActorSignatureMetadata(body: string): string {
  const lines = body.split("\n");
  const out: string[] = [];
  let fence: string | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const marker = FENCE_OPEN.exec(line)?.[1];
    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) fence = null;
      out.push(line);
      continue;
    }
    if (marker) {
      fence = marker;
      out.push(line);
      continue;
    }
    const previousBlank = index === 0 || lines[index - 1].trim() === "";
    const nextBlank = index === lines.length - 1 || lines[index + 1].trim() === "";
    if (previousBlank && nextBlank && STRUCTURED_SIGNATURE_LINE.test(line)) {
      if (out.length > 0 && out[out.length - 1].trim() === "") out.pop();
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}
