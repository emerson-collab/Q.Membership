import test from "node:test";
import assert from "node:assert/strict";
import { handler, P2StableError, STAGE_CONTRACT_REF } from "#q/p2/provider/governed_data_exposure/expose_static_data/handler.ts";
import { handler as exposeDynamic } from "#q/p2/provider/governed_data_exposure/expose_dynamic_data/handler.ts";
import { handler as exposeRuntime } from "#q/p2/provider/governed_data_exposure/expose_runtime_data/handler.ts";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { P0_CONTRACT_REF } from "#q/p0/runtime_contract";
import {
  lookup_business_object, register_business_object,
  invoke_business_operation, register_business_operation,
} from "#q/p1/business_runtime/business_operation_registry.ts";
import {
  P1_CONTRACT_REF, P1_RUNTIME_SLOT_REFS,
  project_p1_capability_general_slots, resolve_p1_framework_anchor,
} from "#q/p1/business_runtime/stage_extension_contract.ts";

const baseRequest=(input:Record<string,unknown>)=>({input,runtime_context:{stage_contract_ref:STAGE_CONTRACT_REF},trace_id:"trace-p2",request_id:"request-p2"});
const p2Fields={source_domain_identity:"Q.SOURCE.CONTRACT.DOMAIN@V0100",subject_identity:"subject-1",source_provenance:{source_ref:"Q.SOURCE.FACT@V0100",revision_ref:"rev-1"},source_fact_authority:"Q.SOURCE.CONTRACT.DOMAIN@V0100",governed_access_binding:{authorization_ref:"auth-1"},integrity_binding:{profile_ref:"Q.INTEGRITY.PROFILE@V0100"}};
const exposureRequest={subject_ref:"subject-1",requested_representation:"INLINE_FACT_SET",selection_spec:{scope:"authorized"}};
const envelope={material_ref:"urn:q:material:1",subject_ref:"subject-1",owner_ref:"Q.SOURCE.CONTRACT.DOMAIN@V0100",source_ref:"Q.SOURCE.FACT@V0100",representation_mode:"INLINE_FACT_SET",content_hash:`sha256:${"a".repeat(64)}`,integrity_profile_ref:"Q.INTEGRITY.PROFILE@V0100"};
const sourceBinding={"binding_ref":"Q.TEST.P2.BINDING.STATIC@V0100","data_category":"STATIC","source_operation_ref":"Q.TEST.CONTRACT.CAPABILITY.ANCHOR@V0100#/operations/read_static","source_interface_ref":"Q.TEST.CONTRACT.CAPABILITY.ANCHOR@V0100#/interfaces/static_registry_lookup","source_access_kind":"P1_AUTHORIZED_STATIC_OR_PACKAGE_FACT","source_access_ref":"Q.TEST.P1.STATIC.SOURCE@V0100"};
const anchoredFacts={
  ...sourceBinding,
  source_fact_ref:p2Fields.source_provenance.source_ref,
  source_fact_authority_ref:p2Fields.source_fact_authority,
  facts:{test_only:true,source_category:"STATIC"},
};
const deps={
 async read_authorized_anchor_facts(input:Readonly<Record<string,unknown>>){
   assert.equal(input.data_category,"STATIC");
   assert.deepEqual(input.exact_source_authority,sourceBinding);
   assert.deepEqual(input.governed_access_binding,p2Fields.governed_access_binding);
   return anchoredFacts;
 },
 async materialize_governed_data(input:Readonly<Record<string,unknown>>){
   assert.equal(input.data_category,"STATIC");
   assert.deepEqual(input.authorized_exposure_request,exposureRequest);
   assert.deepEqual(input.integrity_profile,{ref:"Q.INTEGRITY"});
   assert.deepEqual(input.authorized_anchor_facts,anchoredFacts);
   return envelope;
 },
};

test("expose_static_data preserves P2 identity and CURRENT material_envelope",async()=>{
 const response=await handler(baseRequest({...p2Fields,authorized_exposure_request:exposureRequest,exact_source_authority:sourceBinding,owning_persistence_contract:{ref:"Q.DB"},integrity_profile:{ref:"Q.INTEGRITY"},artifact_store_binding:{ref:"Q.ARTIFACT"}}),deps);
 assert.equal(response.runtime_result.data_category,"STATIC");
 assert.equal(response.runtime_result.source_domain_identity,p2Fields.source_domain_identity);
 assert.equal(response.runtime_result.subject_identity,p2Fields.subject_identity);
 assert.deepEqual(response.runtime_result.source_provenance,p2Fields.source_provenance);
 assert.equal(response.runtime_result.source_fact_authority,p2Fields.source_fact_authority);
 assert.deepEqual(response.runtime_result.governed_access_binding,p2Fields.governed_access_binding);
 assert.deepEqual(response.runtime_result.integrity_binding,p2Fields.integrity_binding);
 assert.deepEqual(response.runtime_result.material_envelope,envelope);
});

test("expose_static_data fails closed on invalid governed material request",async()=>{
 await assert.rejects(()=>handler(baseRequest({...p2Fields,authorized_exposure_request:{...exposureRequest,requested_representation:"INVALID"},exact_source_authority:{},owning_persistence_contract:{},integrity_profile:{},artifact_store_binding:{}}),deps),(e:unknown)=>e instanceof P2StableError&&e.code==="P2_GOVERNED_DATA_REPRESENTATION_INVALID");
});

test("expose_static_data rejects an unauthorized or mismatched Anchor fact without materializing",async()=>{
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

test("expose_static_data refuses unbound authorized Anchor access",async()=>{
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


/**
 * Test-only proof of the actual existing P1 Anchor routes -> P2 Provider
 * three-category materialization path. No Member V0104 production authorization
 * is claimed: its current governed_data_exposure.mode remains NONE.
 * No new Q-wide field/protocol or P1 expose operation is created.
 */
test("P2 Anchors -> three verified category facts -> three test-only JSON files", async () => {
  const sourceContract = "Q.TEST.CONTRACT.CAPABILITY.ANCHOR_TRIAD@V0100";
  const contractHash = `sha256:${"b".repeat(64)}`;
  const operationId = "runtime_receipt_source";
  const operationRef = `${sourceContract}#/operations/${operationId}`;
  const general = project_p1_capability_general_slots({
    capability_ref: "Q.TEST.CAPABILITY.ANCHOR_TRIAD@V0100",
    capability_id: "anchor_triad_test",
    capability_version: "V0100",
    capability_contract_ref: sourceContract,
    capability_contract_content_hash: contractHash, // TEST-ONLY synthetic digest
    stage_contract_ref: P1_CONTRACT_REF,
    runtime_contract_ref: P0_CONTRACT_REF,
    operation_id: operationId,
    operation_ref: operationRef,
    interface_ref: `${sourceContract}#/interfaces/runtime_receipt_source_invoke`,
    surface: "CALL",
    kind: "CALL_INVOKE",
    method_ref: operationId,
  });
  const slots = {
    manifest: {slot_ref:P1_RUNTIME_SLOT_REFS.manifest,value:{capability_ref:general.capability_ref.value}},
    qreg: {slot_ref:P1_RUNTIME_SLOT_REFS.qreg,value:{capability_contract_ref:sourceContract}},
    qconfig: {slot_ref:P1_RUNTIME_SLOT_REFS.qconfig,value:{}},
    operation_contract: {slot_ref:P1_RUNTIME_SLOT_REFS.operation_contract,value:operationRef},
    policy_refs: {slot_ref:P1_RUNTIME_SLOT_REFS.policy_refs,value:[]},
    hook_binding_refs: {slot_ref:P1_RUNTIME_SLOT_REFS.hook_binding_refs,value:[]},
  };
  let actualP0OperationAttempts = 0;
  register_business_operation(
    general,
    async () => {
      actualP0OperationAttempts++;
      return {proof:"P0_ACTUAL_EXECUTION",revision_ref:"test:runtime-revision"};
    },
    slots,
    async (_input, ctx) => ({
      authorization_receipt: {
        test_only: true,
        completed_before_operation: true,
        operation_ref: ctx.operation_ref,
        trace_id: ctx.trace_id,
        request_id: ctx.request_id,
      },
    }),
  );
  const runtimeContext = {
    stage_contract_ref:P1_CONTRACT_REF,
    operation_ref:operationRef,
    trace_id:"test:triad:trace",
    request_id:"test:triad:request",
    invocation_id:"test:triad:invocation",
    binding_set_ref:"test:triad:binding",
  };
  const callAnchor = resolve_p1_framework_anchor({
    surface:"CALL",kind:"CALL_INVOKE",method_ref:operationId,
  });
  assert.equal(callAnchor.framework_entry_method_ref,"invoke_business_operation");
  const alreadyProducedRuntime = await invoke_business_operation({
    route_key:operationRef,
    capability_id:"anchor_triad_test",
    operation_id:operationId,
    trace_id:runtimeContext.trace_id,
    request_id:runtimeContext.request_id,
  },{source:"test-runtime"},runtimeContext);
  assert.equal(alreadyProducedRuntime.outcome_type,"response");
  if(alreadyProducedRuntime.outcome_type!=="response")throw Error("Expected actual P0 invocation");
  assert.equal(alreadyProducedRuntime.execution_receipt.operation_attempts,1);
  assert.equal(actualP0OperationAttempts,1);

  // STATIC/DYNAMIC are read via actual P1 Registry Anchor methods.
  const staticRegistryRef="Q.TEST.P1.ANCHOR_TRIAD.STATIC@V0100";
  const dynamicRegistryRef="Q.TEST.P1.ANCHOR_TRIAD.DYNAMIC@V0100";
  const staticValue={contract_ref:sourceContract,revision_ref:"test:static-v1",test_only:true};
  const dynamicValue={state:"test-current-value",source_revision_ref:"test:dynamic-r1",test_only:true};
  assert.equal(register_business_object(staticRegistryRef,staticValue,{test_only:true}).outcome_type,"registration_receipt");
  assert.equal(register_business_object(dynamicRegistryRef,dynamicValue,{test_only:true}).outcome_type,"registration_receipt");
  const registryAnchor=resolve_p1_framework_anchor({
    surface:"REGISTRY",kind:"REGISTRY_LOOKUP",method_ref:"lookup_business_object",
  });
  assert.equal(registryAnchor.framework_entry_method_ref,"lookup_business_object");

  const kinds = {
    STATIC:"P1_AUTHORIZED_STATIC_OR_PACKAGE_FACT",
    DYNAMIC:"AUTHORIZED_GOVERNED_STATE_OR_REGISTRY_FACT",
    RUNTIME:"ALREADY_PRODUCED_RUNTIME_FACT",
  };
  const accessRefs = {
    STATIC:staticRegistryRef,
    DYNAMIC:dynamicRegistryRef,
    RUNTIME:"Q.TEST.P1.ANCHOR_TRIAD.PREVIOUS_RUNTIME@V0100",
  };
  const bindings=Object.fromEntries(["STATIC","DYNAMIC","RUNTIME"].map(category=>[
    category,{
      binding_ref:`Q.TEST.BINDING.ANCHOR_TRIAD.${category}@V0100`,
      data_category:category,
      source_operation_ref:`${sourceContract}#/operations/${category.toLowerCase()}_source`,
      source_interface_ref:`${sourceContract}#/interfaces/${category.toLowerCase()}_source_invoke`,
      source_access_kind:kinds[category as keyof typeof kinds],
      source_access_ref:accessRefs[category as keyof typeof accessRefs],
    }
  ])) as Record<string,Readonly<Record<string,unknown>>>;

  const externalOutputDir=process.env.P2_ANCHOR_TRIAD_DEMO_DIR;
  const outputDir=externalOutputDir??mkdtempSync(join(tmpdir(),"q-p2-anchor-test-"));
  mkdirSync(outputDir,{recursive:true});
  const materializedCategories:string[]=[];
  const actualAnchorReads:string[]=[];
  const sha=(value:unknown)=>"sha256:"+createHash("sha256").update(JSON.stringify(value)).digest("hex");

  function depsFor(category:"STATIC"|"DYNAMIC"|"RUNTIME"){
    const binding=bindings[category]!;
    return {
      async read_authorized_anchor_facts(input:Readonly<Record<string,unknown>>){
        assert.equal(input.data_category,category);
        assert.equal((input.governed_access_binding as Record<string,unknown>).authorization_ref,
          "test:approved-owner-access"); // Test-only authorization fixture
        assert.deepEqual(input.exact_source_authority,binding);
        actualAnchorReads.push(category);
        let facts:unknown;
        if(category==="RUNTIME"){
          // Read a P0 result produced BEFORE P2 exposure; never call P0 again.
          facts=alreadyProducedRuntime;
        }else{
          const result=lookup_business_object(String(binding.source_access_ref));
          assert.equal(result.outcome_type,"lookup_result");
          if(result.outcome_type!=="lookup_result"||result.lookup_result===null)
            throw Error("P1 Registry source was not registered");
          facts=result.lookup_result.object_contract;
        }
        return {
          ...binding,
          source_fact_ref:`Q.TEST.P1.${category}.FACT@V0100`,
          source_fact_authority_ref:sourceContract,
          facts,
        };
      },
      async materialize_governed_data(input:Readonly<Record<string,unknown>>){
        assert.equal(input.data_category,category);
        const anchored=input.authorized_anchor_facts as Record<string,unknown>;
        assert.equal(anchored.data_category,category);
        assert.equal(anchored.source_access_ref,binding.source_access_ref);
        const envelope={
          material_ref:`urn:q:test:material:${category.toLowerCase()}`,
          subject_ref:"subject:anchor-triad-test",
          owner_ref:sourceContract,
          source_ref:anchored.source_fact_ref,
          representation_mode:"INLINE_FACT_SET",
          content_hash:sha(anchored.facts),
          integrity_profile_ref:"Q.TEST.INTEGRITY@V0100",
        };
        const testOnlyArtifact={
          capability_contract_ref:sourceContract,
          capability_contract_content_hash:contractHash,
          p2_contract_ref:STAGE_CONTRACT_REF,
          data_category:category,
          bindings:[binding],
          material_envelopes:[envelope],
          // Diagnostic only: governed inline material bytes must be finalized
          // under the exact GDM schema before production/triad commit.
          test_only_authorized_facts:anchored.facts,
        };
        const filename=category.toLowerCase()+".json";
        const serialized=JSON.stringify(testOnlyArtifact,null,2)+"\n";
        writeFileSync(join(outputDir,filename),serialized);
        const readback=readFileSync(join(outputDir,filename),"utf8");
        assert.equal(sha(readback),sha(serialized));
        assert.deepEqual(JSON.parse(readback).test_only_authorized_facts,anchored.facts);
        materializedCategories.push(category);
        return envelope;
      },
    };
  }
  const makeRequest=(category:"STATIC"|"DYNAMIC"|"RUNTIME")=>({
    input:{
      source_domain_identity:sourceContract,
      subject_identity:"subject:anchor-triad-test",
      source_provenance:{source_ref:`Q.TEST.P1.${category}.FACT@V0100`,revision_ref:"test:source-revision"},
      source_fact_authority:sourceContract,
      governed_access_binding:{authorization_ref:"test:approved-owner-access"},
      integrity_binding:{profile_ref:"Q.TEST.INTEGRITY@V0100"},
      authorized_exposure_request:{
        subject_ref:"subject:anchor-triad-test",
        requested_representation:"INLINE_FACT_SET",
        selection_spec:{test_only:true},
      },
      exact_source_authority:bindings[category],
      owning_persistence_contract:{test_only:true},
      integrity_profile:{ref:"Q.TEST.INTEGRITY@V0100"},
      artifact_store_binding:{test_only:true},
    },
    runtime_context:{stage_contract_ref:STAGE_CONTRACT_REF},
    trace_id:"test:provider:trace",
    request_id:"test:provider:request",
  });
  try{
    const a=await handler(makeRequest("STATIC"),depsFor("STATIC"));
    const b=await exposeDynamic(makeRequest("DYNAMIC"),depsFor("DYNAMIC"));
    const c=await exposeRuntime(makeRequest("RUNTIME"),depsFor("RUNTIME"));
    assert.deepEqual([a.runtime_result.data_category,b.runtime_result.data_category,c.runtime_result.data_category],
      ["STATIC","DYNAMIC","RUNTIME"]);
    assert.deepEqual(actualAnchorReads,["STATIC","DYNAMIC","RUNTIME"]);
    assert.deepEqual(materializedCategories,["STATIC","DYNAMIC","RUNTIME"]);
    assert.equal(actualP0OperationAttempts,1,"P2 must never execute P0 again");
    assert.deepEqual(readdirSync(outputDir).filter(x=>x.endsWith(".json")).sort(),
      ["dynamic.json","runtime.json","static.json"]);
    assert.deepEqual(JSON.parse(readFileSync(join(outputDir,"static.json"),"utf8")).test_only_authorized_facts,
      staticValue);
    assert.deepEqual(JSON.parse(readFileSync(join(outputDir,"dynamic.json"),"utf8")).test_only_authorized_facts,
      dynamicValue);
    assert.equal(JSON.parse(readFileSync(join(outputDir,"runtime.json"),"utf8")).test_only_authorized_facts.outcome_type,
      "response");
    console.log("P2_ANCHOR_TRIAD_TEST_ONLY "+outputDir);
  }finally{
    if(!externalOutputDir)rmSync(outputDir,{recursive:true,force:true});
  }
});
