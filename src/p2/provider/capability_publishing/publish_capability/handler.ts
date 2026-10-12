import { createHash } from "node:crypto";

export type JsonObject=Readonly<Record<string,unknown>>;
export interface P2OperationRequest{readonly input:JsonObject;readonly runtime_context:JsonObject;readonly trace_id:string;readonly request_id:string;}
export interface P2OperationResponse{readonly outcome_type:"response";readonly runtime_result:JsonObject;readonly trace_id:string;readonly request_id:string;}
export class P2StableError extends Error{readonly code:string;constructor(code:string,message:string){super(message);this.name="P2StableError";this.code=code;}}

function objectValue(value:unknown,field:string):JsonObject{if(value===null||typeof value!=="object"||Array.isArray(value))throw new P2StableError("P2_INVALID_INPUT",`${field} must be an object`);return value as JsonObject;}
function stringValue(value:unknown,field:string):string{if(typeof value!=="string"||!value)throw new P2StableError("P2_INVALID_INPUT",`${field} must be a non-empty string`);return value;}
function exactCapabilityContractRef(value:unknown,field:string):string{const text=stringValue(value,field);if(!/@V\d{4}$/.test(text))throw new P2StableError("P2_CAPABILITY_CONTRACT_INVALID",`${field} must be exact-versioned`);return text;}
function sha256Value(value:unknown,field:string):string{const text=stringValue(value,field);if(!/^sha256:[0-9a-f]{64}$/.test(text))throw new P2StableError("P2_INTEGRITY_BINDING_INVALID",`${field} must be an exact sha256 binding`);return text;}
function stableClone(value:unknown):unknown{if(Array.isArray(value))return Object.freeze(value.map(stableClone));if(value!==null&&typeof value==="object"){const src=value as Record<string,unknown>;const out:Record<string,unknown>={};for(const key of Object.keys(src).sort())out[key]=stableClone(src[key]);return Object.freeze(out);}return value;}
function canonical(value:unknown):string{return JSON.stringify(stableClone(value));}
function sha256Json(value:unknown):string{return `sha256:${createHash("sha256").update(canonical(value),"utf8").digest("hex")}`;}
function success(request:P2OperationRequest,runtime_result:JsonObject):P2OperationResponse{return Object.freeze({outcome_type:"response" as const,runtime_result:Object.freeze({...runtime_result}),trace_id:request.trace_id,request_id:request.request_id});}
function exactProviderInterfaceRefs(value:unknown,capabilityContractRef:string):readonly string[]{
 if(!Array.isArray(value)||value.length===0)throw new P2StableError("P2_INVALID_INPUT","provider_interface_refs must be a non-empty array");
 const refs=value.map((item,index)=>stringValue(item,`provider_interface_refs[${index}]`));
 const seen=new Set<string>();
 for(const ref of refs){
  if(!ref.startsWith(`${capabilityContractRef}#/interfaces/`))throw new P2StableError("P2_INTERFACE_MEMBER_MISMATCH","provider_interface_refs must be exact Interfaces owned by capability_contract_ref");
  if(seen.has(ref))throw new P2StableError("P2_INVALID_INPUT","provider_interface_refs must not contain duplicates");
  seen.add(ref);
 }
 return Object.freeze([...refs]);
}

export const STAGE_CONTRACT_REF="Q.SS.STD.P2.CONTRACT.CROSS_DOMAIN_REALIZATION@V0128" as const;
export const ROLE="provider" as const;
export const CAPABILITY_ID="capability_publishing" as const;
export const OPERATION_ID="publish_capability" as const;

export interface OwnerLocalPublicationPersistencePort{
  persist_publication_record(input:Readonly<{capability_contract_ref:string;publication_hash:string;publication:JsonObject}>):Promise<void>;
  read_publication_record(input:Readonly<{capability_contract_ref:string;publication_hash:string}>):Promise<JsonObject|undefined>;
}

function publicationIdentity(publication:JsonObject):Readonly<{capability_contract_ref:string;publication_hash:string}>{
  if(publication.immutable!==true)throw new P2StableError("P2_PUBLICATION_INVALID","publication must be immutable");
  if(publication.provider_business_runtime_used!==false)throw new P2StableError("P2_PUBLICATION_INVALID","provider business runtime must not be used by P2 publication");
  const capability_contract_ref=exactCapabilityContractRef(publication.capability_contract_ref,"publication.capability_contract_ref");
  const capability_contract_hash=sha256Value(publication.capability_contract_hash,"publication.capability_contract_hash");
  const provider_interface_refs=exactProviderInterfaceRefs(publication.provider_interface_refs,capability_contract_ref);
  const material_set_hash=sha256Value(publication.material_set_hash,"publication.material_set_hash");
  const binding=objectValue(publication.publication_artifact_binding,"publication.publication_artifact_binding");
  if(binding.immutable!==true)throw new P2StableError("P2_IMPLEMENTATION_MATERIAL_INVALID","publication artifact binding must remain immutable");
  const publication_artifact_binding=Object.freeze({
    artifact_ref:stringValue(binding.artifact_ref,"publication.publication_artifact_binding.artifact_ref"),
    content_hash:sha256Value(binding.content_hash,"publication.publication_artifact_binding.content_hash"),
    provider_neutral_locator_binding:stableClone(objectValue(binding.provider_neutral_locator_binding,"publication.publication_artifact_binding.provider_neutral_locator_binding")) as JsonObject,
    entry_symbol_ref:stringValue(binding.entry_symbol_ref,"publication.publication_artifact_binding.entry_symbol_ref"),
    immutable:true,
  });
  const payload=stableClone({capability_contract_ref,capability_contract_hash,provider_interface_refs,material_set_hash,publication_artifact_binding,provider_lineage:publication.provider_lineage,dependency_closure:publication.dependency_closure}) as JsonObject;
  const publication_hash=sha256Value(publication.publication_hash,"publication.publication_hash");
  if(publication_hash!==sha256Json(payload))throw new P2StableError("P2_INTEGRITY_BINDING_INVALID","publication_hash does not bind the exact immutable publication payload");
  return Object.freeze({capability_contract_ref,publication_hash});
}

export async function persist_published_capability_with_owner(publication:JsonObject,persistence:OwnerLocalPublicationPersistencePort):Promise<void>{
  const identity=publicationIdentity(publication);
  await persistence.persist_publication_record(Object.freeze({capability_contract_ref:identity.capability_contract_ref,publication_hash:identity.publication_hash,publication:stableClone(publication) as JsonObject}));
  const readback=await persistence.read_publication_record(Object.freeze({capability_contract_ref:identity.capability_contract_ref,publication_hash:identity.publication_hash}));
  if(readback===undefined||canonical(readback)!==canonical(publication))throw new P2StableError("P2_INTEGRITY_BINDING_INVALID","durable publication exact read-back failed");
  const readbackIdentity=publicationIdentity(readback);
  if(readbackIdentity.capability_contract_ref!==identity.capability_contract_ref||readbackIdentity.publication_hash!==identity.publication_hash)throw new P2StableError("P2_INTEGRITY_BINDING_INVALID","durable publication read-back identity mismatch");
}

export async function handler(request:P2OperationRequest,persistence:OwnerLocalPublicationPersistencePort):Promise<P2OperationResponse>{
  const material_set=objectValue(request.input.material_set,"material_set");
  if(material_set.publication_eligible!==true)throw new P2StableError("P2_PUBLICATION_INVALID","material_set must be publication eligible");
  const capability_contract_ref=exactCapabilityContractRef(material_set.capability_contract_ref,"material_set.capability_contract_ref");
  const capability_contract_hash=sha256Value(material_set.capability_contract_hash,"material_set.capability_contract_hash");
  const provider_interface_refs=exactProviderInterfaceRefs(material_set.provider_interface_refs,capability_contract_ref);
  const material_set_hash=sha256Value(material_set.material_set_hash,"material_set.material_set_hash");
  const supplied=objectValue(request.input.publication_artifact_binding,"publication_artifact_binding");
  if(supplied.immutable!==true)throw new P2StableError("P2_IMPLEMENTATION_MATERIAL_INVALID","publication artifact binding must identify immutable executable implementation material");
  const publication_artifact_binding=Object.freeze({artifact_ref:stringValue(supplied.artifact_ref,"publication_artifact_binding.artifact_ref"),content_hash:sha256Value(supplied.content_hash,"publication_artifact_binding.content_hash"),provider_neutral_locator_binding:stableClone(objectValue(supplied.provider_neutral_locator_binding,"publication_artifact_binding.provider_neutral_locator_binding")) as JsonObject,entry_symbol_ref:stringValue(supplied.entry_symbol_ref,"publication_artifact_binding.entry_symbol_ref"),immutable:true});
  for(const disallowed of ["mutable_repository_path","raw_provider_url","launcher_owned_binding"])if(supplied[disallowed]!==undefined)throw new P2StableError("P2_IMPLEMENTATION_MATERIAL_INVALID",`${disallowed} is not executable publication material`);
  const payload=stableClone({capability_contract_ref,capability_contract_hash,provider_interface_refs,material_set_hash,publication_artifact_binding,provider_lineage:material_set.provider_lineage,dependency_closure:material_set.dependency_closure}) as JsonObject;
  const publication=Object.freeze({...payload,publication_hash:sha256Json(payload),immutable:true,provider_business_runtime_used:false}) as JsonObject;
  await persist_published_capability_with_owner(publication,persistence);
  return success(request,{result_kind:"IMMUTABLE_PUBLICATION",publication});
}
