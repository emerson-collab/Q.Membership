import test from "node:test";
import assert from "node:assert/strict";
import { handler as createHandler } from "#q/p2/provider/capability_publishing/create_material_set/handler.ts";
import { handler,P2StableError,STAGE_CONTRACT_REF } from "#q/p2/provider/capability_publishing/publish_capability/handler.ts";

const baseRequest=(input:Record<string,unknown>)=>({input,runtime_context:{stage_contract_ref:STAGE_CONTRACT_REF},trace_id:"trace-p2",request_id:"request-p2"});
const contractRef="Q.EXAMPLE.CONTRACT.CAPABILITY.EXAMPLE@V0100";
const interfaceRef=`${contractRef}#/interfaces/example_invoke`;
const artifact={artifact_ref:"Q.CAPABILITY_PACKAGE.EXAMPLE.EXAMPLE@V0100#/implementation_material",content_hash:`sha256:${"c".repeat(64)}`,entry_symbol_ref:"src/p1/export/example/entry.ts#entry",immutable:true,provider_neutral_locator_binding:{object_id:"immutable-1"}};

function durableStore(options?:{tamperReadback?:boolean}){
  const records=new Map<string,Record<string,unknown>>();
  let writes=0;
  let reads=0;
  return {
    get writes(){return writes;},
    get reads(){return reads;},
    async persist_publication_record({capability_contract_ref,publication_hash,publication}:{capability_contract_ref:string;publication_hash:string;publication:Readonly<Record<string,unknown>>}){
      writes+=1;
      records.set(`${capability_contract_ref}|${publication_hash}`,structuredClone(publication) as Record<string,unknown>);
    },
    async read_publication_record({capability_contract_ref,publication_hash}:{capability_contract_ref:string;publication_hash:string}){
      reads+=1;
      const value=records.get(`${capability_contract_ref}|${publication_hash}`);
      if(value===undefined)return undefined;
      return options?.tamperReadback===true?{...value,provider_business_runtime_used:true}:structuredClone(value);
    },
  };
}

async function materialSet(){
  const cr=await createHandler(baseRequest({capability_contract_ref:contractRef,capability_contract_hash:`sha256:${"a".repeat(64)}`,provider_interface_refs:[interfaceRef],materials:[{path:"src/p1/export/example/entry.ts",content_hash:`sha256:${"b".repeat(64)}`}],provider_lineage:["Q.EXAMPLE.CONTRACT.DOMAIN@V0100"],dependency_closure:[]}));
  return cr.runtime_result.material_set as Record<string,unknown>;
}

test("publish_capability durably writes Capability plus exact Provider surface before response",async()=>{
  const store=durableStore();
  const material_set=await materialSet();
  const pr=await handler(baseRequest({material_set,publication_artifact_binding:artifact}),store);
  const publication=pr.runtime_result.publication as Record<string,unknown>;
  assert.equal(store.writes,1);
  assert.equal(store.reads,1);
  assert.deepEqual(publication.publication_artifact_binding,artifact);
  assert.deepEqual(publication.provider_interface_refs,[interfaceRef]);
  assert.equal(publication.implementation_material_binding,undefined);
  assert.match(String(publication.publication_hash),/^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(publication.provider_lineage,material_set.provider_lineage);
});

test("publish_capability fails closed without immutable executable artifact",async()=>{
  const store=durableStore();
  await assert.rejects(()=>handler(baseRequest({material_set:{publication_eligible:true,capability_contract_ref:contractRef,capability_contract_hash:`sha256:${"a".repeat(64)}`,provider_interface_refs:[interfaceRef],material_set_hash:`sha256:${"b".repeat(64)}`},publication_artifact_binding:{immutable:false}}),store),(e:unknown)=>e instanceof P2StableError);
  assert.equal(store.writes,0);
});

test("publish_capability fails closed on durable publication read-back mismatch",async()=>{
  const store=durableStore({tamperReadback:true});
  const material_set=await materialSet();
  await assert.rejects(()=>handler(baseRequest({material_set,publication_artifact_binding:artifact}),store),(e:unknown)=>e instanceof P2StableError&&e.code==="P2_INTEGRITY_BINDING_INVALID");
  assert.equal(store.writes,1);
  assert.equal(store.reads,1);
});
