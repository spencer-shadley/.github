/**
 * Pure TaskProfileV1 evaluator. No network, clock, model invocation or effects.
 *
 * TaskProfileV1 is semantic task truth, not execution policy: it never records or infers a
 * model, provider, effort setting, harness or benchmark. See spencer-shadley/code#6458 for the
 * design record; this file is the producer-owned implementation under spencer-shadley/.github#13.
 */
                                                                                      
                                      
                 
                               
                
                                    
                                                                                              
                                                                        
                                                      
                    
                      
                                           
                       
                              
    
                            
                                                                 
                                      
 

                                                                                                
export const TASK_PROFILE_CATEGORY_IDS                                   =
  ['implement', 'diagnose', 'design', 'review', 'judgment'];

                              
                        
                                                
                                        
                    
 

/** Identity comes from the verified producer release, never from issue prose. */
                                           
                                
                           
 

const nonempty = (value         )                  => typeof value === 'string' && value.trim().length > 0;
const object = (value         )                                   => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const unique =    (values              )      => [...new Set(values)];

/** Validate producer configuration once; never silently fall back to a private default. */
export function assertTaskProfileContract(contract                     )       {
  if (!object(contract) || contract.schema !== 'GovernedTaskProfileContractV1'
    || contract.profileSchemaVersion !== 'task-profile.v1') throw new Error('unsupported_task_profile_contract');
  if (!Array.isArray(contract.categories) || contract.categories.length !== 5
    || contract.categories.map(c => c.id).sort().join(',') !== [...TASK_PROFILE_CATEGORY_IDS].sort().join(',')) {
    throw new Error('invalid_task_profile_categories');
  }
  const scoring = contract.scoring;
  if (!object(scoring) || scoring.totalPoints !== 10 || scoring.minScore !== 0 || scoring.maxScore !== 10 || scoring.integersOnly !== true) {
    throw new Error('invalid_task_profile_scoring');
  }
  if (!object(contract.confidence) || !Array.isArray(contract.confidence.levels)
    || contract.confidence.levels.join(',') !== 'high,medium,low') throw new Error('invalid_task_profile_confidence');
  if (!object(contract.rationale) || contract.rationale.required !== true
    || !Number.isInteger(contract.rationale.maxLength) || contract.rationale.maxLength <= 0) throw new Error('invalid_task_profile_rationale_contract');
  const projection = contract.labelProjection;
  if (!object(projection) || !Number.isInteger(projection.threshold) || projection.threshold < 1 || projection.threshold > 10
    || !object(projection.categoryLabels)
    || Object.keys(projection.categoryLabels).sort().join(',') !== [...TASK_PROFILE_CATEGORY_IDS].sort().join(',')
    || !nonempty(projection.mixedLabel) || !Number.isInteger(projection.maxCategoryLabels) || projection.maxCategoryLabels < 1) {
    throw new Error('invalid_task_profile_label_projection');
  }
  const labels = [...Object.values(projection.categoryLabels), projection.mixedLabel];
  if (unique(labels).length !== labels.length) throw new Error('conflicting_task_profile_labels');
}

/** Deterministic canonical-JSON identity so a rubric/checklist revision bump is not required. */
export async function bindTaskProfileContract(contract                     )                                    {
  assertTaskProfileContract(contract);
  const canonical = canonicalJson(contract                                      );
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  const contractIdentity = `sha256:${Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')}`;
  return { contract, contractIdentity };
}

function canonicalJson(value         )         {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

                                   
                                      
                                     

/** Rejects model/provider/benchmark/effort/harness fields; accepts only the five-category vector. */
export function validateTaskProfile(bound                          , value         )                        {
  assertTaskProfileContract(bound.contract);
  const reasons           = [];
  if (!object(value)) return { ok: false, reasons: ['unsupported_profile_schema'] };
  if (value.schemaVersion !== bound.contract.profileSchemaVersion) reasons.push('unsupported_profile_schema');
  const scoresField = value.scores;
  if (!object(scoresField)) {
    reasons.push('unsupported_profile_schema');
    return { ok: false, reasons: unique(reasons) };
  }
  for (const key of Object.keys(scoresField)) {
    if (!TASK_PROFILE_CATEGORY_IDS.includes(key                         )) reasons.push(`unknown_profile_field:${key}`);
  }
  const scores = {}                                         ;
  let total = 0;
  for (const id of TASK_PROFILE_CATEGORY_IDS) {
    const raw = scoresField[id];
    if (typeof raw !== 'number' || !Number.isInteger(raw)) { reasons.push(`non_integer_score:${id}`); continue; }
    if (raw < bound.contract.scoring.minScore || raw > bound.contract.scoring.maxScore) { reasons.push(`score_out_of_range:${id}`); continue; }
    scores[id] = raw;
    total += raw;
  }
  for (const forbidden of bound.contract.forbiddenFields ?? []) {
    if (Object.hasOwn(value, forbidden)) reasons.push(`unknown_profile_field:${forbidden}`);
  }
  if (Object.keys(scores).length === TASK_PROFILE_CATEGORY_IDS.length && total !== bound.contract.scoring.totalPoints) {
    reasons.push('score_total_not_10');
  }
  if (!['high', 'medium', 'low'].includes(value.confidence          )) reasons.push('invalid_confidence');
  if (!nonempty(value.rationale) || (value.rationale          ).length > bound.contract.rationale.maxLength) {
    reasons.push('missing_or_oversized_rationale');
  }
  if (reasons.length > 0) return { ok: false, reasons: unique(reasons) };
  // Canonical key order: TASK_PROFILE_CATEGORY_IDS, never the caller-supplied object order.
  const orderedScores = {}                                         ;
  for (const id of TASK_PROFILE_CATEGORY_IDS) orderedScores[id] = scores[id];
  return {
    ok: true,
    profile: {
      schemaVersion: bound.contract.profileSchemaVersion,
      scores: orderedScores,
      confidence: value.confidence                             ,
      rationale: value.rationale          ,
    },
  };
}

/** Score >= threshold (default 4) projects a category label; none qualifying => exactly task:mixed. */
export function deriveTaskLabels(bound                          , profile             )           {
  assertTaskProfileContract(bound.contract);
  const projection = bound.contract.labelProjection;
  const qualifying = TASK_PROFILE_CATEGORY_IDS.filter(id => profile.scores[id] >= projection.threshold);
  if (qualifying.length === 0) return [projection.mixedLabel];
  return qualifying.map(id => projection.categoryLabels[id]);
}

                                                
                     
                  
                     
                    
 

/** Labels are a derived projection; a label present without a bound profile is never trusted. */
export function evaluateTaskLabelProjection(
  bound                          , profile                    , currentLabels                   ,
)                                {
  assertTaskProfileContract(bound.contract);
  const projection = bound.contract.labelProjection;
  const allProjected = [...Object.values(projection.categoryLabels), projection.mixedLabel];
  const currentProjected = currentLabels.filter(label => allProjected.includes(label));
  if (!profile) {
    if (currentProjected.length === 0) return { expected: [], toAdd: [], toRemove: [], reasons: [] };
    return { expected: [], toAdd: [], toRemove: unique(currentProjected), reasons: ['task_labels_without_profile'] };
  }
  const expected = deriveTaskLabels(bound, profile);
  if (expected.length > projection.maxCategoryLabels && expected[0] !== projection.mixedLabel) {
    // Structurally unreachable given a 10-point budget and threshold >= totalPoints/3, but fail closed.
    return { expected, toAdd: [], toRemove: currentProjected, reasons: ['task_label_projection_exceeds_maximum'] };
  }
  const toAdd = expected.filter(label => !currentLabels.includes(label));
  const toRemove = currentProjected.filter(label => !expected.includes(label));
  const reasons = toAdd.length || toRemove.length ? ['task_label_projection_mismatch'] : [];
  return { expected, toAdd, toRemove, reasons };
}

                                    
                       
                      
                           
                           
 

                                                                                             

                                        
                      
                           
                          
                    
 

/**
 * `changes` are typed triggers/non-triggers from the contract's reuse policy (not free text).
 * A scope-fingerprint or work-unit mismatch, or a listed reconsider trigger, forces reconsideration.
 * Listed non-triggers (model release, benchmark movement, ...) never invalidate a valid record.
 */
export function decideTaskProfileReuse(
  bound                          , prior                          , input                       ,
)                           {
  assertTaskProfileContract(bound.contract);
  if (!input.executableUnit) return 'not-applicable';
  if (!prior) return 'profile';
  if (prior.workUnitKey !== input.workUnitKey) return 'profile';
  if (prior.contractIdentity !== bound.contractIdentity) return 'reconsider';
  if (prior.scopeFingerprint !== input.scopeFingerprint) return 'reconsider';
  const triggers = bound.contract.reuse.reconsiderTriggers;
  if (input.changes.some(change => triggers.includes(change))) return 'reconsider';
  return 'reuse';
}

                                
                                                                                                               
                                                                                                                           

/** Never human-required, never blocking: absence of a historical profile degrades gracefully. */
export function resolveRuntimeTaskProfile(
  bound                          , record                                      , subject                                                   ,
)                     {
  assertTaskProfileContract(bound.contract);
  if (record === 'unknown' || record === null) return { kind: 'legacy-unprofiled', reason: 'missing', fabricatedVector: false };
  if (record.workUnitKey !== subject.workUnitKey) return { kind: 'legacy-unprofiled', reason: 'invalid', fabricatedVector: false };
  if (record.contractIdentity !== bound.contractIdentity) return { kind: 'legacy-unprofiled', reason: 'unsupported_schema', fabricatedVector: false };
  if (record.scopeFingerprint !== subject.scopeFingerprint) return { kind: 'legacy-unprofiled', reason: 'stale', fabricatedVector: false };
  const validated = validateTaskProfile(bound, record.profile);
  if (!validated.ok) return { kind: 'legacy-unprofiled', reason: 'invalid', fabricatedVector: false };
  return { kind: 'profiled', profile: validated.profile, confidence: validated.profile.confidence, contractIdentity: bound.contractIdentity };
}
