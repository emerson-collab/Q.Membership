/**
 * P1CM V0117 Member SOURCE-ONLY regression.
 * Validates owner-scoped candidate fields and applicable branch predicates.
 * Never issues a Q.Standard Scoped Whitelist, Authority Lock or Q.Gate verdict.
 * Node built-ins only; no extra standard sources or runtime framework assumptions.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = path => readFileSync(join(root, path), 'utf8');
const fixture = JSON.parse(read('tests/p1/member/fixtures/v0117_source_only_field_projection.json'));
const manifest = JSON.parse(read('spec/p1/member/source_projection_manifest.json'));
const files = {
  profile: read('spec/p1/member/capability_profile.qcon.yaml'),
  qreg: read('spec/p1/member/capability_objects.qreg'),
  policy: read('spec/p1/member/capability_policy.qconfig'),
  interfaces: read('spec/p1/member/capability_interfaces.json'),
  metadata: read('src/p1/export/member/metadata.ts'),
  code: read('src/p1/export/member/contracts.ts'),
  entry: read('src/p1/export/member/entry.ts'),
};
const violations = [];
const check = (condition, detail) => { if (!condition) violations.push(detail); };
const has = (t, key) => new RegExp('^\\s+' + key + ':', 'm').test(t);
function topSection(text, name) {
  const lines = text.split('\n');
  const first = lines.findIndex(x => x === name + ':');
  if (first < 0) return '';
  let end = first + 1;
  while (end < lines.length && !/^[A-Za-z_][A-Za-z_0-9]*:/.test(lines[end])) end++;
  return lines.slice(first, end).join('\n');
}
function semanticAnnotations(text) {
  const lines = text.split('\n'), blocks = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== 'x_q_field_semantics:') continue;
    const depth = lines[i].match(/^\s*/)[0].length;
    let j = i + 1;
    while (j < lines.length && (lines[j].trim() === '' || lines[j].match(/^\s*/)[0].length > depth)) j++;
    const body = lines.slice(i+1, j).join('\n');
    const get = name => body.match(new RegExp('^\\s+' + name + ':\\s*(.+)$', 'm'))?.[1] ?? null;
    blocks.push({line:i+1,body,kind:get('semantic_kind'),variability:get('variability_class'),owner:get('reference_owner_mode')});
    i = j - 1;
  }
  return blocks;
}
function localErrorSets(text) {
  const out = {};
  const lines = topSection(text, 'stable_errors').split('\n');
  let op = '', inside = false;
  for (const line of lines) {
    const m = line.match(/^  ([a-z_]+):$/);
    if (m) { op = m[1]; out[op] = []; inside = false; continue; }
    if (line === '    error_code_set:') {inside = true; continue;}
    if (inside && /^    [A-Za-z_]+:/.test(line)) inside = false;
    const c = inside && line.match(/^    - ([A-Z][A-Z0-9_]+)$/);
    if (c && op) out[op].push(c[1]);
  }
  return out;
}

check(fixture.kind === 'V0117_STANDARD_SOURCE_FIELD_PROJECTION', 'Wrong selected candidate snapshot');
check(fixture.verification_level === 'SOURCE_ONLY' && fixture.permission_claim === 'SOURCE_DECLARATIONS_NOT_AN_AUTHORIZED_BUSINESS_WHITELIST', 'Fixture improperly claims admission');
check(fixture.source_ref === 'Q.SS.STD.META.CONTRACT.P1_CAPABILITY_MATERIALIZATION@V0117', 'Wrong V0117 exact ref');
check(fixture.source_field_candidates.length === 255 && fixture.source_constraints.length === 75, 'Expected 255 source candidates / 75 conditional constraints');
check(fixture.source_constraints.filter(x => x.requirement_kind === 'FORBIDDEN').length === 20, 'Missing branch-sensitive FORBIDDEN constraints');

const sectionPath = {
  'spec/p1/member/capability_profile.qcon.yaml':'profile',
  'spec/p1/member/capability_objects.qreg':'qreg',
  'spec/p1/member/capability_policy.qconfig':'policy',
};
for (const [path, names] of Object.entries(manifest.declared_source_sections)) {
  const key = sectionPath[path];
  if (!key) continue;
  for (const name of names) check(Boolean(topSection(files[key], name)), 'Missing source-bound '+name+' in '+path);
}
const requiredRoots = fixture.source_field_candidates
  .filter(x => x.owner_record === 'capability_contract' && x.requirement === 'REQUIRED')
  .map(x => x.field_name);
for (const name of requiredRoots) {
  check(name === 'interfaces' || ['profile','qreg','policy'].some(x => Boolean(topSection(files[x], name))),
    'Missing root required Capability section: '+name);
}
for (const [n, owner] of [['identity','capability_contract.identity'],['ownership','capability_contract.ownership']]) {
  const sec = topSection(files.profile,n);
  for (const x of fixture.source_field_candidates.filter(c => c.owner_record===owner && c.requirement==='REQUIRED')) {
    check(has(sec,x.field_name), 'Missing '+owner+'.'+x.field_name);
  }
}
const objects = topSection(files.qreg,'type_closure');
const requests = topSection(files.qreg,'contracts');
const errors = localErrorSets(files.qreg);
const code = files.code.slice(files.code.indexOf('export const STABLE_ERROR_CODE_SETS = {'),files.code.indexOf('} as const satisfies Record<OperationId'));
const codeErrors = {};
for (const m of code.matchAll(/^\s{2}([a-z_]+): \[([\s\S]*?)\],/gm))
  codeErrors[m[1]] = [...m[2].matchAll(/'([A-Z][A-Z0-9_]+)'/g)].map(x => x[1]);
check(Object.keys(errors).length === 9, 'Expected nine exact StableError owner sets');
check(Object.keys(codeErrors).length === 9, 'Expected nine Operation code error sets');
for (const [op,codes] of Object.entries(errors))
  check(JSON.stringify(codeErrors[op])===JSON.stringify(codes), 'Code/Owner StableError mismatch: '+op);
check(Object.values(errors).reduce((n,v)=>n+v.length,0)===60, 'Expected 60 exact Operation error declarations');
check((requests.match(/^\s{2}[a-z_]+_request_contract:/gm)||[]).length===9, 'Missing request schemas');
check((requests.match(/^\s{2}[a-z_]+_response_contract:/gm)||[]).length===9, 'Missing response schemas');
const annotations = semanticAnnotations(requests);
const semanticCounts = {};
for (const a of annotations) {
  semanticCounts[a.kind]=(semanticCounts[a.kind]||0)+1;
  check(a.kind !== null && a.variability !== null, 'Unclassified schema field @'+a.line);
  if(a.variability === 'GENERAL') check(!has(a.body,'instance_variable_ref'), 'GENERAL has instance_variable_ref @'+a.line);
  if(a.kind === 'TEMPORAL') check(has(a.body,'temporal_kind'), 'TEMPORAL kind incomplete @'+a.line);
  if(a.kind === 'BUSINESS_REFERENCE') {
    for(const key of ['reference_owner_mode','resolution_mode','selection_cardinality','manual_entry_allowed'])
      check(has(a.body,key), 'Reference lacks '+key+' @'+a.line);
    if(a.owner === 'SELF') check(!has(a.body,'local_dependency_ref'), 'SELF must not own local dependency @'+a.line);
    if(a.owner === 'DECLARED_DEPENDENCY')
      check(has(a.body,'local_dependency_ref') && has(a.body,'reference_owner_ref'), 'Declared dependency binding incomplete @'+a.line);
  }
}
check(annotations.length===41, 'Request/response schema annotation projection incomplete');
check(semanticCounts.PLAIN_VALUE===18 && semanticCounts.BUSINESS_REFERENCE===17 && semanticCounts.TEMPORAL===6,
  'Schema semantic kinds differ from exact Member source');

const iface=JSON.parse(files.interfaces);
const publicRefs=iface.interfaces.filter(x=>x.publicity==='public').map(x=>x.interface_ref);
const internalRefs=iface.interfaces.filter(x=>x.publicity==='internal').map(x=>x.interface_ref);
check(iface.interfaces.length===9 && publicRefs.length===8 && internalRefs.length===1, 'Nine interface Inventory identities violated');
check(iface.interface_inventory.payload_contract_refs.length===27, 'Payload closure references missing');
check(JSON.stringify(iface.external_provider_surface.provider_interface_refs)===JSON.stringify(publicRefs),'External provider subset mismatch');
check(publicRefs.every(x=>!internalRefs.includes(x)), 'Internal Interface exposed in public surface');
for (const op of iface.interfaces) check(op.operation_ref.endsWith('/'+op.operation_id), 'Mismatched Interface/Operation identity');

const rel = topSection(files.policy,'operational_relations');
check((rel.match(/^\s{6}relation_ref:/gm)||[]).length===2,'Two declared relation identities required');
check((rel.match(/^\s{6}invocation_mode: SINGLE$/gm)||[]).length===2,'Unexpected relation invocation mode');
check((rel.match(/^\s{6}for_each_error_mode: null$/gm)||[]).length===2,'SINGLE for_each_error_mode must be null');
check(!has(rel,'iteration_source_path'),'SINGLE has forbidden iteration_source_path');
check((rel.match(/^\s{8}source_kind: CONSUMER_INPUT$/gm)||[]).length===2,'Relation source kind mismatch');
check((rel.match(/^\s{8}consumer_source_path:/gm)||[]).length===2,'Consumer input path required');
check(!has(rel,'literal_value'),'CONSUMER_INPUT cannot create static literals');

const state=topSection(files.profile,'state_model');
check(state.includes('mode: STATEFUL'),'Member must retain exact STATEFUL model');
check((state.match(/^\s{4}(?:member|membership):$/gm)||[]).length===2,'Two state machines required');
check((state.match(/^\s{10}transition_ref:/gm)||[]).length===2,'Two exact transition identities required');
check(!/^\s+from_state:/m.test(state) && !/^\s+via_operation:/m.test(state),'Legacy transition alias still authoritative');
const perms=topSection(files.policy,'permission_model');
check((perms.match(/^\s{6}permission_ref:/gm)||[]).length===9,'Each Operation needs an exact permission_ref');
check((perms.match(/^\s{6}access_mode: RESTRICTED$/gm)||[]).length===9,'Permission mode changed without Owner approval');
check((perms.match(/^\s{6}x_missing_exact_actor_identity_and_auth_rule: true$/gm)||[]).length===9,'Missing-actor fail-closed disclosure lost');
const rb=topSection(files.policy,'rule_bindings');
check((rb.match(/^\s{4}RB-\d+:/gm)||[]).length===21,'Exact 21 rule bindings required');
for(const key of ['rule_ref','enforcement_phase','evaluation_realization_mode','target_operation_refs',
 'target_field_bindings','target_transition_refs','target_operational_relation_refs',
 'target_permission_refs','decision_operational_relation_ref','decision_consumer_binding_key',
 'human_decision_actor_class_refs','human_decision_field_binding','human_allow_values',
 'human_deny_values','failure_stable_error_code'])
  check((rb.match(new RegExp('^\\s{6}'+key+':','gm'))||[]).length===21, 'Incomplete rule binding field '+key);
const instance=topSection(files.profile,'instance_variability');
check(instance.includes('mode: NONE')&&instance.includes('instance_variables: []'),'Invented an undeclared Capability Instance');

check(!/\bstate_machines\s*:|\bvia:\s*|\bprovider_operation\s*:/.test(files.metadata), 'Metadata still contains legacy semantic shadow');
const general = files.metadata.match(/return Object\.freeze\(\{([\s\S]*?)\n  \}\);/)?.[1] ?? '';
const keys=[...general.matchAll(/^\s{4}([a-z_]+):/gm)].map(x=>x[1]);
const expected=['capability_ref','capability_id','capability_version','capability_contract_ref',
 'capability_contract_content_hash','stage_contract_ref','runtime_contract_ref','operation_id',
 'operation_ref','interface_ref','surface','kind','method_ref'];
check(JSON.stringify(keys)===JSON.stringify(expected), '13 exact candidate GENERAL facts not present in source order');
for (const key of ['capability_contract_content_hash','stage_contract_ref','runtime_contract_ref'])
  check(new RegExp('^\\s{4}'+key+': null,','m').test(general),'Unresolved authority fabricated: '+key);
for(const item of ['MemberCapabilityClient','InMemoryMemberRepository','staticMembershipPlanProvider'])
  check(!new RegExp('\\b'+item+'\\b').test(files.entry),'Local test runtime leaked from public Capability entry');
check(manifest.scoped_whitelist_status === 'UNRESOLVED' && manifest.gate_pass_claimed===false,
 'Candidate claims a verified whitelist/Gate');

const blockers=[
 'Member V0104 remains candidate; exact external owner source/hash freeze unavailable',
 'Nine RESTRICTED Operation permission bindings lack authorized actor-class evidence',
 'User-provided 255-field/75-constraint projection is SOURCE_ONLY, not approved Scoped Whitelist',
 'Exact governed interface/runtime materialization, receipt and Gate evidence not produced'
];
export const report = {
  source_ref: fixture.source_ref,
  source_hash: fixture.source_hash,
  evidence_level: fixture.verification_level,
  candidate_field_occurrences: fixture.source_field_candidates.length,
  declared_conditional_constraints: fixture.source_constraints.length,
  constraint_evaluation_scope: 'APPLICABLE_SOURCE_BRANCH_FAMILIES_ONLY',
  all_75_constraints_independently_executed: false,
  semantic_annotations: annotations.length,
  semantic_kinds: semanticCounts,
  verified_operation_errors: Object.values(errors).reduce((n,v)=>n+v.length,0),
  source_projection_status: violations.length===0?'SOURCE_ALIGNED_CANDIDATE':'FAILED',
  scoped_whitelist_status: 'UNRESOLVED',
  authority_lock_verified: false,
  ready_for_production: false,
  blockers,
  violations,
};
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(report,null,2));
  if(violations.length)process.exitCode=1;
}
