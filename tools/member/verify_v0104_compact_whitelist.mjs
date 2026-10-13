/**
 * Exact user-supplied Member V0104 compact whitelist acceptance test.
 *
 * SOURCE-ALIGNED is a local structural result only. The whitelist itself
 * declares UNRESOLVED and NO_AUTHORIZATION; no Gate or approval is forged.
 * Built-ins only; checks 31 owner schemas, declared interfaces, relations,
 * rule field targets, exact V0104 source bytes, and all compact blockers.
 */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const read=(p)=>fs.readFileSync(path.join(repo,p),'utf8');
const compact=JSON.parse(read('tests/p1/member/fixtures/member_v0104_compact_whitelist.unresolved.json'));
const manifest=JSON.parse(read('spec/p1/member/source_projection_manifest.json'));
const source=read('spec/p1/member/source_snapshot/Q.MEMBERSHIP.CONTRACT.CAPABILITY.MEMBER.V0104.yaml');
const qreg=read('spec/p1/member/capability_objects.qreg');
const profile=read('spec/p1/member/capability_profile.qcon.yaml');
const policy=read('spec/p1/member/capability_policy.qconfig');
const interfaces=JSON.parse(read('spec/p1/member/capability_interfaces.json'));
const violations=[],evidence={};
function check(condition,where,detail=''){if(!condition)violations.push({where,detail})}
const sourceHash='sha256:'+createHash('sha256').update(source,'utf8').digest('hex');
check(sourceHash===compact.source_hash,'source_hash','Actual '+sourceHash+' != declared '+compact.source_hash);
check(compact.artifact_ref==='Q.MEMBERSHIP.CONTRACT.CAPABILITY.MEMBER@V0104','artifact_ref');
check(manifest.source_ref===compact.artifact_ref,'manifest.source_ref');
check(manifest.source_hash_expected===compact.source_hash,'manifest.source_hash');
check(compact.closure_status==='UNRESOLVED'&&compact.default_effect==='NO_AUTHORIZATION','whitelist_status');
check(manifest.scoped_whitelist_status==='UNRESOLVED'&&manifest.gate_pass_claimed===false,'manifest.closure_status');
check(compact.counts.scopes===42 && compact.counts.field_occurrences===286 &&
 compact.counts.qwide_occurrences===200&&compact.counts.owner_local_occurrences===86,
 'declared_count_integrity');

const lines=qreg.split('\n');
function indent(s){return s.length-s.trimStart().length}
function block(start,end,depth){let j=start+1;
 while(j<end){
   const t=lines[j];
   if(t.trim()!=='' && indent(t)<=depth && !/^\s*-\s/.test(t))break;
   j++;
 }
 return {start,end:j,depth};
}
function root(key){
 for(let i=0;i<lines.length;i++)if(lines[i]===key+':')return block(i,lines.length,0);
 return null;
}
function child(parent,name){
 if(!parent)return null;
 const depth=parent.depth+2;
 for(let i=parent.start+1;i<parent.end;i++){
   if(indent(lines[i])===depth && lines[i].trimStart().startsWith(name+':'))
     return block(i,parent.end,depth);
 }
 return null;
}
function scalar(parent,key){
 const n=child(parent,key);return n?lines[n.start].trimStart().slice(key.length+1).trim():null;
}
function items(parent,key){
 const b=child(parent,key);
 if(!b)return [];
 const prefix=b.depth;
 const arr=[];
 for(let i=b.start+1;i<b.end;i++){
   const ln=lines[i],m=ln.trimStart().match(/^-\s+(.+)$/);
   if(m && indent(ln)>=prefix)arr.push(m[1]);
 }
 return arr;
}
function schema(scope){
 const [rootKey,second,third]=scope.split('/');
 let p=root(rootKey);
 if(!p)return null;
 if(rootKey==='type_closure') {
   // type_closure/schemas/<schema_name> is a three-segment scope.
   return child(child(p,'schemas'),third);
 }
 p=child(p,second);
 if(third==='schema')p=child(p,'schema');
 return p;
}
function node(s,pointer){
 let current=s;
 if(!current)return null;
 const parts=pointer===''?[]:pointer.replace(/^\//,'').split('/');
 for(const segment of parts){current=child(child(current,'properties'),segment);if(!current)return null;}
 return current;
}
let total={required:0,optional:0,forbidden:0,closed_objects:0,references:0,branch_refs:0,conditional:0,negative_rules:0};
for(const [owner,def] of Object.entries(compact.owner_schemas)){
 const s=schema(owner),prefix='owner_schemas.'+owner;
 check(Boolean(s),prefix,'Owner schema not found');
 if(!s)continue;
 for(const pointer of def.required??[]){
   total.required++;
   const parts=pointer.replace(/^\//,'').split('/');
   const field=parts.pop();
   const parent=node(s,parts.join('/'));
   check(Boolean(node(s,pointer)),prefix+pointer,'required schema property absent');
   check(parent&&items(parent,'required').includes(field),prefix+pointer,'missing exact required[]');
 }
 for(const pointer of def.optional??[]){
   total.optional++;
   const parts=pointer.replace(/^\//,'').split('/');
   const field=parts.pop(),parent=node(s,parts.join('/'));
   check(Boolean(node(s,pointer)),prefix+pointer,'optional schema property absent');
   check(parent&&!items(parent,'required').includes(field),prefix+pointer,'optional field also required');
 }
 for(const pointer of def.closed_objects??[]){
   total.closed_objects++;
   const p=node(s,pointer);
   check(p&&scalar(p,'additionalProperties')==='false',prefix+pointer,'additionalProperties must be false');
 }
 for(const pointer of def.forbidden??[]){
   total.forbidden++;
   check(!node(s,pointer),prefix+pointer,'forbidden field has been declared as allowed');
 }
 for(const [pointer,kind] of def.negative_rules??[]){
   total.negative_rules++;
   const p=node(s,pointer);
   check(p&&Boolean(child(p,kind)),prefix+pointer,'negative constraint missing');
 }
 for(const [pointer,target] of def.references??[]){
   total.references++;
   const p=node(s,pointer);
   check(p&&scalar(p,'$ref')===compact.artifact_ref+'#/'+target,prefix+pointer,'exact schema $ref mismatch');
 }
 for(const ref of def.branch_refs??[]){
   total.branch_refs++;
   const [mode,index]=ref.split('/');
   const b=child(s,mode);
   if(!b){check(false,prefix,'Missing '+ref+' branch');continue;}
   const raw=lines.slice(b.start+1,b.end).filter(x=>/^\s*-\s/.test(x)).filter(x=>indent(x)===b.depth);
   check(Number.isInteger(+index)&&raw.length>+index,prefix+'.'+ref,'Declared schema branch not found');
 }
 for(const [pointer,ifRef,thenRef] of def.conditional??[]){
   total.conditional++;
   const [family,n]=ifRef.split('/'),condition=child(s,family);
   const body=condition?lines.slice(condition.start+1,condition.end).join('\n'):'';
   check(Boolean(node(s,pointer))&&Number.isInteger(+n)&&body.includes('if:')&&body.includes('then:')&&
     body.includes('required:')&&body.includes('- '+pointer.split('/').at(-1)),
     prefix+pointer,'Conditional branch does not enforce declared endpoint');
 }
}
evidence.owner_schemas=Object.keys(compact.owner_schemas).length;
evidence.owner_field_checks=total;

const publicNames=compact.interfaces.EXTERNAL_INTERFACE,internalNames=compact.interfaces.INTRA_CAPABILITY_OPERATION;
const declarations=[...publicNames,...internalNames];
check(interfaces.q_version==='V0104'&&interfaces.interfaces.length===9,'interfaces.q_version/count');
const seen=new Set();
for(const name of declarations){
 const x=interfaces.interfaces.find(y=>y.interface_id===name),where='interfaces.'+name;
 check(Boolean(x),where,'interface missing');if(!x)continue;
 check(!seen.has(name),where,'duplicate interface');seen.add(name);
 const expected={...compact.interface_template};
 const overrides=compact.interfaces.overrides[name]??{};
 check(x.operation_ref===compact.artifact_ref+'#/operations/'+x.operation_id,where+'.operation_ref');
 check(x.interface_ref===compact.artifact_ref+'#/interfaces/'+name,where+'.interface_ref');
 check(x.method_ref===x.operation_id,where+'.method_ref');
 for(const key of expected.definition)check(x[key]!==undefined && x[key]!==null,where+'.'+key,'definition field absent');
 for(const [key,values] of Object.entries({
  path:expected.path,
  static_mount:[...expected.static_mount,...(overrides.static_mount_add??[])],
  dynamic_mount:[...expected.dynamic_mount,...(overrides.dynamic_mount_add??[])]}))
   check(JSON.stringify(x[key])===JSON.stringify(values),where+'.'+key,'mount template difference');
 check(internalNames.includes(name)===(x.publicity==='internal'),where+'.publicity');
}
check(JSON.stringify(interfaces.external_provider_surface.provider_interface_refs)===
 JSON.stringify(interfaces.interface_inventory.specification_interface_refs),'external_provider_surface');
check(interfaces.interface_inventory.specification_interface_refs.length===8&&
 interfaces.interface_inventory.internal_interface_refs.length===1&&
 interfaces.interface_inventory.payload_contract_refs.length===27,'interface_inventory');
evidence.interfaces=declarations.length;

function section(text,key){
 const l=text.split('\n'),i=l.indexOf(key+':');if(i<0)return '';
 let j=i+1;while(j<l.length&&!/^[A-Za-z_][A-Za-z_0-9]*:/.test(l[j]))j++;
 return l.slice(i,j).join('\n');
}
function recordFragment(sectionText,key,indentSize){
 const l=sectionText.split('\n'),i=l.findIndex(x=>x===' '.repeat(indentSize)+key+':');
 if(i<0)return '';
 let j=i+1;while(j<l.length&&(l[j].trim()===''||indent(l[j])>indentSize))j++;
 return l.slice(i,j).join('\n');
}
const relation=section(policy,'operational_relations'),rules=section(policy,'rule_bindings');
for(const [name,expected] of Object.entries(compact.inter_capability_relations)){
 const b=recordFragment(relation,name,4);
 const op='Q.MEMBERSHIP.CONTRACT.CAPABILITY.MEMBER@V0104#/operations/'+expected.operation;
 check(b.includes('consumer_operation_ref: '+op),'relation.'+name+'.operation');
 check(b.includes('provider_capability_contract_ref: '+expected.provider_contract),'relation.'+name+'.provider');
 for(const [src,dest] of expected.request){
   check(b.includes('consumer_source_path: '+src)&&b.includes('provider_request_field_path: '+dest),
     'relation.'+name+'.request','mapping not exact');
 }
 for(const [provider,dest,type] of expected.response){
   check(b.includes('provider_runtime_result_path: '+provider)&&
     b.includes('consumer_binding_key: '+dest)&&
     b.includes('consumer_binding_schema_ref: '+compact.artifact_ref+'#/'+type),
     'relation.'+name+'.response','mapping not exact');
 }
 check(b.includes('invocation_mode: SINGLE')&&b.includes('for_each_error_mode: null')&&!b.includes('iteration_source_path:'),
    'relation.'+name+'.SINGLE','conditional forbidden/null constraint');
 check(!b.includes('literal_value:'),'relation.'+name+'.CONSUMER_INPUT','literal value forbidden');
}
evidence.operational_relations=Object.keys(compact.inter_capability_relations).length;
for(const [id,targets] of Object.entries(compact.rule_field_targets)){
 const rule=recordFragment(rules,id,4);
 const parsed=[];
 const matches=[...rule.matchAll(/^\s+- operation_ref: ([^\n]+)\n\s+boundary: ([^\n]+)\n\s+field_path: ([^\n]+)/gm)];
 for(const m of matches)parsed.push([m[1].split('/').at(-1),m[2].trim(),m[3].trim()]);
 check(JSON.stringify(parsed)===JSON.stringify(targets),'rule_field_targets.'+id,
   JSON.stringify({found:parsed,expected:targets}));
}
evidence.rule_field_targets=Object.keys(compact.rule_field_targets).length;

const allOps=interfaces.interfaces.map(x=>x.operation_id);
const meta=read('src/p1/export/member/metadata.ts'),contracts=read('src/p1/export/member/contracts.ts');
check(meta.includes('V0104')&&!meta.includes('Q.MEMBERSHIP.CONTRACT.CAPABILITY.MEMBER@V0103'),'metadata.version');
check(contracts.includes('V0104')&&!contracts.includes('Q.MEMBERSHIP.CONTRACT.CAPABILITY.MEMBER@V0103'),'contracts.version');
const perms=section(policy,'permission_model');
check((perms.match(/^\s{6}access_mode: RESTRICTED$/gm)||[]).length===9,'permission_model.RESTRICTED');
check((perms.match(/^\s{6}x_missing_exact_actor_identity_and_auth_rule: true$/gm)||[]).length===9,'permission_model.actor_authority');
check(perms.includes('actor_classes: []'),'permission_model.actor_classes');
check(compact.blockers['permission_model/actor_classes']==='EMPTY; RESTRICTED; DENY','declared_blocker.actor_classes');
evidence.operation_count=allOps.length;

const report={
 artifact_ref:compact.artifact_ref,source_hash_computed:sourceHash,
 record_kind:compact.record_kind,declared_closure_status:compact.closure_status,
 checked_owner_schema_count:evidence.owner_schemas,owner_field_checks:total,
 verified_interface_count:evidence.interfaces,verified_rule_field_bindings:evidence.rule_field_targets,
 verified_inter_capability_relations:evidence.operational_relations,
 declared_scope_counts:compact.counts,
 source_alignment:violations.length?'FAILED':'SOURCE_ALIGNED_CANDIDATE',
 whitelist_closure_status:'UNRESOLVED',production_authorization:'NO_AUTHORIZATION',
 blockers:compact.blockers,violations
};
console.log(JSON.stringify(report,null,2));
if(violations.length)process.exitCode=1;
