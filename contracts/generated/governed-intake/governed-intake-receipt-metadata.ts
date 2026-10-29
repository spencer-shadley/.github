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

/** The line cli-wrappers `agent-signature.ts` builds: `Signature: <who> [(<role>)] | key: value | …`.
 * `who` and `role` are each at most three plain words (the builder's names, harness sessions and
 * "unidentified agent"). The builder's undeclared marker "(identity undeclared)" is a role. At least one known
 * field follows, and each value is one token. Longer prose in any position is authored content.
 */
const SIGNATURE_WORDS = String.raw`[A-Za-z0-9._-]+(?: [A-Za-z0-9._-]+){0,2}`;
const STRUCTURED_SIGNATURE_LINE = new RegExp(
  String.raw`^Signature: ${SIGNATURE_WORDS}(?: \(${SIGNATURE_WORDS}\))?`
  + String.raw`(?: \| (?:model|effort|runner|provider|family|session|host|worktree|ver): [^|\s]+)+[ \t]*$`,
);
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;

/** Remove the trailing run of structured actor-signature paragraphs and the blank separator before each (.github#108).
 * Signing writers append them at the end of the text as bookkeeping. A signature followed by any other text,
 * a prose "Signature:" line, a line inside a code fence or a paragraph, and an unknown field stay authored
 * content. LF input only.
 */
export function stripTrailingActorSignatures(body: string): string {
  const lines = body.split("\n");
  const fenced: boolean[] = [];
  let fence: string | null = null;
  for (const line of lines) {
    const marker = FENCE_OPEN.exec(line)?.[1];
    fenced.push(fence !== null || marker !== undefined);
    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) fence = null;
    } else if (marker) {
      fence = marker;
    }
  }
  let end = lines.length;
  for (;;) {
    while (end > 0 && lines[end - 1].trim() === "") end -= 1;
    const last = end - 1;
    if (last < 0 || fenced[last] || !STRUCTURED_SIGNATURE_LINE.test(lines[last])) break;
    if (last > 0 && lines[last - 1].trim() !== "") break;
    end = last;
  }
  return end === lines.length ? body : lines.slice(0, end).join("\n");
}
