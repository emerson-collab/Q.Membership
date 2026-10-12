import assert from "node:assert/strict";
import test from "node:test";
import { P0_CONTRACT_REF } from "../../../src/p0/runtime_contract.ts";
import {
  P1_CAPABILITY_GENERAL_SLOT_REFS,
  P1_CONTRACT_REF,
  P1_FRAMEWORK_ANCHOR_CROSSWALK,
  create_p1_capability_stage_extension,
  project_p1_capability_general_slots,
  resolve_p1_framework_anchor,
} from "../../../src/p1/business_runtime/stage_extension_contract.ts";

const CAPABILITY_REF = "Q.TEST.CAPABILITY.EXAMPLE@V0100";
const CAPABILITY_CONTRACT_REF = "Q.TEST.CONTRACT.CAPABILITY.EXAMPLE@V0100";
const OPERATION_ID = "read_example";
const OPERATION_REF = `${CAPABILITY_CONTRACT_REF}#/operations/${OPERATION_ID}`;
const INTERFACE_REF = `${CAPABILITY_CONTRACT_REF}#/interfaces/read_example`;

function slots() {
  return project_p1_capability_general_slots({
    capability_ref: CAPABILITY_REF,
    capability_id: "example",
    capability_version: "V0100",
    capability_contract_ref: CAPABILITY_CONTRACT_REF,
    capability_contract_content_hash: `sha256:${"a".repeat(64)}`,
    stage_contract_ref: P1_CONTRACT_REF,
    runtime_contract_ref: P0_CONTRACT_REF,
    operation_id: OPERATION_ID,
    operation_ref: OPERATION_REF,
    interface_ref: INTERFACE_REF,
    surface: "CALL",
    kind: "CALL_INVOKE",
    method_ref: "invoke_business_operation",
  });
}

test("V0186 GENERAL facts project only into exact predeclared P1 slot identities", () => {
  const projection = slots();
  for (const [slotId, slotRef] of Object.entries(P1_CAPABILITY_GENERAL_SLOT_REFS)) {
    const binding = projection[slotId as keyof typeof projection];
    assert.equal(binding.slot_ref, slotRef);
  }
  assert.equal(projection.operation_ref.value, OPERATION_REF);
  assert.equal(Object.isFrozen(projection), true);
});

test("StageExtension consumes the exact bound slots directly with no runtime binder", () => {
  const projection = slots();
  const extension = create_p1_capability_stage_extension({
    general_slots: projection,
    implementation_ref: CAPABILITY_CONTRACT_REF,
    provided_interface_refs: [INTERFACE_REF],
  });

  assert.equal(extension.status, "active");
  assert.equal(extension.stage_contract_ref, P1_CONTRACT_REF);
  assert.equal(extension.implementation_ref, CAPABILITY_CONTRACT_REF);
  assert.deepEqual(extension.provided_interface_refs, [INTERFACE_REF]);
});

test("StageExtension rejects field-name-only or wrong slot identity drift", () => {
  const projection = slots();
  const drifted = {
    ...projection,
    operation_ref: {
      slot_ref: "operation_ref",
      value: OPERATION_REF,
    },
  } as typeof projection;

  assert.throws(
    () => create_p1_capability_stage_extension({
      general_slots: drifted,
      implementation_ref: CAPABILITY_CONTRACT_REF,
      provided_interface_refs: [INTERFACE_REF],
    }),
    /exact predeclared P1 V0186 slot_ref/,
  );
});


test("V0186 framework-anchor crosswalk closes all eight supported concrete Interface kinds", () => {
  const cases = [
    ["CALL", "CALL_INVOKE", "read_example", "invoke_business_operation"],
    ["HOOK", "HOOK_BIND", "bind_example", "bind_business_hook"],
    ["HOOK", "HOOK_EVALUATE", "evaluate_example", "evaluate_business_hook"],
    ["EVENT", "EVENT_PUBLISH", "publish_business_event", "publish_business_event"],
    ["EVENT", "EVENT_CONSUME", "consume_business_event", "consume_business_event"],
    ["REGISTRY", "REGISTRY_REGISTER", "register_example", "register_business_object"],
    ["REGISTRY", "REGISTRY_RESOLVE", "resolve_example", "resolve_business_object"],
    ["REGISTRY", "REGISTRY_LOOKUP", "lookup_example", "lookup_business_object"],
  ] as const;

  assert.equal(Object.keys(P1_FRAMEWORK_ANCHOR_CROSSWALK).length, 8);
  for (const [surface, kind, method_ref, framework_entry_method_ref] of cases) {
    const anchor = resolve_p1_framework_anchor({ surface, kind, method_ref });
    assert.equal(anchor.surface, surface);
    assert.equal(anchor.kind, kind);
    assert.equal(anchor.framework_entry_method_ref, framework_entry_method_ref);
    assert.match(anchor.framework_interface_ref, /Q\.SS\.STD\.P1\.CONTRACT\.BUSINESS_RUNTIME@V0186#\/interfaces\//);
  }
});

test("CALL concrete method_ref remains separate from the framework entry method", () => {
  const anchor = resolve_p1_framework_anchor({
    surface: "CALL",
    kind: "CALL_INVOKE",
    method_ref: "read_example",
  });
  assert.equal(anchor.framework_entry_method_ref, "invoke_business_operation");
  assert.notEqual("read_example", anchor.framework_entry_method_ref);
});

test("EVENT preserves the existing P1 method equality rule", () => {
  assert.throws(
    () => resolve_p1_framework_anchor({
      surface: "EVENT",
      kind: "EVENT_CONSUME",
      method_ref: "custom_consume",
    }),
    /EVENT concrete method_ref must equal/,
  );
});

test("unknown Surface/Kind cannot create or infer a new framework anchor", () => {
  assert.throws(
    () => resolve_p1_framework_anchor({
      surface: "REGISTRY",
      kind: "REGISTRY_WATCH",
      method_ref: "watch_business_object",
    }),
    /must resolve exactly one pre-existing P1 V0186 framework anchor/,
  );
});
