/**
 * P1CM V0117 specific conditional-branch checks for candidate Member V0104.
 * Only applies branches present in the exact Member Owner source.
 * Does not promote source-only candidates to an admitted whitelist.
 */
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const read=p=>readFileSync(join(root,p),'utf8');
const candidate=JSON.parse(read('tests/p1/member/fixtures/v0117_source_only_field_projection.json'));
const qcon=read('spec/p1/member/capability_profile.qcon.yaml');
const qconfig=read('spec/p1/member/capability_policy.qconfig');
const violations=[];
const check=(ok,why)=>{if(!ok)violations.push(why)};
const extract=(txt,name)=>{
 const lines=txt.split('\n'),index=lines.findIndex(x=>x===name+':');
 if(index===-1)return '';
 let j=index+1;while(j<lines.length&&!/^[a-z][a-z_]*:/.test(lines[j]))j++;
 return lines.slice(index,j).join('\n');
};
const get=(block,key)=>block.match(new RegExp('^\\s+'+key+':\\s*(.*)$','m'))?.[1]??'';

function extractByHeading(text,headingRe,endRe,nameRe) {
 const lines=text.split('\n'),result=[];
 let on=false,current=null;
 const save=()=>{if(current){result.push(current);current=null}};
 for(const line of lines) {
   if(headingRe.test(line)){on=true;continue}
   if(on && endRe.test(line)){save();on=false;continue}
   if(!on)continue;
   const m=line.match(nameRe);
   if(m){save();current={name:m[1],lines:[]};continue}
   if(current)current.lines.push(line);
 }
 save();
 return result;
}

const state=extract(qcon,'state_model');
check(get(state,'mode')==='STATEFUL','State model cannot silently become stateless');
const bindings=extractByHeading(state,/^      operation_state_bindings:$/,/^      transitions:$/,/^        ([a-z_]+):$/);
const modes={};
for(const b of bindings){
 const body=b.lines.join('\n'),mode=get(body,'applicability_mode');
 modes[mode]=(modes[mode]||0)+1;
 check(get(body,'operation_ref').endsWith('/'+b.name),'Invalid state Operation ref '+b.name);
 if(mode==='NOT_APPLICABLE'){
   for(const k of ['subject_identity_cardinality','subject_identity_input_path','subject_identity_result_path'])
     check(get(body,k)==='null','NOT_APPLICABLE requires null '+k+' '+b.name);
   for(const k of ['allowed_states','guard_rule_refs','transition_refs'])
     check(get(body,k)==='[]','NOT_APPLICABLE requires empty '+k+' '+b.name);
 }else if(mode==='EXISTING_SUBJECT'){
   check(get(body,'subject_identity_cardinality')==='ONE','EXISTING_SUBJECT cardinality '+b.name);
   check(!['','null'].includes(get(body,'subject_identity_input_path')),'EXISTING_SUBJECT input path '+b.name);
   check(get(body,'subject_identity_result_path')==='null','EXISTING_SUBJECT result path must be null '+b.name);
 }else if(mode==='CREATES_SUBJECT'){
   check(get(body,'subject_identity_cardinality')==='ONE','CREATES_SUBJECT cardinality '+b.name);
   check(get(body,'subject_identity_input_path')==='null','CREATES_SUBJECT input must be null '+b.name);
   check(!['','null'].includes(get(body,'subject_identity_result_path')),'CREATES_SUBJECT result path '+b.name);
   for(const k of ['allowed_states','guard_rule_refs','transition_refs'])
     check(get(body,k)==='[]','CREATES_SUBJECT must be empty '+k+' '+b.name);
 }else check(false,'Unrecognized applicability mode '+mode+' '+b.name);
 if(get(body,'availability_mode')==='ANY_STATE')check(get(body,'allowed_states')==='[]','ANY_STATE has invented state guard '+b.name);
}
check(bindings.length===18,'Each of two state machines must cover nine exact Operations');

const rules=extract(qconfig,'rule_bindings');
const entries=extractByHeading(rules,/^  bindings:$/,/^operational_relations:$/,/^    (RB-\d+):$/);
const evaluations={};
for(const e of entries) {
 const body=e.lines.join('\n'),mode=get(body,'evaluation_realization_mode'),phase=get(body,'enforcement_phase');
 evaluations[mode]=(evaluations[mode]||0)+1;
 if(mode==='INFORMATIONAL'){
   check(['INFORMATIONAL','EVIDENCE_ONLY'].includes(phase),'INFORMATIONAL phase is blocking '+e.name);
   check(get(body,'failure_stable_error_code')==='null','INFORMATIONAL may not invent stable failure '+e.name);
   check(get(body,'decision_operational_relation_ref')==='null','INFORMATIONAL decision should be null '+e.name);
 }else if(mode==='OPERATION_ENFORCED'){
   check(get(body,'decision_operational_relation_ref')==='null','OPERATION_ENFORCED invented relation '+e.name);
   check(/^\s+target_operation_refs:\n\s+- /m.test(body),'OPERATION_ENFORCED lacks exact target Operation '+e.name);
 }else if(mode==='DEPENDENCY_DECISION'){
   check(!['','null'].includes(get(body,'decision_operational_relation_ref')),'DEPENDENCY_DECISION lacks relation '+e.name);
   check(!['','null'].includes(get(body,'decision_consumer_binding_key')),'DEPENDENCY_DECISION lacks binding '+e.name);
 }else if(mode==='HUMAN_DECISION'){
   check(!['','null'].includes(get(body,'human_decision_field_binding')),'HUMAN_DECISION lacks binding '+e.name);
 }else check(false,'Unexpected evaluation mode '+mode+' '+e.name);
}
check(entries.length===21,'All 21 rule bindings must be checked');

const perms=extract(qconfig,'permission_model');
check((perms.match(/^\s{6}access_mode: RESTRICTED$/gm)||[]).length===9,
  'Unapproved relaxation of RESTRICTED permissions');
check((perms.match(/^\s{6}x_missing_exact_actor_identity_and_auth_rule: true$/gm)||[]).length===9,
  'Unresolved actor provenance must remain explicitly fail closed');
const actorClassCount=(perms.match(/^\s{4}actor_class_ref:/gm)||[]).length;
check(actorClassCount===0,'Do not invent actor classes');
const instance=extract(qcon,'instance_variability');
check(get(instance,'mode')==='NONE' && get(instance,'instance_variables')==='[]',
  'Undeclared INSTANCE variable introduced');

const report={
 source_ref:candidate.source_ref,
 verification_level:'SOURCE_ONLY',
 applicable_state_bindings:bindings.length,
 state_applicability_modes:modes,
 rule_bindings_checked:entries.length,
 evaluation_realization_modes:evaluations,
 forbidden_and_conditional_source_constraints_indexed:candidate.source_constraints.length,
 unapproved_actor_authority:'UNRESOLVED',
 scoped_whitelist_status:'UNRESOLVED',
 conditional_branch_source_status:violations.length===0?'SOURCE_ALIGNED_CANDIDATE':'FAILED',
 violations
};
console.log(JSON.stringify(report,null,2));
if(violations.length)process.exitCode=1;
