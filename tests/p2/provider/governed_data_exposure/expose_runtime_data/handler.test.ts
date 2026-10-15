import test from "node:test";
import assert from "node:assert/strict";
import { handler, P2StableError, STAGE_CONTRACT_REF } from "#q/p2/provider/governed_data_exposure/expose_runtime_data/handler.ts";

const baseRequest=(input:Record<string,unknown>)=>({input,runtime_context:{stage_contract_ref:STAGE_CONTRACT_REF},trace_id:"trace-p2",request_id:"request-p2"});
const p2Fields={source_domain_identity:"Q.SOURCE.CONTRACT.DOMAIN@V0100",subject_identity:"subject-1",source_provenance:{source_ref:"Q.SOURCE.FACT@V0100",revision_ref:"rev-1"},source_fact_authority:"Q.SOURCE.CONTRACT.DOMAIN@V0100",governed_access_binding:{authorization_ref:"auth-1"},integrity_binding:{profile_ref:"Q.INTEGRITY.PROFILE@V0100"}};
const exposureRequest={subject_ref:"subject-1",requested_representation:"ARTIFACT_CHUNKED_SNAPSHOT",selection_spec:{scope:"authorized"}};
const envelope={material_ref:"urn:q:material:1",subject_ref:"subject-1",owner_ref:"Q.SOURCE.CONTRACT.DOMAIN@V0100",source_ref:"Q.SOURCE.FACT@V0100",representation_mode:"ARTIFACT_CHUNKED_SNAPSHOT",content_hash:`sha256:${"a".repeat(64)}`,integrity_profile_ref:"Q.INTEGRITY.PROFILE@V0100"};
const sourceBinding={"binding_ref":"Q.TEST.P2.BINDING.RUNTIME@V0100","data_category":"RUNTIME","source_operation_ref":"Q.TEST.CONTRACT.CAPABILITY.ANCHOR@V0100#/operations/read_runtime_snapshot","source_interface_ref":"Q.TEST.CONTRACT.CAPABILITY.ANCHOR@V0100#/interfaces/runtime_fact_read","source_access_kind":"ALREADY_PRODUCED_RUNTIME_FACT","source_access_ref":"Q.TEST.P1.RUNTIME.SOURCE@V0100"};
const anchoredFacts={
  ...sourceBinding,
  source_fact_ref:p2Fields.source_provenance.source_ref,
  source_fact_authority_ref:p2Fields.source_fact_authority,
  facts:{test_only:true,source_category:"RUNTIME"},
};
const deps={
 async read_authorized_anchor_facts(input:Readonly<Record<string,unknown>>){
   assert.equal(input.data_category,"RUNTIME");
   assert.deepEqual(input.exact_source_authority,sourceBinding);
   assert.deepEqual(input.governed_access_binding,p2Fields.governed_access_binding);
   return anchoredFacts;
 },
 async materialize_governed_data(input:Readonly<Record<string,unknown>>){
   assert.equal(input.data_category,"RUNTIME");
   assert.deepEqual(input.authorized_exposure_request,exposureRequest);
   assert.deepEqual(input.integrity_profile,{ref:"Q.INTEGRITY"});
   assert.deepEqual(input.authorized_anchor_facts,anchoredFacts);
   return envelope;
 },
};

test("expose_runtime_data preserves P2 identity and CURRENT material_envelope",async()=>{
 const response=await handler(baseRequest({...p2Fields,authorized_exposure_request:exposureRequest,exact_source_authority:sourceBinding,owning_persistence_contract:{ref:"Q.DB"},integrity_profile:{ref:"Q.INTEGRITY"},artifact_store_binding:{ref:"Q.ARTIFACT"},reexecution_requested:false}),deps);
 assert.equal(response.runtime_result.data_category,"RUNTIME");
 assert.equal(response.runtime_result.source_domain_identity,p2Fields.source_domain_identity);
 assert.equal(response.runtime_result.subject_identity,p2Fields.subject_identity);
 assert.deepEqual(response.runtime_result.source_provenance,p2Fields.source_provenance);
 assert.equal(response.runtime_result.source_fact_authority,p2Fields.source_fact_authority);
 assert.deepEqual(response.runtime_result.governed_access_binding,p2Fields.governed_access_binding);
 assert.deepEqual(response.runtime_result.integrity_binding,p2Fields.integrity_binding);
 assert.deepEqual(response.runtime_result.material_envelope,envelope);
});

test("expose_runtime_data fails closed on provider reexecution",async()=>{
 await assert.rejects(()=>handler(baseRequest({...p2Fields,authorized_exposure_request:exposureRequest,exact_source_authority:{},owning_persistence_contract:{},integrity_profile:{},artifact_store_binding:{},reexecution_requested:true}),deps),(e:unknown)=>e instanceof P2StableError&&e.code==="P2_RUNTIME_DATA_REEXECUTION_FORBIDDEN");
});

test("expose_runtime_data rejects an unauthorized or mismatched Anchor fact without materializing",async()=>{
 let writes=0;
 const bad={
   ...deps,
   async read_authorized_anchor_facts(){return {...anchoredFacts,source_interface_ref:"Q.TEST.FOREIGN.INTERFACE@V0100"};},
   async materialize_governed_data(){writes++;return envelope;},
 };
 await assert.rejects(
   ()=>handler(baseRequest({...p2Fields,authorized_exposure_request:exposureRequest,
     exact_source_authority:sourceBinding,owning_persistence_contract:{ref:"Q.DB"},
     integrity_profile:{ref:"Q.INTEGRITY"},artifact_store_binding:{ref:"Q.ARTIFACT"}}),bad),
   (error:unknown)=>error instanceof P2StableError&&error.code==="P2_GOVERNED_DATA_BINDING_MISMATCH",
 );
 assert.equal(writes,0);
});

test("expose_runtime_data refuses unbound authorized Anchor access",async()=>{
 const missing={
   materialize_governed_data:deps.materialize_governed_data,
 };
 await assert.rejects(
   ()=>handler(baseRequest({...p2Fields,authorized_exposure_request:exposureRequest,
     exact_source_authority:sourceBinding,owning_persistence_contract:{ref:"Q.DB"},
     integrity_profile:{ref:"Q.INTEGRITY"},artifact_store_binding:{ref:"Q.ARTIFACT"}}),missing as never),
   (error:unknown)=>error instanceof P2StableError&&error.code==="P2_GOVERNED_DATA_BINDING_MISMATCH",
 );
});
