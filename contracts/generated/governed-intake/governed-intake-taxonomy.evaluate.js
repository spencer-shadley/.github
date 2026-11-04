/** Producer-owned revision-23 taxonomy completion. Pure validation, never effects.
 * Vocabulary/cardinalities are adopted in the body contract from the accepted
 * Code work-spine contract; consumers execute this released validator.
 * Adapters authenticate timeline, acceptance, reference and decision observations.
 */
import contract from "./governed-intake-body.v1.json" with { type: "json" };

                                      
                     
                      
                           
                                                                              
                                                                               
     
                      
                                                                                 
                            
 

                                   
                      
                           
                   
                      
                               
                                                                
                                                                          
                                                                                
                                 
                                                                                                                                      
 

                     
                   
                             
                   
                              
                         
                            
                            
                               
 
const nonempty = (value         )                  => typeof value === "string" && value.trim().length > 0;
const issueReference = (value         )                  => typeof value === "string"
  && /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/(?:issues|pull)\/[1-9][0-9]*$/.test(value);
const receiptReference = (value         )                  => typeof value === "string"
  && /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/(?:issues|pull)\/[1-9][0-9]*(?:#[a-zA-Z0-9_-]+)?$/.test(value);

export function evaluateTaxonomy(input   
                            
                                                        
                           
                             
                           
                                    
                              
 )           {
  const spec = contract.triageChecklist.taxonomy;
  const reasons           = [];
  const observed = input.observation;
  const evidence = input.evidence;
  if (!observed || !input.subject || !nonempty(observed.lifecycleId)
    || !["open", "closed"].includes(observed.state)
    || typeof observed.repository !== "string"
    || observed.repository.toLowerCase() !== input.subject.repository.toLowerCase()
    || observed.issueNumber !== input.subject.issueNumber || observed.state !== input.state) {
    reasons.push("taxonomy_observation_missing_or_subject_mismatch");
  }
  if (!evidence || evidence.workUnitKey !== input.workUnitKey
    || evidence.scopeFingerprint !== input.scopeFingerprint || evidence.revision !== contract.version
    || !nonempty(evidence.lifecycleId) || evidence.lifecycleId !== observed?.lifecycleId) {
    reasons.push("taxonomy_evidence_missing_or_stale");
  }
  // Validate even unsupported spellings inside a known dimension; a valid sibling
  // must never hide an unknown value or conflicting second value.
  for (const [name, dimension] of Object.entries(spec.dimensions)                         ) {
    const labels = input.labels.filter(label => label.startsWith(`${name}:`));
    if (labels.some(label => !dimension.labels.includes(label)
      && !(dimension.dynamicPatterns ?? []).some(pattern => new RegExp(pattern).test(label)))) {
      reasons.push(`taxonomy_${name}_unsupported_label`);
    }
    const minimum = name === "resolution"
      ? (observed?.state === "closed" ? dimension.minimumWhenResolved  : dimension.minimumWhileOpen )
      : dimension.minimumAfterTriage ?? dimension.minimum ?? 0;
    const maximum = name === "resolution" && observed?.state !== "closed"
      ? dimension.maximumWhileOpen  : dimension.maximum;
    if (labels.length < minimum || (maximum !== null && labels.length > maximum)
      || new Set(labels).size !== labels.length) reasons.push(`taxonomy_${name}_cardinality`);
  }
  if (input.labels.includes("type:proposal") && !input.labels.some(label => label.startsWith("type:") && label !== "type:proposal")) {
    reasons.push("taxonomy_proposal_requires_primary_type");
  }
  if (input.labels.includes("type:regression") && !receiptReference(evidence?.regressionReference)) {
    reasons.push("taxonomy_regression_reference_required");
  }
  if (evidence?.researchConclusion !== undefined && (!input.labels.includes("type:research")
    || !["positive", "negative", "inconclusive"].includes(evidence.researchConclusion))) {
    reasons.push("taxonomy_research_conclusion_invalid");
  }
  if (observed?.state === "closed" && input.labels.includes("type:research") && !evidence?.researchConclusion) {
    reasons.push("taxonomy_research_conclusion_required");
  }
  if (input.labels.includes("resolution:delivered") && !input.labels.includes(spec.deliveredProgress)) {
    reasons.push("taxonomy_delivered_requires_verified_progress");
  }
  if (input.labels.includes(spec.deliveredProgress)) {
    const acceptance = evidence?.acceptance;
    if (!acceptance || acceptance.verified !== true || !/^(?!0{40}$)[0-9a-f]{40}$/.test(acceptance.headSha)
      || !receiptReference(acceptance.receiptUrl)) reasons.push("taxonomy_verified_acceptance_required");
  }
  if (observed?.state === "closed" && !input.labels.includes("resolution:delivered")
    && (!nonempty(observed.previousProgress) || !input.labels.includes(observed.previousProgress)
      || !spec.dimensions.progress.labels.includes(observed.previousProgress))) {
    reasons.push("taxonomy_non_delivery_progress_changed_or_unknown");
  }
  if (input.labels.includes("resolution:superseded") && !issueReference(evidence?.supersededDestination)) {
    reasons.push("taxonomy_superseded_destination_required");
  }
  if (input.labels.includes("resolution:obsolete")) {
    const decision = evidence?.obsoleteDecision;
    const decisionReference = (value         ) => typeof value === "string" && issueReference(decision?.causingIssue)
      && value.startsWith(`${decision.causingIssue}#issuecomment-`) && /#issuecomment-[1-9][0-9]*$/.test(value);
    if (!decision || decision.accepted !== true || decision.noRemainingValue !== true
      || !decisionReference(decision.decisionUrl) || !decisionReference(decision.backlinkUrl)) {
      reasons.push("taxonomy_obsolete_decision_required");
    }
  }
  const blockers = input.labels.filter(label => label.startsWith("blocked:"));
  const records = evidence?.blockers ?? [];
  if (!Array.isArray(records) || records.length !== blockers.length
    || new Set(records.map(record => record?.label)).size !== records.length
    || records.some(record => !record || !blockers.includes(record.label) || !nonempty(record.releasePredicate)
      || (record.label === "blocked:human-required" && !nonempty(record.humanInput)))) {
    reasons.push("taxonomy_blocker_evidence_required");
  }
  return [...new Set(reasons)];
}

/** Delivery is a separate result from triage. The independent evidence adapter
 * (Code#9381) reads and authenticates these records under the existing review
 * policy; this pure producer checks their current obligation/consumer binding.
 * Neither this shape nor a caller-authored `verified` flag authenticates a record.
 */
                                            
                     
                      
                      
                           
                      
 

                                                  
                                                    
                 
 

                                             
             
               
                     
                                                                                                                 
                                                 
 

                                               
             
                          
                
                                                                          
                                                         
                                                                            
                                      
                                                 
                                                                            
                                                                                                            
                                          
 

                                          
                                              
                                
                                                 
                                                                              
                                              
 

                                         
             
                          
                
                                                                             
                                                               
                                                 
                                                         
                                                                                  
                                              
                                                                              
                             
 

                                         
                                         
                                     
                             
                                
                                                    
                                  
                                                           
                           
                      
 

                                                
                                                    
                                     
                          
                                                  
                                                                                    
                                                  
          
               
                               
                                                                 
                                                                                
                                                                                                      
                                                                     
      
 

                                           
                                 
                         
                          
                    
                                                                                                           
 

const record = (value         )                                   => value !== null
  && typeof value === "object" && !Array.isArray(value);
const referenceIdentity = (value         )          => record(value)
  && nonempty(value.reference) && nonempty(value.identity);

/** Extend the existing taxonomy owner for explicit delivery admission. Legacy
 * evaluateTaxonomy remains the triage/lifecycle compatibility surface; its coarse
 * acceptance field is deliberately not evidence for this delivery result. This
 * lower-level check assumes a fresh producer-composed tree; arbitrary shaped
 * caller data is not authenticated. Effect consumers use the public fresh
 * composition entrypoint with actual Code#9381 observations and their own
 * existing authority/readback checks, never this result alone.
 */
export function evaluateDeliveryAcceptance(
  tree                        ,
  observation                                ,
)                           {
  const reasons = [...tree.pendingReasons];
  const observed = observation           ;
  const subject = record(observed) && record(observed.subject) ? observed.subject : null;
  const bound = record(observed) && observed.schema === "GovernedDeliveryAcceptanceObservationV1"
    && subject !== null
    && Object.entries(tree.subject).every(([key, value]) => subject[key] === value)
    && observed.treeFingerprint === tree.fingerprint && observed.coverage === "complete"
    && referenceIdentity(observed.record) && Array.isArray(observed.items);
  if (!bound) reasons.push("delivery_observation_missing_incomplete_or_stale");
  const facts = bound ? observed.items              : [];
  const ids = facts.map(value => record(value) ? value.id : undefined);
  if (new Set(ids).size !== ids.length || ids.some(id => !tree.nodes.some(node => node.id === id))) {
    reasons.push("delivery_observation_duplicate_or_unknown_id");
  }
  const items = tree.nodes.map(node => {
    const errors           = [];
    const matching = facts.filter(value => record(value) && value.id === node.id);
    const fact = matching[0];
    if (matching.length !== 1 || !record(fact) || fact.meaningFingerprint !== node.meaningFingerprint) {
      errors.push("delivery_item_observation_missing_or_meaning_changed");
    }
    if (node.applicability.status === "unknown") errors.push("delivery_applicability_unknown");
    const verifier = record(fact) ? fact.verifier : undefined;
    if (!referenceIdentity(verifier) || !record(verifier) || !nonempty(verifier.actor)) {
      errors.push("delivery_independent_verification_record_missing");
    }
    const evidence = record(fact) && Array.isArray(fact.evidence) ? fact.evidence : [];
    if (evidence.length === 0 || evidence.some(value => !record(value)
      || value.kind !== node.evidenceKind || !referenceIdentity(value))) {
      errors.push("delivery_required_evidence_missing_or_wrong_kind");
    }
    const expected = node.applicability.status === "not-applicable" ? "not-applicable" : "verified";
    const result = record(fact) ? fact.result : undefined;
    if (result !== expected) errors.push("delivery_item_unverified");
    const status                                                      = errors.length === 0 ? expected : result === "failed" ? "failed" : "pending";
    return { id: node.id, status, reasons: errors };
  });
  if (!tree.nodes.some(node => node.applicability.status === "required")) reasons.push("delivery_no_applicable_obligations");
  if (items.some(item => item.status === "pending" || item.status === "failed")) reasons.push("delivery_obligations_unmet");
  return { status: reasons.length === 0 ? "verified" : "pending", effectAuthority: false, treeFingerprint: tree.fingerprint,
    reasons: [...new Set(reasons)], items };
}
