import test from "node:test";
import assert from "node:assert/strict";
import { handler as exposeHandler } from "#q/p2/provider/governed_data_exposure/expose_dynamic_data/handler.ts";
import { handler, P2StableError, STAGE_CONTRACT_REF } from "#q/p2/consumer/governed_data_consumption/consume_dynamic_data/handler.ts";

const baseRequest=(input:Record<string,unknown>)=>({input,runtime_context:{stage_contract_ref:STAGE_CONTRACT_REF},trace_id:"trace-p2",request_id:"request-p2"});
const p2Fields={source_domain_identity:"Q.SOURCE.CONTRACT.DOMAIN@V0100",subject_identity:"subject-1",source_provenance:{source_ref:"Q.SOURCE.FACT@V0100",revision_ref:"rev-1"},source_fact_authority:"Q.SOURCE.CONTRACT.DOMAIN@V0100",governed_access_binding:{authorization_ref:"auth-1"},integrity_binding:{profile_ref:"Q.INTEGRITY.PROFILE@V0100"}};
const exposureRequest={subject_ref:"subject-1",requested_representation:"ARTIFACT_CHUNKED_SNAPSHOT",selection_spec:{scope:"authorized"}};
const envelope={material_ref:"urn:q:material:1",subject_ref:"subject-1",owner_ref:"Q.SOURCE.CONTRACT.DOMAIN@V0100",source_ref:"Q.SOURCE.FACT@V0100",representation_mode:"ARTIFACT_CHUNKED_SNAPSHOT",content_hash:`sha256:${"a".repeat(64)}`,integrity_profile_ref:"Q.INTEGRITY.PROFILE@V0100",snapshot_ref:"urn:q:snapshot:1",manifest_ref:"urn:q:manifest:1"};
const exposureDeps={async materialize_governed_data(){return envelope;}};

test("expose_dynamic_data→consume_dynamic_data preserves P2 governance and CURRENT material identity",async()=>{
 const exposed=await exposeHandler(baseRequest({...p2Fields,authorized_exposure_request:exposureRequest,exact_source_authority:{ref:"Q.SOURCE"},owning_persistence_contract:{ref:"Q.DB"},integrity_profile:{ref:"Q.INTEGRITY"},artifact_store_binding:{ref:"Q.ARTIFACT"}}),exposureDeps);
 const governed_data_material=exposed.runtime_result as Record<string,unknown>;
 let calls=0; const artifactResolver={store_ref:"Q.ARTIFACT"}; const consumerBinding={authorization_ref:"auth-1"};
 const consumed=await handler(baseRequest({governed_data_material,consumer_binding:consumerBinding,artifact_store_resolver:artifactResolver}),{async consume_governed_data(input){calls+=1;assert.equal(input.data_category,"DYNAMIC");assert.deepEqual(input.governed_material_envelope,envelope);assert.deepEqual(input.consumer_binding,consumerBinding);assert.deepEqual(input.artifact_store_resolver,artifactResolver);return {delivered:true};}});
 assert.equal(calls,1);
 const binding=consumed.runtime_result.data_consumption_binding as Record<string,unknown>;
 assert.equal(binding.data_category,"DYNAMIC"); assert.equal(binding.source_domain_identity,p2Fields.source_domain_identity); assert.equal(binding.subject_identity,p2Fields.subject_identity); assert.deepEqual(binding.source_provenance,p2Fields.source_provenance); assert.equal(binding.source_fact_authority,p2Fields.source_fact_authority); assert.deepEqual(binding.governed_access_binding,p2Fields.governed_access_binding); assert.deepEqual(binding.integrity_binding,p2Fields.integrity_binding); assert.equal(binding.material_ref,envelope.material_ref); assert.equal(binding.content_hash,envelope.content_hash); assert.deepEqual(binding.consumption_result,{delivered:true}); assert.equal(binding.full_memory_assembly_required,false); assert.equal(binding.creates_evidence_or_gate_result,false);
});

test("consume_dynamic_data fails closed when preserved P2 identity is missing",async()=>{
 const governed_data_material={result_kind:"GOVERNED_DATA_EXPOSURE",data_category:"DYNAMIC",...p2Fields,material_envelope:envelope} as Record<string,unknown>; delete governed_data_material.source_fact_authority;
 await assert.rejects(()=>handler(baseRequest({governed_data_material,consumer_binding:{authorization_ref:"auth-1"},artifact_store_resolver:{store_ref:"Q.ARTIFACT"}}),{async consume_governed_data(){return {};}}),(e:unknown)=>e instanceof P2StableError);
});
