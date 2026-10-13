import assert from "node:assert/strict";
import test from "node:test";
import { P0_CONTRACT_REF, P0_BIND_INTERFACE_REF, P0_EVALUATE_INTERFACE_REF } from "#q/p0/runtime_contract";
import type { HookBinding, RuntimeContext } from "#q/p0/runtime_contract";
import {
  consume_business_event,
  invoke_business_operation,
  invoke_internal_call,
  publish_business_event,
  register_business_event_interface,
  register_business_operation as register_concrete_business_operation,
  register_business_object,
  resolve_business_object,
  lookup_business_object,
  bind_business_hook,
  evaluate_business_hook,
  register_business_dependency_client,
  invoke_dependency,
  register_internal_business_operation,
  registered_business_operation_routes,
  resolve_business_operation,
} from "../../../src/p1/business_runtime/business_operation_registry.ts";
import type { BusinessOperationAuthorization, BusinessOperationHandler, BusinessOperationOutcome, P1StaticRuntimeSlotProjection } from "../../../src/p1/business_runtime/business_operation_registry.ts";
import type { P1CapabilityGeneralSlotProjection, P1InterfaceSurface, P1InterfaceKind } from "../../../src/p1/business_runtime/stage_extension_contract.ts";
import {
  P1_CONTRACT_REF,
  P1_RUNTIME_SLOT_REFS,
  project_p1_capability_general_slots,
} from "../../../src/p1/business_runtime/stage_extension_contract.ts";

const CAPABILITY_REF = "Q.TEST.CAPABILITY.EXAMPLE@V0100";
const CAPABILITY_CONTRACT_REF = "Q.TEST.CONTRACT.CAPABILITY.EXAMPLE@V0100";

function projection(
  operationId: string,
  interfaceId: string,
  surface: P1InterfaceSurface,
  kind: P1InterfaceKind,
  methodRef: string,
) {
  return project_p1_capability_general_slots({
    capability_ref: CAPABILITY_REF,
    capability_id: "example",
    capability_version: "V0100",
    capability_contract_ref: CAPABILITY_CONTRACT_REF,
    capability_contract_content_hash: `sha256:${"b".repeat(64)}`,
    stage_contract_ref: P1_CONTRACT_REF,
    runtime_contract_ref: P0_CONTRACT_REF,
    operation_id: operationId,
    operation_ref: `${CAPABILITY_CONTRACT_REF}#/operations/${operationId}`,
    interface_ref: `${CAPABILITY_CONTRACT_REF}#/interfaces/${interfaceId}`,
    surface,
    kind,
    method_ref: methodRef,
  });
}


function exactStaticSlots(
  slots: P1CapabilityGeneralSlotProjection,
  hookBindingRefs: readonly string[] = [],
): P1StaticRuntimeSlotProjection {
  return Object.freeze({
    manifest: { slot_ref: P1_RUNTIME_SLOT_REFS.manifest, value: { capability_ref: slots.capability_ref.value } },
    // Test-only opaque qreg value. V0186 defines its Slot authority/phase but
    // does not authorize the Skeleton to invent a nested qreg object schema.
    qreg: { slot_ref: P1_RUNTIME_SLOT_REFS.qreg, value: { capability_contract_ref: slots.capability_contract_ref.value } },
    qconfig: { slot_ref: P1_RUNTIME_SLOT_REFS.qconfig, value: {} },
    operation_contract: { slot_ref: P1_RUNTIME_SLOT_REFS.operation_contract, value: slots.operation_ref.value },
    policy_refs: { slot_ref: P1_RUNTIME_SLOT_REFS.policy_refs, value: [] },
    hook_binding_refs: { slot_ref: P1_RUNTIME_SLOT_REFS.hook_binding_refs, value: [...hookBindingRefs] },
  });
}

const testAuthorization: BusinessOperationAuthorization = async (_input, runtimeContext) => ({
  // Only a test fixture: no business authorization policy is invented by P1.
  authorization_receipt: Object.freeze({
    operation_ref: runtimeContext.operation_ref,
    trace_id: runtimeContext.trace_id,
    request_id: runtimeContext.request_id,
    completed_before_operation: true,
  }),
});

function register_business_operation(
  slots: P1CapabilityGeneralSlotProjection,
  handler: BusinessOperationHandler,
  hookBindingRefs: readonly string[] = [],
) {
  return register_concrete_business_operation(slots, handler, exactStaticSlots(slots, hookBindingRefs), testAuthorization);
}

function invokePath(operationRef: string, operationId: string, suffix: string) {
  return {
    route_key: operationRef,
    capability_id: "example",
    operation_id: operationId,
    trace_id: `trace:${suffix}`,
    request_id: `request:${suffix}`,
  };
}


function context(operationRef: string, suffix: string): RuntimeContext {
  return Object.freeze({
    stage_contract_ref: P1_CONTRACT_REF,
    operation_ref: operationRef,
    trace_id: `trace:${suffix}`,
    request_id: `request:${suffix}`,
    invocation_id: `invocation:${suffix}`,
    binding_set_ref: `binding:${suffix}`,
  });
}

test("P1 derives route_key and enters exactly one P0 RuntimeProvider invocation", async () => {
  const slots = projection("read_example", "read_example", "CALL", "CALL_INVOKE", "invoke_business_operation");
  const operationRef = slots.operation_ref.value;
  let attempts = 0;
  const handler = async (input: unknown, ctx: RuntimeContext) => {
    attempts += 1;
    return { input, operation_ref: ctx.operation_ref, stage_contract_ref: ctx.stage_contract_ref };
  };
  const route = register_business_operation(slots, handler);
  assert.equal(route.route_key, operationRef);
  assert.equal(route.route_key, route.operation_ref);
  assert.ok(registered_business_operation_routes().some(x => x.route_key === operationRef));
  const path = invokePath(operationRef, "read_example", "call");
  assert.equal(resolve_business_operation(path), handler);
  const outcome = await invoke_business_operation(path, { value: 1 }, context(operationRef, "call"));
  assert.equal(outcome.outcome_type, "response");
  if (outcome.outcome_type !== "response") return;
  assert.deepEqual(outcome.runtime_result, {
    input: { value: 1 }, operation_ref: operationRef, stage_contract_ref: P1_CONTRACT_REF,
  });
  assert.equal(outcome.execution_receipt.operation_attempts, 1);
  assert.equal(outcome.execution_receipt.operation_ref, operationRef);
  assert.equal(outcome.execution_receipt.rule_evidence.length, 5);
  assert.equal(attempts, 1);
});

test("P1 rejects any carried route_key or tuple drift before P0 Operation attempt", async () => {
  const slots = projection("update_example", "update_example", "CALL", "CALL_INVOKE", "invoke_business_operation");
  const operationRef = slots.operation_ref.value;
  let attempts = 0;
  register_business_operation(slots, async () => { attempts += 1; return "should-not-run"; });
  const wrongRoute = await invoke_business_operation({
    ...invokePath(operationRef, "update_example", "mismatch"), route_key: `${operationRef}:alias`,
  }, {}, context(operationRef, "mismatch"));
  assert.equal(wrongRoute.outcome_type, "stable_error");
  if (wrongRoute.outcome_type === "stable_error") assert.equal(wrongRoute.stable_error.code, "P1_OPERATION_ROUTE_MISMATCH");
  const wrongOwner = await invoke_business_operation({
    ...invokePath(operationRef, "update_example", "mismatch2"), capability_id: "wrong-capability",
  }, {}, context(operationRef, "mismatch2"));
  assert.equal(wrongOwner.outcome_type, "stable_error");
  if (wrongOwner.outcome_type === "stable_error") assert.equal(wrongOwner.stable_error.code, "P1_OPERATION_ROUTE_MISMATCH");
  const wrongContext = await invoke_business_operation(invokePath(operationRef, "update_example", "wrongctx"),
    {}, context("Q.TEST.CONTRACT.CAPABILITY.EXAMPLE@V0100#/operations/unrelated", "wrongctx"));
  assert.equal(wrongContext.outcome_type, "stable_error");
  assert.equal(attempts, 0);
});

test("EVENT_CONSUME preserves exact input and uses the sole P0 invocation", async () => {
  const slots = projection("consume_example", "example_event_consume", "EVENT", "EVENT_CONSUME", "consume_business_event");
  const operationRef = slots.operation_ref.value;
  let observedInput: unknown;
  register_business_operation(slots, async (input, ctx) => {
    observedInput = input;
    return { operation_ref: ctx.operation_ref, stage_contract_ref: ctx.stage_contract_ref };
  });
  const binding = register_business_event_interface(slots);
  assert.equal(binding.operation_ref, operationRef);
  const input = Object.freeze({ event_id: "event:1", exact: true });
  const outcome = await consume_business_event(binding.interface_ref, "subject:example", input, context(operationRef, "consume"));
  assert.equal(outcome.outcome_type, "response");
  if (outcome.outcome_type !== "response") return;
  assert.deepEqual(outcome.runtime_result, { operation_ref: operationRef, stage_contract_ref: P1_CONTRACT_REF });
  assert.equal(outcome.subject_ref, "subject:example");
  assert.equal(outcome.execution_receipt.owner_execution_receipt.operation_attempts, 1);
  assert.match(outcome.evidence_ref, /^sha256:[a-f0-9]{64}$/);
  assert.equal(observedInput, input);
});

test("EVENT_PUBLISH requires completed P1 owner receipt and never re-executes Operation", async () => {
  const slots = projection("publish_example", "example_event_publish", "EVENT", "EVENT_PUBLISH", "publish_business_event");
  const operationRef = slots.operation_ref.value;
  let attempts = 0;
  let published: unknown;
  register_business_operation(slots, async () => {
    attempts += 1;
    return { authoritative_fact: true };
  });
  const binding = register_business_event_interface(slots);
  const runtimeContext = context(operationRef, "publish");
  const owner = await invoke_business_operation(invokePath(operationRef, "publish_example", "publish"),
    { authoritative_fact: true }, runtimeContext);
  assert.equal(owner.outcome_type, "response");
  if (owner.outcome_type !== "response") return;
  const outcome = await publish_business_event(binding.interface_ref, "subject:publish",
    { authoritative_fact: true }, runtimeContext, owner, {
      publish(request) { published = request; return { published: true }; },
    });
  assert.equal(outcome.outcome_type, "response");
  if (outcome.outcome_type !== "response") return;
  assert.deepEqual(outcome.runtime_result, { published: true });
  assert.equal(outcome.execution_receipt.owner_execution_receipt, owner.execution_receipt);
  assert.equal(attempts, 1);
  assert.deepEqual(published, {
    subject_ref: "subject:publish", interface_ref: binding.interface_ref, operation_ref: operationRef,
    input: { authoritative_fact: true }, runtime_context: runtimeContext,
    trace_id: runtimeContext.trace_id, request_id: runtimeContext.request_id,
  });
});

test("duplicate P1-derived route_key with a different handler fails closed", () => {
  const slots = projection("duplicate_example", "duplicate_example", "CALL", "CALL_INVOKE", "invoke_business_operation");
  register_business_operation(slots, async () => "first");
  assert.throws(
    () => register_business_operation(slots, async () => "second"),
    (error: unknown) => error instanceof Error && "code" in error
      && (error as { code: string }).code === "P1_OPERATION_DUPLICATE",
  );
});

test("EVENT exact slots reject wrong kind or wrong framework method", () => {
  const callSlots = projection("event_wrong_kind", "event_wrong_kind", "CALL", "CALL_INVOKE", "invoke_business_operation");
  register_business_operation(callSlots, async () => undefined);
  assert.throws(
    () => register_business_event_interface(callSlots),
    (error: unknown) => error instanceof Error && "code" in error
      && (error as { code: string }).code === "P1_EVENT_BINDING_INVALID",
  );

  assert.throws(
    () => projection(
      "event_wrong_method",
      "event_wrong_method",
      "EVENT",
      "EVENT_CONSUME",
      "publish_business_event",
    ),
    /EVENT concrete method_ref must equal the existing P1 V0186 framework entry method/,
  );
});

test("EVENT_PUBLISH rejects context drift or missing owner evidence before transport", async () => {
  const slots = projection("publish_context_guard", "publish_context_guard", "EVENT", "EVENT_PUBLISH", "publish_business_event");
  const operationRef = slots.operation_ref.value;
  register_business_operation(slots, async () => ({ fact: true }));
  const binding = register_business_event_interface(slots);
  let deliveries = 0;
  const realContext = context(operationRef, "publish-guard");
  const owner = await invoke_business_operation(invokePath(operationRef, "publish_context_guard", "publish-guard"), {}, realContext);
  assert.equal(owner.outcome_type, "response");
  if (owner.outcome_type !== "response") return;
  const bad = await publish_business_event(binding.interface_ref, "subject:guard", {},
    context(`${CAPABILITY_CONTRACT_REF}#/operations/other`, "publish-guard"), owner,
    { publish() { deliveries += 1; return undefined; } });
  assert.equal(bad.outcome_type, "stable_error");
  if (bad.outcome_type === "stable_error") assert.equal(bad.stable_error.code, "P1_EVENT_RUNTIME_CONTEXT_OPERATION_MISMATCH");
  assert.equal(deliveries, 0);
  const forgedOwner = { ...owner, execution_receipt: { ...owner.execution_receipt } };
  const forged = await publish_business_event(binding.interface_ref, "subject:guard", {}, realContext,
    forgedOwner, { publish() { deliveries += 1; return undefined; } });
  assert.equal(forged.outcome_type, "stable_error");
  assert.equal(deliveries, 0);
  const altered = { ...owner, runtime_result: { forged_business_fact: true } };
  const forgedResult = await publish_business_event(
    binding.interface_ref, "subject:guard", {}, realContext,
    altered,
    { publish() { deliveries += 1; return undefined; } },
  );
  assert.equal(forgedResult.outcome_type, "stable_error");
  assert.equal(deliveries, 0);
});

test("P1 internal_call_invoke advances exact child path/depth and uses RuntimeContext request_id", async () => {
  const slots = projection(
    "internal_target",
    "internal_target",
    "CALL",
    "CALL_INVOKE",
    "invoke_business_operation",
  );
  const operationRef = slots.operation_ref.value;
  let attempts = 0;
  register_business_operation(slots, async (input, runtimeContext) => {
    attempts += 1;
    return {
      input,
      operation_ref: runtimeContext.operation_ref,
      request_id: runtimeContext.request_id,
    };
  });

  const runtimeContext = context("caller-operation", "internal-child");
  const parentOperationRef = CAPABILITY_CONTRACT_REF + "#/operations/parent";
  const outcome = await invoke_internal_call({
    local_route_key: operationRef,
    input: { value: 1 },
    runtime_context: runtimeContext,
    call_path: [parentOperationRef],
    call_depth: 1,
    trace_id: runtimeContext.trace_id,
    parent_request_id: "request:parent",
  });

  assert.equal(outcome.outcome_type, "response");
  if (outcome.outcome_type !== "response") return;
  assert.deepEqual(outcome.child_call_path, [parentOperationRef, operationRef]);
  assert.equal(outcome.child_call_depth, 2);
  assert.equal(outcome.child_request_id, runtimeContext.request_id);
  assert.equal(outcome.trace_id, runtimeContext.trace_id);
  assert.deepEqual(outcome.runtime_result, {
    input: { value: 1 },
    operation_ref: operationRef,
    request_id: runtimeContext.request_id,
  });
  assert.equal(attempts, 1);
});

test("P1 internal_call_invoke cycle fails closed before Operation attempt", async () => {
  const slots = projection(
    "internal_cycle",
    "internal_cycle",
    "CALL",
    "CALL_INVOKE",
    "invoke_business_operation",
  );
  const operationRef = slots.operation_ref.value;
  let attempts = 0;
  register_business_operation(slots, async () => {
    attempts += 1;
    return "must-not-run";
  });
  const runtimeContext = context("caller-operation", "internal-cycle");
  const outcome = await invoke_internal_call({
    local_route_key: operationRef,
    input: {},
    runtime_context: runtimeContext,
    call_path: [operationRef],
    call_depth: 1,
    trace_id: runtimeContext.trace_id,
    parent_request_id: "request:parent",
  });
  assert.equal(outcome.outcome_type, "stable_error");
  if (outcome.outcome_type !== "stable_error") return;
  assert.equal(outcome.stable_error.code, "P1_OPERATION_ROUTE_MISMATCH");
  assert.equal(outcome.child_request_id, runtimeContext.request_id);
  assert.equal(attempts, 0);
});

test("P1 internal_call_invoke unresolved local route returns StableError", async () => {
  const runtimeContext = context("caller-operation", "internal-missing");
  const outcome = await invoke_internal_call({
    local_route_key: CAPABILITY_CONTRACT_REF + "#/operations/not_registered",
    input: {},
    runtime_context: runtimeContext,
    call_path: [],
    call_depth: 0,
    trace_id: runtimeContext.trace_id,
    parent_request_id: "request:parent",
  });
  assert.equal(outcome.outcome_type, "stable_error");
  if (outcome.outcome_type !== "stable_error") return;
  assert.equal(outcome.stable_error.code, "P1_OPERATION_NOT_REGISTERED");
  assert.equal(outcome.trace_id, runtimeContext.trace_id);
  assert.equal(outcome.child_request_id, runtimeContext.request_id);
});

test("P1 internal_call_invoke rejects unsafe depth without inventing a global max-depth constant", async () => {
  const slots = projection(
    "internal_depth",
    "internal_depth",
    "CALL",
    "CALL_INVOKE",
    "invoke_business_operation",
  );
  register_business_operation(slots, async () => "must-not-run");
  const runtimeContext = context("caller-operation", "internal-depth");
  const outcome = await invoke_internal_call({
    local_route_key: slots.operation_ref.value,
    input: {},
    runtime_context: runtimeContext,
    call_path: [],
    call_depth: Number.MAX_SAFE_INTEGER,
    trace_id: runtimeContext.trace_id,
    parent_request_id: "request:parent",
  });
  assert.equal(outcome.outcome_type, "stable_error");
  if (outcome.outcome_type !== "stable_error") return;
  assert.equal(outcome.stable_error.code, "P1_OPERATION_ROUTE_MISMATCH");
});


test("P1 registers internal-only Operation without inventing an Interface", async () => {
  const operationId = "internal_only";
  const operationRef = CAPABILITY_CONTRACT_REF + "#/operations/" + operationId;
  let attempts = 0;
  register_internal_business_operation({
    capability_contract_ref: CAPABILITY_CONTRACT_REF,
    capability_contract_content_hash: `sha256:${"b".repeat(64)}`,
    capability_id: "example",
    operation_id: operationId,
    operation_ref: operationRef,
  }, async (input, runtimeContext) => {
    attempts += 1;
    return { input, operation_ref: runtimeContext.operation_ref };
  }, testAuthorization);

  const runtimeContext = context("caller", "internal-only");
  const outcome = await invoke_internal_call({
    local_route_key: operationRef,
    input: { exact: true },
    runtime_context: runtimeContext,
    call_path: [],
    call_depth: 0,
    trace_id: runtimeContext.trace_id,
    parent_request_id: "request:parent",
  });

  assert.equal(outcome.outcome_type, "response");
  if (outcome.outcome_type !== "response") return;
  assert.deepEqual(outcome.runtime_result, {
    input: { exact: true },
    operation_ref: operationRef,
  });
  assert.equal(attempts, 1);
});

test("P1 refuses field-name-only static Runtime Slot bindings", () => {
  const slots = projection("slot_drift", "slot_drift", "CALL", "CALL_INVOKE", "invoke_business_operation");
  const proper = exactStaticSlots(slots);
  const invalid = {
    ...proper,
    operation_contract: { slot_ref: "operation_contract", value: slots.operation_ref.value },
  } as typeof proper;
  assert.throws(
    () => register_concrete_business_operation(slots, async () => undefined, invalid, testAuthorization),
    (error: unknown) => error instanceof Error && "code" in error &&
      (error as {code:string}).code === "P1_OVERLAY_SLOT_INVALID",
  );
});

function governedHookBinding(
  bindingRef: string,
  consumerRef: string,
  decision: "continue" | "deny",
): HookBinding {
  return {
    binding_ref: bindingRef,
    canonical_name: "governed_test_hook",
    hook_point_ref: "before_process",
    consumer_ref: consumerRef,
    consumer_contract_ref: CAPABILITY_CONTRACT_REF,
    provider_bind_interface_ref: P0_BIND_INTERFACE_REF,
    provider_evaluate_interface_ref: P0_EVALUATE_INTERFACE_REF,
    allowed_decision_subset: ["continue", "deny"],
    order: 0,
    enabled_rule_ref: "Q.TEST.RULE.HOOK@V0100",
    enabled: true,
    status: "active",
    rule_version_ref: "Q.TEST.RULE.HOOK@V0100",
    consumer: {
      consumer_ref: consumerRef,
      evaluate: async () => ({ decision }),
    },
  };
}

test("P1 Hook bind and evaluate project P0-owned Hook facts without direct evaluate calls", async () => {
  const slots = projection("hook_enabled", "hook_enabled", "CALL", "CALL_INVOKE", "invoke_business_operation");
  const opRef = slots.operation_ref.value;
  const b = governedHookBinding("Q.TEST.HOOK.BINDING@V0100", "Q.TEST.HOOK.CONSUMER@V0100", "continue");
  const bound = bind_business_hook(b.hook_point_ref, b.consumer_ref, b);
  assert.equal(bound.outcome_type, "binding_receipt");
  if (bound.outcome_type !== "binding_receipt") return;
  assert.equal(bound.binding_receipt.result, "validated");
  assert.notEqual(bound.binding_receipt, bound.binding_validation);
  assert.ok(bound.binding_receipt.exact_source_refs.includes(P0_BIND_INTERFACE_REF));
  assert.match(bound.binding_receipt.input_hashes.binding ?? "", /^[a-f0-9]{64}$/);
  assert.equal(Object.isFrozen(bound.binding_receipt), true);
  assert.equal(Number.isNaN(Date.parse(bound.binding_receipt.executed_at)), false);
  register_business_operation(slots, async () => ({ accepted: true }), [b.binding_ref]);
  const outcome = await invoke_business_operation(invokePath(opRef, "hook_enabled", "hook-enabled"),
    { scoped: true }, context(opRef, "hook-enabled"), [b]);
  assert.equal(outcome.outcome_type, "response");
  if (outcome.outcome_type !== "response") return;
  const hook = evaluate_business_hook(b.hook_point_ref, b.consumer_ref, outcome.trace_id, outcome.request_id, outcome.execution_receipt);
  assert.equal(hook.outcome_type, "hook_decision");
  if (hook.outcome_type === "hook_decision") {
    assert.equal(hook.hook_decision, "continue");
    assert.equal(hook.hook_evidence.length, 1);
    assert.match(hook.evidence_ref, /^sha256:[a-f0-9]{64}$/);
  }
});

test("P0 before_process deny is fail-closed with zero P1 Operation attempts", async () => {
  const slots = projection("before_deny", "before_deny", "CALL", "CALL_INVOKE", "invoke_business_operation");
  const opRef = slots.operation_ref.value;
  const b = governedHookBinding("Q.TEST.HOOK.DENY@V0100", "Q.TEST.HOOK.DENY_CONSUMER@V0100", "deny");
  let attempts = 0;
  register_business_operation(slots, async () => { attempts++; return "must-not-run"; }, [b.binding_ref]);
  const outcome = await invoke_business_operation(invokePath(opRef, "before_deny", "deny"),
    {}, context(opRef, "deny"), [b]);
  assert.equal(outcome.outcome_type, "stable_error");
  if (outcome.outcome_type !== "stable_error") return;
  assert.equal(outcome.stable_error.code, "before_process_deny");
  assert.equal(outcome.execution_receipt?.operation_attempts, 0);
  assert.equal(attempts, 0);
});

test("P1 REGISTRY returns exact discriminated register/resolve/lookup outcomes", () => {
  const ref = "Q.TEST.REGISTRY.OBJECT@V0100";
  const object_contract = Object.freeze({ ref });
  const registry_rule = Object.freeze({ enabled: true });
  const registered = register_business_object(ref, object_contract, registry_rule);
  assert.equal(registered.outcome_type, "registration_receipt");
  if (registered.outcome_type === "registration_receipt") assert.equal(registered.registration_receipt.object_ref, ref);
  const resolved = resolve_business_object(ref);
  assert.equal(resolved.outcome_type, "exact_resolution");
  if (resolved.outcome_type === "exact_resolution") {
    assert.equal(resolved.exact_resolution.object_contract, object_contract);
  }
  const lookedUp = lookup_business_object(ref);
  assert.equal(lookedUp.outcome_type, "lookup_result");
  if (lookedUp.outcome_type === "lookup_result") assert.equal(lookedUp.lookup_result?.object_ref, ref);
  const absent = lookup_business_object("Q.TEST.REGISTRY.ABSENT@V0100");
  assert.equal(absent.outcome_type, "lookup_result");
  if (absent.outcome_type === "lookup_result") assert.equal(absent.lookup_result, null);
  const unresolved = resolve_business_object("Q.TEST.REGISTRY.ABSENT@V0100");
  assert.equal(unresolved.outcome_type, "stable_error");
});

test("P1 dependency_invoke preserves the existing declared client's StableError outcome", async () => {
  const clientOutcome = Object.freeze({
    outcome_type: "stable_error" as const,
    stable_error: Object.freeze({ code: "DECLARED_DEPENDENCY_DENIED", message: "exact provider failure" }),
    trace_id: "trace:dependency",
    request_id: "request:dependency",
  });
  register_business_dependency_client({
    local_dependency_id: "exact_dependency",
    dependency_contract_ref: "Q.TEST.CONTRACT.DEPENDENCY@V0100",
    dependency_client_ref: "Q.TEST.CLIENT.DEPENDENCY@V0100",
    dependency_binding_ref: "Q.TEST.BINDING.DEPENDENCY@V0100",
    invoke: async () => clientOutcome,
  });
  const observed = await invoke_dependency("exact_dependency", { unchanged: true },
    {}, "trace:dependency", "request:dependency");
  assert.equal(observed, clientOutcome);
  const missing = await invoke_dependency("unbound_dependency", {}, {}, "trace:dependency", "request:dependency");
  assert.equal(missing.outcome_type, "stable_error");
});


test("V0186 fail closed: undeclared STATIC_OVERLAY_BIND runtime slot cannot be injected", () => {
  const slots = projection("extra_runtime_slot", "extra_runtime_slot", "CALL", "CALL_INVOKE", "invoke_business_operation");
  const normal = exactStaticSlots(slots);
  const invalid = {
    ...normal,
    route_key: { slot_ref: P1_RUNTIME_SLOT_REFS.route_key, value: "caller-selected-route" },
  } as unknown as P1StaticRuntimeSlotProjection;
  assert.throws(
    () => register_concrete_business_operation(slots, async () => undefined, invalid, testAuthorization),
    (error: unknown) => error instanceof Error && "code" in error
      && (error as { code: string }).code === "P1_OVERLAY_SLOT_INVALID",
  );
});

test("V0186 fail closed: undeclared GENERAL field cannot become an overlay slot", () => {
  const slots = projection("extra_general_slot", "extra_general_slot", "CALL", "CALL_INVOKE", "invoke_business_operation");
  const invalid = {
    ...slots,
    invented_business_field: { slot_ref: `${P1_CONTRACT_REF}#/overlay_slot_catalog/capability_general_slots/invented_business_field`, value: "UNDECLARED" },
  } as unknown as P1CapabilityGeneralSlotProjection;
  assert.throws(
    () => register_concrete_business_operation(invalid, async () => undefined, exactStaticSlots(slots), testAuthorization),
    (error: unknown) => error instanceof Error && "code" in error
      && (error as { code: string }).code === "P1_OVERLAY_SLOT_INVALID",
  );
});

test("V0186 fail closed: field name without exact RUNTIME_SLOT_REF cannot bind", () => {
  const slots = projection("wrong_slot_ref", "wrong_slot_ref", "CALL", "CALL_INVOKE", "invoke_business_operation");
  const normal = exactStaticSlots(slots);
  const invalid = {
    ...normal,
    manifest: { slot_ref: "manifest", value: { capability_ref: slots.capability_ref.value } },
  } as P1StaticRuntimeSlotProjection;
  assert.throws(
    () => register_concrete_business_operation(slots, async () => undefined, invalid, testAuthorization),
    (error: unknown) => error instanceof Error && "code" in error
      && (error as { code: string }).code === "P1_OVERLAY_SLOT_INVALID",
  );
});


test("V0186 EVENT Interface fails closed unless it is in the bound Operation's static interface registry", () => {
  const declared = projection(
    "event_precise_registry", "event_precise_registered",
    "EVENT", "EVENT_CONSUME", "consume_business_event",
  );
  register_business_operation(declared, async () => ({ accepted: true }));
  const unbound = projection(
    "event_precise_registry", "event_precise_not_declared",
    "EVENT", "EVENT_CONSUME", "consume_business_event",
  );
  assert.throws(
    () => register_business_event_interface(unbound),
    (error: unknown) => error instanceof Error && "code" in error
      && (error as { code: string }).code === "P1_EVENT_BINDING_INVALID",
  );
});

test("V0186 authorization precedes the sole P0 Operation attempt and receipt evidence is factual", async () => {
  const slots = projection("guard_order", "guard_order", "CALL", "CALL_INVOKE", "owner_method");
  const opRef = slots.operation_ref.value;
  const order: string[] = [];
  const verifier: BusinessOperationAuthorization = async (_input, ctx, policyRefs) => {
    order.push("authorization_completed");
    assert.equal(ctx.operation_ref, opRef);
    assert.deepEqual(policyRefs, []);
    return { authorization_receipt: Object.freeze({ operation_ref: opRef, complete: true }) };
  };
  const handler: BusinessOperationHandler = async () => {
    order.push("operation_attempt");
    return { completed: true };
  };
  register_concrete_business_operation(slots, handler, exactStaticSlots(slots), verifier);
  const response = await invoke_business_operation(
    invokePath(opRef, "guard_order", "guard-order"), {}, context(opRef, "guard-order"),
  );
  assert.equal(response.outcome_type, "response");
  if (response.outcome_type !== "response") return;
  assert.deepEqual(order, ["authorization_completed", "operation_attempt"]);
  const receipt = response.execution_receipt;
  assert.equal(receipt.operation_attempt, 1);
  assert.match(receipt.outcome_hash, /^sha256:[a-f0-9]{64}$/);
  const authRule = receipt.rule_evidence.find((v) => v.rule_ref.endsWith("/P1-OP-105"));
  assert.equal(authRule?.result, "PASS");
  assert.equal(authRule?.observation.authorization_completed_before_operation_attempt, true);
  assert.match(String(authRule?.observation.authorization_receipt_hash), /^sha256:[a-f0-9]{64}$/);
  const bindingRule = receipt.rule_evidence.find((v) => v.rule_ref.endsWith("/P1-OP-107"));
  assert.equal(bindingRule?.observation.authoritative_outcome_hash, receipt.outcome_hash);
});

test("V0186 authorization without a completed receipt fails closed before P0", async () => {
  const slots = projection("guard_missing_proof", "guard_missing_proof", "CALL", "CALL_INVOKE", "owner_method");
  const opRef = slots.operation_ref.value;
  let attempts = 0;
  register_concrete_business_operation(slots, async () => {
    attempts += 1;
    return "must-not-run";
  }, exactStaticSlots(slots), async () => ({ authorization_receipt: undefined }));
  const response = await invoke_business_operation(
    invokePath(opRef, "guard_missing_proof", "missing-proof"), {}, context(opRef, "missing-proof"),
  );
  assert.equal(response.outcome_type, "stable_error");
  if (response.outcome_type !== "stable_error") return;
  assert.equal(response.stable_error.code, "P1_AUTHORIZATION_NOT_COMPLETED");
  assert.equal(response.execution_receipt?.operation_attempt, 0);
  assert.equal(response.execution_receipt?.rule_evidence.find((v) =>
    v.rule_ref.endsWith("/P1-OP-105"))?.result, "FAIL");
  assert.equal(attempts, 0);
});

test("V0186 concrete-denied authorization preserves StableError and zero attempts", async () => {
  const slots = projection("guard_deny", "guard_deny", "CALL", "CALL_INVOKE", "owner_method");
  const opRef = slots.operation_ref.value;
  let attempts = 0;
  register_concrete_business_operation(
    slots, async () => { attempts++; return "must-not-run"; }, exactStaticSlots(slots),
    async () => { throw { code: "EXACT_DENIAL", message: "Operation authorization denied" }; },
  );
  const response = await invoke_business_operation(
    invokePath(opRef, "guard_deny", "guard-deny"), {}, context(opRef, "guard-deny"),
  );
  assert.equal(response.outcome_type, "stable_error");
  if (response.outcome_type !== "stable_error") return;
  assert.equal(response.stable_error.code, "EXACT_DENIAL");
  assert.equal(response.execution_receipt?.operation_attempt, 0);
  assert.equal(attempts, 0);
});

test("V0186 multiple exact Interfaces can bind one existing Operation without creating another Runtime", () => {
  const call = projection("shared_operation", "shared_call", "CALL", "CALL_INVOKE", "owner_call");
  const event = projection("shared_operation", "shared_event", "EVENT", "EVENT_CONSUME", "consume_business_event");
  const handler: BusinessOperationHandler = async () => "same-handler";
  register_concrete_business_operation(call, handler, exactStaticSlots(call), testAuthorization);
  register_concrete_business_operation(event, handler, exactStaticSlots(event), testAuthorization);
  const eventBinding = register_business_event_interface(event);
  assert.equal(eventBinding.operation_ref, call.operation_ref.value);
  assert.equal(
    registered_business_operation_routes().filter(v => v.route_key === call.operation_ref.value).length,
    1,
  );
});

test("V0186 one concrete Interface must not bind two different Operations", () => {
  const a = projection("unique_iface_first", "shared_identity", "CALL", "CALL_INVOKE", "owner_call");
  const b = projection("unique_iface_second", "shared_identity", "CALL", "CALL_INVOKE", "owner_call");
  const h: BusinessOperationHandler = async () => "noop";
  register_concrete_business_operation(a, h, exactStaticSlots(a), testAuthorization);
  assert.throws(
    () => register_concrete_business_operation(b, h, exactStaticSlots(b), testAuthorization),
    (error: unknown) => error instanceof Error && "code" in error
      && (error as {code:string}).code === "P1_OPERATION_DUPLICATE",
  );
});


test("V0186 GENERAL SlotRef cannot disguise wrong P0 Runtime Contract value", () => {
  const slots = projection("wrong_runtime_contract", "wrong_runtime_contract", "CALL", "CALL_INVOKE", "owner_method");
  const invalid = {
    ...slots,
    runtime_contract_ref: {
      slot_ref: slots.runtime_contract_ref.slot_ref,
      value: "Q.TEST.UNAUTHORIZED.RUNTIME@V0100",
    },
  } as P1CapabilityGeneralSlotProjection;
  assert.throws(
    () => register_concrete_business_operation(invalid, async () => undefined,
      exactStaticSlots(slots), testAuthorization),
    (error: unknown) => error instanceof Error && "code" in error
      && (error as { code: string }).code === "P1_OVERLAY_SLOT_INVALID",
  );
});

test("V0186 EVENT must match the registered Operation's exact Capability Contract content hash", () => {
  const source = projection("event_hash_identity", "event_hash_identity", "EVENT", "EVENT_CONSUME", "consume_business_event");
  register_business_operation(source, async () => ({ result: true }));
  const forged = {
    ...source,
    capability_contract_content_hash: {
      slot_ref: source.capability_contract_content_hash.slot_ref,
      value: `sha256:${"c".repeat(64)}`,
    },
  } as P1CapabilityGeneralSlotProjection;
  assert.throws(
    () => register_business_event_interface(forged),
    (error: unknown) => error instanceof Error && "code" in error
      && (error as { code: string }).code === "P1_EVENT_BINDING_INVALID",
  );
});


test("V0186 ONE_PER_CAPABILITY fails closed on contradictory identity across Operations", () => {
  const a = projection("same_capability_a", "same_capability_interface_a", "CALL", "CALL_INVOKE", "owner_method");
  const b = projection("same_capability_b", "same_capability_interface_b", "CALL", "CALL_INVOKE", "owner_method");
  register_business_operation(a, async () => ({ ok: true }));
  const inconsistent = {
    ...b,
    capability_version: {
      slot_ref: b.capability_version.slot_ref,
      value: "V0101",
    },
  } as P1CapabilityGeneralSlotProjection;
  assert.throws(
    () => register_concrete_business_operation(
      inconsistent, async () => ({ ok: true }), exactStaticSlots(b), testAuthorization,
    ),
    (error: unknown) => error instanceof Error && "code" in error
      && (error as { code: string }).code === "P1_OVERLAY_SLOT_INVALID",
  );
});

test("V0186 one Interface cannot change its preverified Surface/Kind/Method while keeping the same ref", () => {
  const first = projection(
    "interface_identity_lock", "interface_identity_lock",
    "EVENT", "EVENT_CONSUME", "consume_business_event",
  );
  const changed = projection(
    "interface_identity_lock", "interface_identity_lock",
    "EVENT", "EVENT_PUBLISH", "publish_business_event",
  );
  const handler: BusinessOperationHandler = async () => ({ ok: true });
  register_concrete_business_operation(first, handler, exactStaticSlots(first), testAuthorization);
  assert.throws(
    () => register_concrete_business_operation(
      changed, handler, exactStaticSlots(changed), testAuthorization,
    ),
    (error: unknown) => error instanceof Error && "code" in error
      && (error as { code: string }).code === "P1_OVERLAY_SLOT_INVALID",
  );
  assert.throws(
    () => register_business_event_interface(changed),
    (error: unknown) => error instanceof Error && "code" in error
      && (error as { code: string }).code === "P1_EVENT_BINDING_INVALID",
  );
});


test("V0186 keeps an explicit runtime_result field when the exact Operation returns undefined", async () => {
  const slots = projection("void_operation", "void_operation", "CALL", "CALL_INVOKE", "owner_method");
  const operationRef = slots.operation_ref.value;
  register_business_operation(slots, async () => undefined);
  const result = await invoke_business_operation(
    invokePath(operationRef, "void_operation", "void-result"), {}, context(operationRef, "void-result"),
  );
  assert.equal(result.outcome_type, "response");
  if (result.outcome_type !== "response") return;
  assert.equal(Object.prototype.hasOwnProperty.call(result, "runtime_result"), true);
  assert.equal(result.runtime_result, undefined);
  assert.equal(result.execution_receipt.outcome_type, "response");
  assert.match(result.execution_receipt.outcome_hash, /^sha256:[a-f0-9]{64}$/);
});

test("V0186 missing authorization receipt prevents both Hook dispatch and Operation attempt", async () => {
  const slots = projection("auth_before_hook", "auth_before_hook", "CALL", "CALL_INVOKE", "owner_method");
  const operationRef = slots.operation_ref.value;
  const binding = governedHookBinding(
    "Q.TEST.HOOK.AUTH_BLOCK@V0100",
    "Q.TEST.HOOK.AUTH_CONSUMER@V0100",
    "continue",
  );
  let attempts = 0;
  let hooks = 0;
  const guardedBinding: HookBinding = {
    ...binding,
    consumer: {
      consumer_ref: binding.consumer_ref,
      evaluate: async () => { hooks += 1; return { decision: "continue" }; },
    },
  };
  register_concrete_business_operation(
    slots, async () => { attempts += 1; return "not-run"; },
    exactStaticSlots(slots, [guardedBinding.binding_ref]),
    async () => ({ authorization_receipt: undefined }),
  );
  const result = await invoke_business_operation(
    invokePath(operationRef, "auth_before_hook", "auth-block"),
    {}, context(operationRef, "auth-block"), [guardedBinding],
  );
  assert.equal(result.outcome_type, "stable_error");
  assert.equal(attempts, 0);
  assert.equal(hooks, 0);
});


test("V0186 caller route_key cannot select a different registered Operation", async () => {
  const a = projection("route_owned_a", "route_owned_a", "CALL", "CALL_INVOKE", "owner_method");
  const b = projection("route_owned_b", "route_owned_b", "CALL", "CALL_INVOKE", "owner_method");
  let attempts = 0;
  register_business_operation(a, async () => { attempts++; return "A"; });
  register_business_operation(b, async () => { attempts++; return "B"; });
  const path = {
    ...invokePath(a.operation_ref.value, "route_owned_a", "route-owned"),
    route_key: b.operation_ref.value,
  };
  const outcome = await invoke_business_operation(path, {}, context(a.operation_ref.value, "route-owned"));
  assert.equal(outcome.outcome_type, "stable_error");
  if (outcome.outcome_type === "stable_error") {
    assert.equal(outcome.stable_error.code, "P1_OPERATION_ROUTE_MISMATCH");
  }
  assert.equal(attempts, 0);
});

test("V0186 ambiguous static Capability/Operation tuple rejects before P0 even with a carried route", async () => {
  const first = projection("ambiguous_version_op", "ambiguous_version_iface", "CALL", "CALL_INVOKE", "owner_method");
  const otherContract = "Q.TEST.CONTRACT.CAPABILITY.ALTERNATIVE@V0101";
  const second = project_p1_capability_general_slots({
    capability_ref: "Q.TEST.CAPABILITY.ALTERNATIVE@V0101",
    capability_id: "example",
    capability_version: "V0101",
    capability_contract_ref: otherContract,
    capability_contract_content_hash: `sha256:${"d".repeat(64)}`,
    stage_contract_ref: P1_CONTRACT_REF,
    runtime_contract_ref: P0_CONTRACT_REF,
    operation_id: "ambiguous_version_op",
    operation_ref: `${otherContract}#/operations/ambiguous_version_op`,
    interface_ref: `${otherContract}#/interfaces/ambiguous_version_iface`,
    surface: "CALL",
    kind: "CALL_INVOKE",
    method_ref: "owner_method",
  });
  let attempts = 0;
  register_business_operation(first, async () => { attempts++; return 1; });
  register_business_operation(second, async () => { attempts++; return 2; });
  const outcome = await invoke_business_operation(
    invokePath(first.operation_ref.value, "ambiguous_version_op", "ambiguous"),
    {}, context(first.operation_ref.value, "ambiguous"),
  );
  assert.equal(outcome.outcome_type, "stable_error");
  if (outcome.outcome_type === "stable_error") {
    assert.equal(outcome.stable_error.code, "P1_OPERATION_ROUTE_MISMATCH");
  }
  assert.equal(attempts, 0);
});


test("V0186 internal_call resolves exact local_route_key even when public CALL tuple is ambiguous", async () => {
  const first = projection("internal_exact_version", "internal_exact_version_v1", "CALL", "CALL_INVOKE", "owner_method");
  const alternate = "Q.TEST.CONTRACT.CAPABILITY.INTERNAL_ALT@V0101";
  const second = project_p1_capability_general_slots({
    capability_ref: "Q.TEST.CAPABILITY.INTERNAL_ALT@V0101",
    capability_id: "example",
    capability_version: "V0101",
    capability_contract_ref: alternate,
    capability_contract_content_hash: `sha256:${"c".repeat(64)}`,
    stage_contract_ref: P1_CONTRACT_REF,
    runtime_contract_ref: P0_CONTRACT_REF,
    operation_id: "internal_exact_version",
    operation_ref: `${alternate}#/operations/internal_exact_version`,
    interface_ref: `${alternate}#/interfaces/internal_exact_version_v2`,
    surface: "CALL",
    kind: "CALL_INVOKE",
    method_ref: "owner_method",
  });
  let firstCalls = 0;
  let secondCalls = 0;
  register_business_operation(first, async () => { firstCalls++; return "one"; });
  register_business_operation(second, async () => { secondCalls++; return "two"; });
  const parentContext = context("Q.TEST.CONTRACT.CAPABILITY.EXAMPLE@V0100#/operations/parent", "internal-selected");
  const outcome = await invoke_internal_call({
    local_route_key: second.operation_ref.value,
    input: {},
    runtime_context: parentContext,
    call_path: [],
    call_depth: 0,
    trace_id: parentContext.trace_id,
    parent_request_id: "request:parent",
  });
  assert.equal(outcome.outcome_type, "response");
  if (outcome.outcome_type === "response") assert.equal(outcome.runtime_result, "two");
  assert.equal(firstCalls, 0);
  assert.equal(secondCalls, 1);
});

test("V0186 EVENT_CONSUME dispatches by exact registered Interface under ambiguous public CALL tuple", async () => {
  const first = projection("event_exact_version", "event_exact_version_v1", "EVENT", "EVENT_CONSUME", "consume_business_event");
  const alternate = "Q.TEST.CONTRACT.CAPABILITY.EVENT_ALT@V0101";
  const second = project_p1_capability_general_slots({
    capability_ref: "Q.TEST.CAPABILITY.EVENT_ALT@V0101",
    capability_id: "example",
    capability_version: "V0101",
    capability_contract_ref: alternate,
    capability_contract_content_hash: `sha256:${"e".repeat(64)}`,
    stage_contract_ref: P1_CONTRACT_REF,
    runtime_contract_ref: P0_CONTRACT_REF,
    operation_id: "event_exact_version",
    operation_ref: `${alternate}#/operations/event_exact_version`,
    interface_ref: `${alternate}#/interfaces/event_exact_version_v2`,
    surface: "EVENT",
    kind: "EVENT_CONSUME",
    method_ref: "consume_business_event",
  });
  let firstCalls = 0;
  let secondCalls = 0;
  register_business_operation(first, async () => { firstCalls++; return "event-one"; });
  register_business_operation(second, async () => { secondCalls++; return "event-two"; });
  register_business_event_interface(first);
  const binding = register_business_event_interface(second);
  const outcome = await consume_business_event(binding.interface_ref, "subject:bound-version",
    { unchanged: true }, context(second.operation_ref.value, "event-selected"));
  assert.equal(outcome.outcome_type, "response");
  if (outcome.outcome_type === "response") assert.equal(outcome.runtime_result, "event-two");
  assert.equal(firstCalls, 0);
  assert.equal(secondCalls, 1);
});


test("V0186 malformed EVENT RuntimeContext returns StableError without an Operation attempt", async () => {
  const slots = projection("event_bad_context", "event_bad_context", "EVENT", "EVENT_CONSUME", "consume_business_event");
  let attempts = 0;
  register_business_operation(slots, async () => { attempts++; return "should-not-run"; });
  const binding = register_business_event_interface(slots);
  const response = await consume_business_event(
    binding.interface_ref, "subject:bad-context", {},
    null as unknown as RuntimeContext,
  );
  assert.equal(response.outcome_type, "stable_error");
  assert.equal(attempts, 0);
});


test("V0186 dependency outcomes reject simultaneous runtime_result and stable_error variants", async () => {
  register_business_dependency_client({
    local_dependency_id: "mixed_outcome",
    dependency_contract_ref: "Q.TEST.CONTRACT.DEPENDENCY@V0100",
    dependency_client_ref: "Q.TEST.CLIENT.DEPENDENCY@V0100",
    dependency_binding_ref: "Q.TEST.BINDING.DEPENDENCY@V0100",
    invoke: async () => ({
      outcome_type: "response",
      runtime_result: { value: 1 },
      stable_error: { code: "FORBIDDEN", message: "mixed outcome" },
      trace_id: "trace:mixed",
      request_id: "request:mixed",
    } as unknown as BusinessOperationOutcome),
  });
  const outcome = await invoke_dependency("mixed_outcome", {}, {}, "trace:mixed", "request:mixed");
  assert.equal(outcome.outcome_type, "stable_error");
  if (outcome.outcome_type === "stable_error") {
    assert.equal(outcome.stable_error.code, "P1_BINDING_INVALID");
  }
});
