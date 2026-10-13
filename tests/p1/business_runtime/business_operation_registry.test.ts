import assert from "node:assert/strict";
import test from "node:test";
import { P0_CONTRACT_REF } from "../../../src/p0/runtime_contract.ts";
import type { RuntimeContext } from "../../../src/p0/runtime_contract.ts";
import {
  consume_business_event,
  invoke_business_operation,
  invoke_internal_call,
  publish_business_event,
  register_business_event_interface,
  register_business_operation,
  register_internal_business_operation,
  registered_business_operation_routes,
  resolve_business_operation,
} from "../../../src/p1/business_runtime/business_operation_registry.ts";
import {
  P1_CONTRACT_REF,
  project_p1_capability_general_slots,
} from "../../../src/p1/business_runtime/stage_extension_contract.ts";

const CAPABILITY_REF = "Q.TEST.CAPABILITY.EXAMPLE@V0100";
const CAPABILITY_CONTRACT_REF = "Q.TEST.CONTRACT.CAPABILITY.EXAMPLE@V0100";

function projection(
  operationId: string,
  interfaceId: string,
  surface: string,
  kind: string,
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

function context(operationRef: string, suffix: string): RuntimeContext {
  return Object.freeze({
    stage_contract_ref: "Q.TEST.PREVIOUS@V0100",
    operation_ref: operationRef,
    trace_id: `trace:${suffix}`,
    request_id: `request:${suffix}`,
    invocation_id: `invocation:${suffix}`,
    binding_set_ref: `binding:${suffix}`,
  });
}

test("P1 derives route_key as exact operation_ref bytes and resolves the exact route tuple", async () => {
  const slots = projection("read_example", "read_example", "CALL", "CALL_INVOKE", "invoke_business_operation");
  const operationRef = slots.operation_ref.value;
  let attempts = 0;
  const handler = async (input: unknown, runtimeContext: RuntimeContext) => {
    attempts += 1;
    return { input, operation_ref: runtimeContext.operation_ref, stage_contract_ref: runtimeContext.stage_contract_ref };
  };
  const route = register_business_operation(slots, handler);

  assert.equal(route.route_key, operationRef);
  assert.equal(route.route_key, route.operation_ref);
  assert.equal(registered_business_operation_routes().at(-1)?.route_key, operationRef);

  const path = {
    route_key: operationRef,
    capability_id: "example",
    operation_id: "read_example",
    trace_id: "trace:call",
    request_id: "request:call",
  };
  assert.equal(resolve_business_operation(path), handler);
  assert.deepEqual(
    await invoke_business_operation(path, { value: 1 }, context("transport-selected-ignored", "call")),
    { input: { value: 1 }, operation_ref: operationRef, stage_contract_ref: P1_CONTRACT_REF },
  );
  assert.equal(attempts, 1);
});

test("P1 rejects any carried route_key or route tuple drift before Operation attempt", async () => {
  const slots = projection("update_example", "update_example", "CALL", "CALL_INVOKE", "invoke_business_operation");
  const operationRef = slots.operation_ref.value;
  let attempts = 0;
  register_business_operation(slots, async () => {
    attempts += 1;
    return "should-not-run";
  });

  await assert.rejects(
    () => invoke_business_operation({
      route_key: `${operationRef}:alias`,
      capability_id: "example",
      operation_id: "update_example",
      trace_id: "trace:mismatch",
      request_id: "request:mismatch",
    }, {}, context(operationRef, "mismatch")),
    (error: unknown) => error instanceof Error && "code" in error
      && (error as { code: string }).code === "P1_OPERATION_ROUTE_MISMATCH",
  );

  await assert.rejects(
    () => invoke_business_operation({
      route_key: operationRef,
      capability_id: "wrong-capability",
      operation_id: "update_example",
      trace_id: "trace:mismatch2",
      request_id: "request:mismatch2",
    }, {}, context(operationRef, "mismatch2")),
    (error: unknown) => error instanceof Error && "code" in error
      && (error as { code: string }).code === "P1_OPERATION_ROUTE_MISMATCH",
  );

  assert.equal(attempts, 0);
});

test("EVENT_CONSUME binds from exact GENERAL slots and invokes the existing Operation directly", async () => {
  const slots = projection(
    "consume_example",
    "example_event_consume",
    "EVENT",
    "EVENT_CONSUME",
    "consume_business_event",
  );
  const operationRef = slots.operation_ref.value;
  let observedInput: unknown;
  register_business_operation(slots, async (input, runtimeContext) => {
    observedInput = input;
    return { operation_ref: runtimeContext.operation_ref, stage_contract_ref: runtimeContext.stage_contract_ref };
  });
  const binding = register_business_event_interface(slots);
  assert.equal(binding.operation_ref, operationRef);

  const input = Object.freeze({ event_id: "event:1", exact: true });
  assert.deepEqual(
    await consume_business_event(binding.interface_ref, input, context("transport-selected-ignored", "consume")),
    { operation_ref: operationRef, stage_contract_ref: P1_CONTRACT_REF },
  );
  assert.equal(observedInput, input);
});

test("EVENT_PUBLISH preserves exact binding and never re-executes owner Operation", async () => {
  const slots = projection(
    "publish_example",
    "example_event_publish",
    "EVENT",
    "EVENT_PUBLISH",
    "publish_business_event",
  );
  const operationRef = slots.operation_ref.value;
  let attempts = 0;
  let published: unknown;
  register_business_operation(slots, async () => {
    attempts += 1;
    return "must-not-run";
  });
  const binding = register_business_event_interface(slots);
  const runtimeContext = context(operationRef, "publish");

  assert.deepEqual(
    await publish_business_event(binding.interface_ref, { authoritative_fact: true }, runtimeContext, {
      publish(request) {
        published = request;
        return { published: true };
      },
    }),
    { published: true },
  );
  assert.equal(attempts, 0);
  assert.deepEqual(published, {
    interface_ref: binding.interface_ref,
    operation_ref: operationRef,
    input: { authoritative_fact: true },
    runtime_context: runtimeContext,
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

test("EVENT_PUBLISH rejects runtime Operation drift before transport delivery", async () => {
  const slots = projection(
    "publish_context_guard",
    "publish_context_guard",
    "EVENT",
    "EVENT_PUBLISH",
    "publish_business_event",
  );
  register_business_operation(slots, async () => undefined);
  const binding = register_business_event_interface(slots);
  let deliveries = 0;
  await assert.rejects(
    () => publish_business_event(
      binding.interface_ref,
      {},
      context(`${CAPABILITY_CONTRACT_REF}#/operations/other`, "publish-guard"),
      { publish() { deliveries += 1; return undefined; } },
    ),
    (error: unknown) => error instanceof Error && "code" in error
      && (error as { code: string }).code === "P1_EVENT_RUNTIME_CONTEXT_OPERATION_MISMATCH",
  );
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
    capability_id: "example",
    operation_id: operationId,
    operation_ref: operationRef,
  }, async (input, runtimeContext) => {
    attempts += 1;
    return { input, operation_ref: runtimeContext.operation_ref };
  });

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
