---
name: Feature / engineering leverage
about: Concise feature, leverage, risk-reduction, or discovery item for triage
labels: agent-review, priority:triage-tbd, work:untriaged
---

<!-- Generated from contracts/governed-intake-body.v1.json (GovernedIntakeBodyV1 version 19). Do not hand-edit; run: node --experimental-strip-types contracts/governed-intake-body.generate.ts -->

Machine and triage intake use the governed task body and checklist from this producer.
This feature chooser is not a second checklist, cadence schedule, or registry/shed form.

## Work type
<!-- Defect | Task | Risk reduction | Exploration / design research | Experiment / evidence test | Feature | Mixed -->

## Governed work-unit key
<!-- Derive SHA-256 from the normalized tuple `fixOwnerGitHubSlug + workType + canonicalWorkUnitIdentity`. Apply ECMAScript String.prototype.trim(), then String.prototype.normalize('NFC'), then the field-specific case rule. Apply locale-independent String.prototype.toLowerCase() to the normalized owner/repository GitHub slug. Apply locale-independent String.prototype.toLowerCase() to the normalized work type. Preserve the normalized UTF-8 bytes exactly after trim and NFC; do not lowercase, collapse internal whitespace, or rewrite punctuation. In identityTuple order, frame each normalized value as its UTF-8 byte length in unpadded ASCII decimal, then ASCII ':' (0x3a), then its exact UTF-8 bytes. Join the three framed values with ASCII LF (0x0a), with no trailing LF. SHA-256 hashes these serialized bytes; render the digest as 64 lowercase hexadecimal characters. Choose the smallest durable mechanism or outcome seam that names the work unit. Keep it unchanged when evidence, priority, wording, or comments change. The same key means the same work unit. If distinct semantics would map to one key, resolve the canonical identities before create; never add randomness, a UUID, or mutable evidence to escape the collision. Before governed create, replace the placeholder digest below and leave exactly one marker in the body. -->
<!-- governed-work-unit-key: sha256:<64 lowercase hex> -->

## What happened or what is needed?
<!-- The user-visible outcome, engineering time returned, harm reduced, or decision to unlock. -->

## Initial priority guess
<!-- P0 candidate | P1 | P2 | P3 | P4 | P5. Priority is an initial guess, not a self-assignment. -->

## Why this initial priority?
<!-- One short reason: current harm, urgency, expected value, or time saved. -->

## Relevant details
<!-- Optional evidence, links, impact. Do not attach a private shed, cadence, or fleet-registry checklist here. -->

## Human-decision state
<!-- No human decision required | Decision needed: <exact question for Spencer> -->
No human decision required
