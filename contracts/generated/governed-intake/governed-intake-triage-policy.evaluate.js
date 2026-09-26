/**
 * Pure governed-intake policy constituent. No network, clock, model invocation or effects.
 *
 * TRUST BOUNDARY: adapters populate `trusted` ONLY from verified Model Router, Gateway,
 * shared-decomposition and custody evidence. Never deserialize it from issue prose or
 * accept a model-authored `eligible: true` as authoritative. This module checks binding
 * and coherence, not the authenticity of provider signatures or semantic atomicity.
 * Checklist parsing/revision/fingerprint validation remains the existing intake evaluator.
 */
                               
                 
                  
                                
                                                               
                                                                   
     
                       
                                  
                                       
                                                                           
                                                                    
 
/** Identity comes from the verified producer release, never from the issue body. */
                                    
                       
                         
                         
 
                          
                      
                           
                         
                         
 
                                 
                    
                   
                      
                  
                          
 
/** Normalized, verified by the adapter, not an issue-authored credential. */
                                                   
             
                                                                      
                              
                             
                    
                           
                           
                         
                                               
                                                                                          
                                
 
/** Graph validity is adjudicated by the existing Code shared core, not duplicated here. */
                                               
             
                           
                            
                 
                            
                                          
                                      
 
                                             
                                                     
                                
                                    
                    
                       
                       
                     
                               
                                  
                                        
                                                                                
                                       
                                                                                           
                                   
                             
                                 
                          
 
                                                 
                           
                            
                   
                                                                                        
                           
                                       
                                
                                         
                                   
                                                 
                                       
                                  
            
                                   
                           
                                                                                         
                           
                                 
                                    
                             
      
    
 
                                   
                   
                         
                       
                                                                                            
                                   
                             
                    
                                 
 

const subjectFields = ['workUnitKey', 'scopeFingerprint', 'policyIdentity', 'rubricIdentity']         ;
const identityFields = ['bindingId', 'provider', 'modelFamily', 'modelId', 'configurationId']         ;
const nonempty = (value         )                  => typeof value === 'string' && value.trim().length > 0;
const object = (value         )                                   => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const strings = (value         )                    => Array.isArray(value) && value.every(nonempty);
const unique =    (values              )      => [...new Set(values)];
function subjectMatches(receipt         , current         )          {
  return subjectFields.every(field => nonempty(receipt?.[field]) && receipt[field] === current[field]);
}
function exactIdentity(receipt                  )          {
  return identityFields.every(field => nonempty(receipt.selected?.[field])
    && receipt.selected[field] === receipt.served?.[field]);
}
function validSnapshot(snapshot         )                             {
  if (!object(snapshot) || !subjectFields.every(field => nonempty(snapshot[field]))) return false;
  if (snapshot.state !== 'open' && snapshot.state !== 'closed') return false;
  for (const field of ['repositoryActive', 'priorHighEffort', 'requiresQualifiedAssessment',
    'hasExecutableChildGraph', 'checklistCurrentAndComplete', 'directionEvidenceFresh']) {
    if (typeof snapshot[field] !== 'boolean') return false;
  }
  if (!strings(snapshot.labels)) return false;
  if (!(snapshot.assessment === null || object(snapshot.assessment))) return false;
  if (!(snapshot.currentGraphFingerprint === null || nonempty(snapshot.currentGraphFingerprint))) return false;
  if (!(snapshot.finalAttributesScopeFingerprint === null || nonempty(snapshot.finalAttributesScopeFingerprint))) return false;
  if (!object(snapshot.trusted) || !Array.isArray(snapshot.trusted.admissions) || !Array.isArray(snapshot.trusted.graphs)) return false;
  if (!snapshot.trusted.admissions.every(object) || !snapshot.trusted.graphs.every(object)) return false;
  const floors = snapshot.trusted.requiredCapabilities;
  return object(floors) && ['scope-assessment', 'atomic-confirmation', 'implementation'].every(key => nonempty(floors[key]));
}

/** Validate producer configuration once; never silently fall back to a private default. */
export function assertTriagePolicy(policy              )       {
  if (!object(policy) || policy.schema !== 'GovernedTriagePolicyV1'
    || !Number.isInteger(policy.version) || policy.version < 1) throw new Error('unsupported_triage_policy');
  if (!object(policy.dispositions) || Object.keys(policy.dispositions).sort().join(',') !== 'atomic-high,ordinary,parent') {
    throw new Error('invalid_disposition_contract');
  }
  const owned           = [];
  for (const disposition of Object.values(policy.dispositions)) {
    if (!object(disposition) || !strings(disposition.labels) || !disposition.labels.length
      || !strings(disposition.efforts) || !disposition.efforts.length
      || !disposition.efforts.every(effort => ['low', 'medium', 'high'].includes(effort))
      || (['trackingOnly', 'qualifiedAssessment', 'independentConfirmation']         ).some(key => typeof disposition[key] !== 'boolean')) {
      throw new Error('invalid_disposition_contract');
    }
    owned.push(...disposition.labels);
  }
  if (unique(owned).length !== owned.length || !nonempty(policy.pendingLabel)
    || !strings(policy.retiredProgressLabels) || !strings(policy.unsupportedTerminalAliases)
    || new Set([...owned, policy.pendingLabel, ...policy.retiredProgressLabels, ...policy.unsupportedTerminalAliases]).size
      !== owned.length + 1 + policy.retiredProgressLabels.length + policy.unsupportedTerminalAliases.length) {
    throw new Error('conflicting_policy_labels');
  }
  if (!object(policy.evidence) || !strings(policy.evidence.requiredAssessmentFields) || !strings(policy.evidence.atomicFields)
    || !object(policy.effortRubric) || !Number.isInteger(policy.effortRubric.version) || policy.effortRubric.version < 1
    || !object(policy.effortRubric.labels) || Object.keys(policy.effortRubric.labels).sort().join(',') !== 'high,low,medium'
    || Object.values(policy.effortRubric.labels).some(label => !nonempty(label))
    || unique(Object.values(policy.effortRubric.labels)).length !== 3) throw new Error('invalid_effort_rubric');
}

/** Hash semantic assessment content, excluding mutable receipt references and timestamps. */
export async function fingerprintAssessment(assessment            , graphFingerprint               )                  {
  const a = assessment                                      ;
  const fields = [...subjectFields, 'disposition', 'effort', 'rationale', 'verification', 'resumability',
    'invariant', 'difficultyRationale', 'alternativesConsidered', 'confidence']         ;
  const payload                          = {};
  for (const field of fields) payload[field] = typeof a[field] === 'string' ? a[field] : null;
  payload.blockingAssessmentUnknowns = strings(a.blockingAssessmentUnknowns) ? [...a.blockingAssessmentUnknowns].sort() : null;
  payload.implementationUnknowns = strings(a.implementationUnknowns) ? [...a.implementationUnknowns].sort() : null;
  payload.graphFingerprint = assessment.disposition === 'parent' ? graphFingerprint : null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload)));
  return `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

function qualified(
  snapshot                , id                    , role                          ,
  assessmentFingerprint        , reasons          ,
)                          {
  const matches = snapshot.trusted.admissions.filter(receipt => receipt.id === id);
  if (!nonempty(id) || matches.length !== 1) { reasons.push(`${role}:missing_or_duplicate_receipt`); return null; }
  const receipt = matches[0];
  if (!subjectMatches(receipt, snapshot) || receipt.role !== role
    || receipt.assessmentFingerprint !== assessmentFingerprint
    || !nonempty(receipt.routePolicyIdentity)
    || receipt.requiredCapability !== snapshot.trusted.requiredCapabilities[role]
    || receipt.admitted !== true || receipt.servingVerified !== true || !exactIdentity(receipt)
    || receipt.verdict !== 'agree') {
    reasons.push(`${role}:invalid_qualification_or_identity`);
    return null;
  }
  return receipt;
}

export async function evaluateTriagePolicy(release                   , input         )                            {
  const policy = release.policy;
  assertTriagePolicy(policy);
  if (!nonempty(release.policyIdentity) || !nonempty(release.rubricIdentity)) throw new Error('unbound_policy_release');
  if (!validSnapshot(input)) return {
    inScope: false, scopeResolved: false, needsTriage: true, implementationCandidate: false,
    disposition: null, reasons: ['malformed_policy_snapshot'], legacyLabelsToRemove: [],
  };
  const snapshot = input;
  const legacyLabelsToRemove = policy.retiredProgressLabels.filter(label => snapshot.labels.includes(label));
  if (snapshot.state !== 'open' || !snapshot.repositoryActive) return {
    inScope: false, scopeResolved: false, needsTriage: false, implementationCandidate: false,
    disposition: null, reasons: ['out_of_scope'], legacyLabelsToRemove,
  };
  const reasons           = [];
  const completionReasons           = [];
  const projectionReasons           = [];
  if (snapshot.policyIdentity !== release.policyIdentity || snapshot.rubricIdentity !== release.rubricIdentity) {
    reasons.push('unsupported_policy_or_rubric_identity');
  }
  const assessment = snapshot.assessment;
  const spec = assessment && Object.hasOwn(policy.dispositions, assessment.disposition)
    ? policy.dispositions[assessment.disposition] : null;
  if (!assessment || !spec) reasons.push('missing_or_unsupported_scope_disposition');
  const effortLabels = snapshot.labels.filter(label => Object.values(policy.effortRubric.labels).includes(label));
  if (effortLabels.length !== 1) projectionReasons.push('effort_not_exactly_one');
  if (snapshot.labels.some(label => policy.unsupportedTerminalAliases.includes(label))) projectionReasons.push('unsupported_decomposition_alias');

  if (assessment && spec) {
    if (!subjectMatches(assessment, snapshot) || !nonempty(assessment.assessmentFingerprint)) reasons.push('stale_scope_or_policy_evidence');
    if (assessment.assessmentFingerprint !== await fingerprintAssessment(assessment, snapshot.currentGraphFingerprint)) {
      reasons.push('assessment_content_fingerprint_mismatch');
    }
    if (!spec.efforts.includes(assessment.effort)) reasons.push('effort_disposition_mismatch');
    if (effortLabels[0] !== policy.effortRubric.labels[assessment.effort]) projectionReasons.push('effort_disposition_mismatch');
    const dispositionLabels = Object.values(policy.dispositions).flatMap(value => value.labels);
    const actual = snapshot.labels.filter(label => dispositionLabels.includes(label)).sort();
    if (actual.join('\n') !== [...spec.labels].sort().join('\n')) projectionReasons.push('conflicting_or_missing_disposition_labels');
    if (snapshot.labels.includes(policy.pendingLabel)) projectionReasons.push('unresolved_decomposition_obligation');
    for (const field of policy.evidence.requiredAssessmentFields) {
      if (!nonempty((assessment                                      )[field])) reasons.push(`missing_assessment_field:${field}`);
    }
    if (!['high', 'medium'].includes(assessment.confidence)
      || !strings(assessment.blockingAssessmentUnknowns) || assessment.blockingAssessmentUnknowns.length
      || !strings(assessment.implementationUnknowns)) reasons.push('unresolved_assessment_uncertainty');
    const needsQualified = spec.qualifiedAssessment || snapshot.priorHighEffort || snapshot.requiresQualifiedAssessment;
    const assessor = needsQualified
      ? qualified(snapshot, assessment.assessorReceiptId, 'scope-assessment', assessment.assessmentFingerprint, reasons) : null;
    if (spec.independentConfirmation) {
      for (const field of policy.evidence.atomicFields) {
        if (!nonempty((assessment                                      )[field])) reasons.push(`missing_atomic_field:${field}`);
      }
      const confirmer = qualified(snapshot, assessment.confirmationReceiptId, 'atomic-confirmation', assessment.assessmentFingerprint, reasons);
      if (assessor && confirmer && (assessor.id === confirmer.id
        || assessor.served.provider === confirmer.served.provider
        || assessor.served.modelFamily === confirmer.served.modelFamily)) reasons.push('atomic_confirmation_not_independent');
    }
    if (spec.trackingOnly) {
      const graphs = snapshot.trusted.graphs.filter(receipt => receipt.id === assessment.graphReceiptId);
      if (!nonempty(assessment.graphReceiptId) || graphs.length !== 1) reasons.push('missing_or_duplicate_graph_receipt');
      else {
        const graph = graphs[0];
        if (!subjectMatches(graph, snapshot) || !nonempty(graph.validatorIdentity)
          || !nonempty(graph.graphFingerprint) || graph.graphFingerprint !== snapshot.currentGraphFingerprint
          || graph.valid !== true || graph.coverageComplete !== true || graph.canonicalRelationshipsReadBack !== true
          || !snapshot.hasExecutableChildGraph) reasons.push('invalid_or_stale_graph_receipt');
        if (graph.requiredLeafTriageComplete !== true) completionReasons.push('required_leaf_triage_incomplete');
      }
    } else if (snapshot.hasExecutableChildGraph || snapshot.currentGraphFingerprint !== null) {
      reasons.push('leaf_contradicts_current_child_graph');
    }
  }
  // Scope resolution precedes final attributes/checklist. Never derive it from their presence.
  const scopeResolved = reasons.length === 0;
  reasons.push(...projectionReasons, ...completionReasons);
  if (snapshot.finalAttributesScopeFingerprint !== snapshot.scopeFingerprint) reasons.push('final_attributes_not_bound_to_current_scope');
  if (!snapshot.checklistCurrentAndComplete) reasons.push('current_checklist_incomplete');
  if (!snapshot.directionEvidenceFresh) reasons.push('direction_evidence_stale');
  return {
    inScope: true, scopeResolved, needsTriage: reasons.length > 0,
    implementationCandidate: reasons.length === 0 && spec?.trackingOnly === false,
    disposition: spec ? assessment .disposition : null,
    reasons: unique(reasons), legacyLabelsToRemove,
  };
}

/** A selection predicate, NOT mutation permission, a model invocation or a lease. */
export async function evaluateImplementationCandidate(
  release                   , snapshot         , implementationReceiptId         ,
)                                                    {
  const result = await evaluateTriagePolicy(release, snapshot);
  if (!result.implementationCandidate || !validSnapshot(snapshot)) {
    return { eligible: false, reasons: result.reasons.length ? result.reasons : ['tracking_parent_not_implementation_work'] };
  }
  const reasons           = [];
  if (snapshot.assessment .effort === 'high') {
    qualified(snapshot, implementationReceiptId, 'implementation', snapshot.assessment .assessmentFingerprint, reasons);
  }
  return { eligible: reasons.length === 0, reasons };
}

/** Cosmetic retirement only. It intentionally does not wait for legacy run expiry. */
export function planRetiredProgressLabelCleanup(policy              , labels                   )           {
  assertTriagePolicy(policy);
  return unique(labels.filter(label => policy.retiredProgressLabels.includes(label)));
}
