import { createHash } from "node:crypto";

export type JsonObject = Readonly<Record<string, unknown>>;
export interface P2OperationRequest { readonly input: JsonObject; readonly runtime_context: JsonObject; readonly trace_id: string; readonly request_id: string; }
export interface P2OperationResponse { readonly outcome_type: "response"; readonly runtime_result: JsonObject; readonly trace_id: string; readonly request_id: string; }
export class P2StableError extends Error { readonly code:string; constructor(code:string,message:string){super(message);this.name="P2StableError";this.code=code;} }
function stringValue(value:unknown,field:string):string{if(typeof value!=="string"||value.length===0)throw new P2StableError("P2_INVALID_INPUT",`${field} must be a non-empty string`);return value;}
function sha256Value(value:unknown,field:string):string{const text=stringValue(value,field);if(!/^sha256:[0-9a-f]{64}$/.test(text))throw new P2StableError("P2_INTEGRITY_BINDING_INVALID",`${field} must be an exact sha256 binding`);return text;}
function arrayValue(value:unknown,field:string):readonly unknown[]{if(!Array.isArray(value))throw new P2StableError("P2_INVALID_INPUT",`${field} must be an array`);return value;}
function stableClone(value:unknown):unknown{if(Array.isArray(value))return Object.freeze(value.map(stableClone));if(value!==null&&typeof value==="object"){const source=value as Record<string,unknown>;const out:Record<string,unknown>={};for(const key of Object.keys(source).sort())out[key]=stableClone(source[key]);return Object.freeze(out);}return value;}
function canonical(value:unknown):string{return JSON.stringify(stableClone(value));}
function sha256Json(value:unknown):string{return `sha256:${createHash("sha256").update(canonical(value),"utf8").digest("hex")}`;}
function success(request:P2OperationRequest,runtime_result:JsonObject):P2OperationResponse{return Object.freeze({outcome_type:"response" as const,runtime_result:Object.freeze({...runtime_result}),trace_id:request.trace_id,request_id:request.request_id});}
function exactProviderInterfaceRefs(value:unknown,capabilityContractRef:string):readonly string[]{
 const values=arrayValue(value,"provider_interface_refs");
 if(values.length===0)throw new P2StableError("P2_INVALID_INPUT","provider_interface_refs must be non-empty");
 const refs=values.map((item,index)=>stringValue(item,`provider_interface_refs[${index}]`));
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
export const OPERATION_ID="create_material_set" as const;

export async function handler(request:P2OperationRequest):Promise<P2OperationResponse>{
 const capability_contract_ref=stringValue(request.input.capability_contract_ref,"capability_contract_ref");
 if(!/@V\d{4}$/.test(capability_contract_ref))throw new P2StableError("P2_CAPABILITY_CONTRACT_INVALID","capability_contract_ref must be exact-versioned");
 const capability_contract_hash=sha256Value(request.input.capability_contract_hash,"capability_contract_hash");
 const provider_interface_refs=exactProviderInterfaceRefs(request.input.provider_interface_refs,capability_contract_ref);
 const materials=arrayValue(request.input.materials,"materials");
 const provider_lineage=arrayValue(request.input.provider_lineage,"provider_lineage");
 if(materials.length===0||provider_lineage.length===0)throw new P2StableError("P2_MATERIAL_SET_INVALID","materials and provider_lineage must be non-empty");
 const dependency_closure=arrayValue(request.input.dependency_closure??[],"dependency_closure");
 const payload=stableClone({capability_contract_ref,capability_contract_hash,provider_interface_refs,materials,dependency_closure,provider_lineage}) as JsonObject;
 return success(request,{result_kind:"MATERIAL_SET",material_set:Object.freeze({...payload,material_set_hash:sha256Json(payload),publication_eligible:true,provider_business_runtime_used:false})});
}
