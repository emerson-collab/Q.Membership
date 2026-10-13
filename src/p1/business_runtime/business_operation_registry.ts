import { StableRuntimeError, deep_freeze, exact_ref, normalize_runtime_error } from "../../p0/runtime_contract.ts";
import type { RuntimeContext, RuntimeOperation, StableRuntimeErrorShape } from "../../p0/runtime_contract.ts";
import {
  P1_CAPABILITY_GENERAL_SLOT_REFS,
  P1_CONTRACT_REF,
  resolve_p1_framework_anchor,
} from "./stage_extension_contract.ts";
import type {
  P1CapabilityGeneralSlotId,
  P1CapabilityGeneralSlotProjection,
} from "./stage_extension_contract.ts";

export type BusinessOperationHandler = RuntimeOperation<unknown, unknown>;
export type BusinessEventInterfaceKind = "EVENT_PUBLISH" | "EVENT_CONSUME";

export interface BusinessOperationRouteBinding {
  readonly route_key: string;
  readonly capability_contract_ref: string;
  readonly capability_id: string;
  readonly operation_id: string;
  readonly operation_ref: string;
}

export interface BusinessInternalOperationBinding {
  readonly capability_contract_ref: string;
  readonly capability_id: string;
  readonly operation_id: string;
  readonly operation_ref: string;
}

export interface BusinessOperationInvokePath {
  readonly route_key: string;
  readonly capability_id: string;
  readonly operation_id: string;
  readonly trace_id: string;
  readonly request_id: string;
}

export interface BusinessInternalCallRequest {
  readonly local_route_key: string;
  readonly input: unknown;
  readonly runtime_context: RuntimeContext;
  readonly call_path: readonly string[];
  readonly call_depth: number;
  readonly trace_id: string;
  readonly parent_request_id: string;
}

export interface BusinessInternalCallSuccess {
  readonly outcome_type: "response";
  readonly runtime_result: unknown;
  readonly child_call_path: readonly string[];
  readonly child_call_depth: number;
  readonly trace_id: string;
  readonly child_request_id: string;
}

export interface BusinessInternalCallFailure {
  readonly outcome_type: "stable_error";
  readonly stable_error: StableRuntimeErrorShape;
  readonly trace_id: string;
  readonly child_request_id: string;
}

export type BusinessInternalCallOutcome =
  | BusinessInternalCallSuccess
  | BusinessInternalCallFailure;

export interface BusinessRegistryEntry {
  readonly object_ref: string;
  readonly object_contract: unknown;
  readonly registry_rule: unknown;
}

export interface BusinessEventInterfaceBinding {
  readonly capability_contract_ref: string;
  readonly interface_ref: string;
  readonly operation_ref: string;
  readonly surface: "EVENT";
  readonly kind: BusinessEventInterfaceKind;
  readonly method_ref: "publish_business_event" | "consume_business_event";
}

export interface BusinessEventPublishRequest {
  readonly interface_ref: string;
  readonly operation_ref: string;
  readonly input: unknown;
  readonly runtime_context: RuntimeContext;
}

export interface BusinessEventPublisher {
  publish(request: Readonly<BusinessEventPublishRequest>): unknown | Promise<unknown>;
}

interface RegisteredBusinessOperation {
  readonly route: BusinessOperationRouteBinding;
  readonly handler: BusinessOperationHandler;
}

const operations = new Map<string, RegisteredBusinessOperation>();
const business_objects = new Map<string, BusinessRegistryEntry>();
const event_interfaces = new Map<string, BusinessEventInterfaceBinding>();

function nonEmptyString(value: string, field: string): string {
  if (value.length === 0) {
    throw new StableRuntimeError("P1_BINDING_INVALID", `${field} must be a non-empty string`);
  }
  return value;
}

function exactSlotValue(
  projection: P1CapabilityGeneralSlotProjection,
  slotId: P1CapabilityGeneralSlotId,
): string {
  const binding = projection[slotId];
  if (binding.slot_ref !== P1_CAPABILITY_GENERAL_SLOT_REFS[slotId]) {
    throw new StableRuntimeError(
      "P1_OVERLAY_SLOT_INVALID",
      `${slotId} must bind the exact predeclared P1 V0186 slot_ref`,
    );
  }
  return nonEmptyString(binding.value, slotId);
}

function operationRouteFromProjection(
  projection: P1CapabilityGeneralSlotProjection,
): BusinessOperationRouteBinding {
  const capabilityContractRef = exactSlotValue(projection, "capability_contract_ref");
  const capabilityId = exactSlotValue(projection, "capability_id");
  const operationId = exactSlotValue(projection, "operation_id");
  const operationRef = exactSlotValue(projection, "operation_ref");

  if (!exact_ref(capabilityContractRef) || capabilityContractRef.includes("#/")) {
    throw new StableRuntimeError(
      "P1_OVERLAY_SLOT_INVALID",
      "capability_contract_ref must be an exact versioned Capability Contract ref",
    );
  }
  if (
    !exact_ref(operationRef)
    || operationRef !== `${capabilityContractRef}#/operations/${operationId}`
  ) {
    throw new StableRuntimeError(
      "P1_OVERLAY_SLOT_INVALID",
      "operation_ref must exactly match capability_contract_ref and operation_id",
    );
  }

  return deep_freeze({
    route_key: operationRef,
    capability_contract_ref: capabilityContractRef,
    capability_id: capabilityId,
    operation_id: operationId,
    operation_ref: operationRef,
  });
}

function registerOperationRoute(
  route: Readonly<BusinessOperationRouteBinding>,
  handler: BusinessOperationHandler,
): BusinessOperationRouteBinding {
  const existing = operations.get(route.route_key);
  if (existing !== undefined) {
    if (
      existing.handler !== handler
      || existing.route.capability_contract_ref !== route.capability_contract_ref
      || existing.route.capability_id !== route.capability_id
      || existing.route.operation_id !== route.operation_id
      || existing.route.operation_ref !== route.operation_ref
    ) {
      throw new StableRuntimeError(
        "P1_OPERATION_DUPLICATE",
        "P1-derived route_key already has a different exact Operation binding",
      );
    }
    return existing.route;
  }

  const frozenRoute = deep_freeze({ ...route });
  operations.set(frozenRoute.route_key, deep_freeze({ route: frozenRoute, handler }));
  return frozenRoute;
}

export function register_business_operation(
  general_slots: P1CapabilityGeneralSlotProjection,
  handler: BusinessOperationHandler,
): BusinessOperationRouteBinding {
  resolve_p1_framework_anchor({
    surface: exactSlotValue(general_slots, "surface"),
    kind: exactSlotValue(general_slots, "kind"),
    method_ref: exactSlotValue(general_slots, "method_ref"),
  });
  return registerOperationRoute(operationRouteFromProjection(general_slots), handler);
}

/**
 * Register an internal-only Operation that has no concrete Capability Interface.
 *
 * The binding uses exactly the four route-consistency facts owned by P1 V0186:
 * capability_contract_ref, capability_id, operation_id and operation_ref.
 * No Interface identity is invented for an Operation whose Capability Contract declares
 * interface_refs: [].
 */
export function register_internal_business_operation(
  binding: Readonly<BusinessInternalOperationBinding>,
  handler: BusinessOperationHandler,
): BusinessOperationRouteBinding {
  const capabilityContractRef = nonEmptyString(binding.capability_contract_ref, "capability_contract_ref");
  const capabilityId = nonEmptyString(binding.capability_id, "capability_id");
  const operationId = nonEmptyString(binding.operation_id, "operation_id");
  const operationRef = nonEmptyString(binding.operation_ref, "operation_ref");
  if (!exact_ref(capabilityContractRef) || capabilityContractRef.includes("#/")) {
    throw new StableRuntimeError(
      "P1_OVERLAY_SLOT_INVALID",
      "internal capability_contract_ref must be one exact versioned Capability Contract ref",
    );
  }
  if (
    !exact_ref(operationRef)
    || operationRef !== `${capabilityContractRef}#/operations/${operationId}`
  ) {
    throw new StableRuntimeError(
      "P1_OVERLAY_SLOT_INVALID",
      "internal operation_ref must exactly match capability_contract_ref and operation_id",
    );
  }
  return registerOperationRoute(deep_freeze({
    route_key: operationRef,
    capability_contract_ref: capabilityContractRef,
    capability_id: capabilityId,
    operation_id: operationId,
    operation_ref: operationRef,
  }), handler);
}

function resolveRegisteredOperationByExactRef(operationRef: string): RegisteredBusinessOperation {
  const registered = operations.get(operationRef);
  if (
    registered === undefined
    || registered.route.route_key !== operationRef
    || registered.route.operation_ref !== operationRef
  ) {
    throw new StableRuntimeError(
      "P1_OPERATION_NOT_REGISTERED",
      "Exact Operation ref is not registered as its P1-derived route_key",
    );
  }
  return registered;
}

function resolveRegisteredOperationByPath(
  path: Readonly<BusinessOperationInvokePath>,
): RegisteredBusinessOperation {
  const routeKey = nonEmptyString(path.route_key, "route_key");
  const registered = operations.get(routeKey);
  if (
    registered === undefined
    || registered.route.route_key !== registered.route.operation_ref
    || routeKey !== registered.route.operation_ref
    || path.capability_id !== registered.route.capability_id
    || path.operation_id !== registered.route.operation_id
  ) {
    throw new StableRuntimeError(
      "P1_OPERATION_ROUTE_MISMATCH",
      "P1 route tuple does not resolve exactly one registered Operation",
    );
  }
  return registered;
}

export function resolve_business_operation(
  path: Readonly<BusinessOperationInvokePath>,
): BusinessOperationHandler {
  return resolveRegisteredOperationByPath(path).handler;
}

export async function invoke_business_operation(
  path: Readonly<BusinessOperationInvokePath>,
  input: unknown,
  runtime_context: RuntimeContext,
): Promise<unknown> {
  const registered = resolveRegisteredOperationByPath(path);
  if (
    path.trace_id !== runtime_context.trace_id
    || path.request_id !== runtime_context.request_id
  ) {
    throw new StableRuntimeError(
      "P1_OPERATION_ROUTE_MISMATCH",
      "Invocation correlation does not match the resolved P1 route context",
    );
  }

  const boundRuntimeContext = deep_freeze({
    ...runtime_context,
    stage_contract_ref: P1_CONTRACT_REF,
    operation_ref: registered.route.operation_ref,
  } satisfies RuntimeContext);

  return await registered.handler(input, boundRuntimeContext);
}

function exactInternalCallPath(value: readonly string[]): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new StableRuntimeError(
      "P1_BINDING_INVALID",
      "call_path must be an array of non-empty exact path identities",
    );
  }
  return deep_freeze([...value]);
}

function internalCallStableError(
  error: unknown,
  trace_id: string,
  child_request_id: string,
): BusinessInternalCallFailure {
  const stable = normalize_runtime_error(error, "P1_OPERATION_ROUTE_MISMATCH");
  const stable_error: StableRuntimeErrorShape = stable.details === undefined
    ? { code: stable.code, message: stable.message }
    : { code: stable.code, message: stable.message, details: stable.details };
  return deep_freeze({
    outcome_type: "stable_error" as const,
    stable_error,
    trace_id,
    child_request_id,
  });
}

/**
 * P1 V0186 internal_call_invoke realization.
 *
 * The exact local_route_key is the already-registered Operation ref. The caller does not
 * gain route authority. RuntimeContext.request_id is projected as child_request_id;
 * call_path/call_depth advance exactly one hop. No global maximum call-depth constant is
 * invented here because the governed Source does not define one.
 */
export async function invoke_internal_call(
  request: Readonly<BusinessInternalCallRequest>,
): Promise<BusinessInternalCallOutcome> {
  if (request === null || typeof request !== "object" || Array.isArray(request)) {
    throw new StableRuntimeError("P1_BINDING_INVALID", "internal call request must be an object");
  }
  const runtimeContext = request.runtime_context;
  if (runtimeContext === null || typeof runtimeContext !== "object" || Array.isArray(runtimeContext)) {
    throw new StableRuntimeError("P1_OPERATION_ROUTE_MISMATCH", "runtime_context must be an exact P0 RuntimeContext object");
  }
  const traceId = nonEmptyString(request.trace_id, "trace_id");
  const parentRequestId = nonEmptyString(request.parent_request_id, "parent_request_id");
  void parentRequestId;
  const childRequestId = nonEmptyString(runtimeContext.request_id, "runtime_context.request_id");
  if (runtimeContext.trace_id !== traceId) {
    throw new StableRuntimeError(
      "P1_OPERATION_ROUTE_MISMATCH",
      "internal call trace_id must equal runtime_context.trace_id",
    );
  }

  let callPath: readonly string[];
  try {
    callPath = exactInternalCallPath(request.call_path);
    if (!Number.isSafeInteger(request.call_depth) || request.call_depth < 0) {
      throw new StableRuntimeError(
        "P1_OPERATION_ROUTE_MISMATCH",
        "call_depth must be a non-negative safe integer",
      );
    }
    const localRouteKey = nonEmptyString(request.local_route_key, "local_route_key");
    const registered = resolveRegisteredOperationByExactRef(localRouteKey);
    if (callPath.includes(registered.route.operation_ref)) {
      throw new StableRuntimeError(
        "P1_OPERATION_ROUTE_MISMATCH",
        "internal call target already exists in call_path",
      );
    }
    if (request.call_depth === Number.MAX_SAFE_INTEGER) {
      throw new StableRuntimeError(
        "P1_OPERATION_ROUTE_MISMATCH",
        "child_call_depth cannot be represented as a safe integer",
      );
    }

    const childCallPath = deep_freeze([...callPath, registered.route.operation_ref]);
    const childCallDepth = request.call_depth + 1;
    const runtimeResult = await invoke_business_operation(
      {
        route_key: registered.route.operation_ref,
        capability_id: registered.route.capability_id,
        operation_id: registered.route.operation_id,
        trace_id: traceId,
        request_id: childRequestId,
      },
      request.input,
      runtimeContext,
    );

    return deep_freeze({
      outcome_type: "response" as const,
      runtime_result: runtimeResult,
      child_call_path: childCallPath,
      child_call_depth: childCallDepth,
      trace_id: traceId,
      child_request_id: childRequestId,
    });
  } catch (error) {
    return internalCallStableError(error, traceId, childRequestId);
  }
}

export function registered_business_operation_refs(): readonly string[] {
  return deep_freeze([...operations.values()].map((item) => item.route.operation_ref).sort());
}

export function registered_business_operation_routes(): readonly BusinessOperationRouteBinding[] {
  return deep_freeze(
    [...operations.values()]
      .map((item) => item.route)
      .sort((left, right) => left.route_key.localeCompare(right.route_key)),
  );
}

export function register_business_event_interface(
  general_slots: P1CapabilityGeneralSlotProjection,
): BusinessEventInterfaceBinding {
  const capabilityContractRef = exactSlotValue(general_slots, "capability_contract_ref");
  const interfaceRef = exactSlotValue(general_slots, "interface_ref");
  const operationRef = exactSlotValue(general_slots, "operation_ref");
  const surface = exactSlotValue(general_slots, "surface");
  const kind = exactSlotValue(general_slots, "kind");
  const methodRef = exactSlotValue(general_slots, "method_ref");

  if (!exact_ref(interfaceRef) || !interfaceRef.startsWith(`${capabilityContractRef}#/interfaces/`)) {
    throw new StableRuntimeError(
      "P1_EVENT_BINDING_INVALID",
      "interface_ref must be an exact member of capability_contract_ref",
    );
  }

  const registeredOperation = resolveRegisteredOperationByExactRef(operationRef);
  if (registeredOperation.route.capability_contract_ref !== capabilityContractRef) {
    throw new StableRuntimeError(
      "P1_EVENT_BINDING_INVALID",
      "EVENT Interface and Operation must resolve inside the same exact Capability Contract",
    );
  }
  if (surface !== "EVENT") {
    throw new StableRuntimeError("P1_EVENT_BINDING_INVALID", "EVENT binding surface must equal EVENT");
  }
  if (kind !== "EVENT_PUBLISH" && kind !== "EVENT_CONSUME") {
    throw new StableRuntimeError(
      "P1_EVENT_BINDING_INVALID",
      "EVENT binding kind must be EVENT_PUBLISH or EVENT_CONSUME",
    );
  }
  const expectedMethodRef = kind === "EVENT_PUBLISH"
    ? "publish_business_event"
    : "consume_business_event";
  if (methodRef !== expectedMethodRef) {
    throw new StableRuntimeError(
      "P1_EVENT_BINDING_INVALID",
      `EVENT ${kind} method_ref must equal ${expectedMethodRef}`,
    );
  }

  const exactBinding = deep_freeze({
    capability_contract_ref: capabilityContractRef,
    interface_ref: interfaceRef,
    operation_ref: operationRef,
    surface: "EVENT" as const,
    kind,
    method_ref: expectedMethodRef,
  } satisfies BusinessEventInterfaceBinding);

  const existing = event_interfaces.get(interfaceRef);
  if (existing !== undefined) {
    if (
      existing.capability_contract_ref !== exactBinding.capability_contract_ref
      || existing.operation_ref !== exactBinding.operation_ref
      || existing.kind !== exactBinding.kind
      || existing.method_ref !== exactBinding.method_ref
    ) {
      throw new StableRuntimeError(
        "P1_EVENT_INTERFACE_DUPLICATE",
        "EVENT interface ref already has a different exact binding",
      );
    }
    return existing;
  }

  event_interfaces.set(interfaceRef, exactBinding);
  return exactBinding;
}

export function resolve_business_event_interface(
  interface_ref: string,
  expected_kind?: BusinessEventInterfaceKind,
): BusinessEventInterfaceBinding {
  const binding = event_interfaces.get(interface_ref);
  if (binding === undefined) {
    throw new StableRuntimeError(
      "P1_EVENT_INTERFACE_NOT_REGISTERED",
      "EVENT interface ref is not registered",
    );
  }
  if (expected_kind !== undefined && binding.kind !== expected_kind) {
    throw new StableRuntimeError(
      "P1_EVENT_INTERFACE_KIND_MISMATCH",
      "EVENT interface kind does not match requested dispatch path",
    );
  }
  return binding;
}

export function registered_business_event_interface_refs(): readonly string[] {
  return deep_freeze([...event_interfaces.keys()].sort());
}

export async function publish_business_event(
  interface_ref: string,
  input: unknown,
  runtime_context: RuntimeContext,
  publisher: BusinessEventPublisher,
): Promise<unknown> {
  const binding = resolve_business_event_interface(interface_ref, "EVENT_PUBLISH");
  resolveRegisteredOperationByExactRef(binding.operation_ref);
  if (runtime_context.operation_ref !== binding.operation_ref) {
    throw new StableRuntimeError(
      "P1_EVENT_RUNTIME_CONTEXT_OPERATION_MISMATCH",
      "RuntimeContext operation_ref must equal the exact Operation bound by the EVENT_PUBLISH Interface",
    );
  }
  return await publisher.publish(deep_freeze({
    interface_ref: binding.interface_ref,
    operation_ref: binding.operation_ref,
    input,
    runtime_context,
  } satisfies BusinessEventPublishRequest));
}

export async function consume_business_event(
  interface_ref: string,
  input: unknown,
  runtime_context: RuntimeContext,
): Promise<unknown> {
  const binding = resolve_business_event_interface(interface_ref, "EVENT_CONSUME");
  const registered = resolveRegisteredOperationByExactRef(binding.operation_ref);
  return await invoke_business_operation(
    {
      route_key: registered.route.operation_ref,
      capability_id: registered.route.capability_id,
      operation_id: registered.route.operation_id,
      trace_id: runtime_context.trace_id,
      request_id: runtime_context.request_id,
    },
    input,
    runtime_context,
  );
}

export function register_business_object(
  object_ref: string,
  object_contract: unknown,
  registry_rule: unknown,
): BusinessRegistryEntry {
  const existing = business_objects.get(object_ref);
  if (existing !== undefined) {
    if (existing.object_contract !== object_contract || existing.registry_rule !== registry_rule) {
      throw new Error("Business registry object ref already has different static registry material");
    }
    return existing;
  }

  const entry = deep_freeze({ object_ref, object_contract, registry_rule } satisfies BusinessRegistryEntry);
  business_objects.set(object_ref, entry);
  return entry;
}

export function resolve_business_object(resolution_key: string): BusinessRegistryEntry {
  const entry = business_objects.get(resolution_key);
  if (entry === undefined) throw new Error("Business registry resolution key is not registered");
  return entry;
}

export function lookup_business_object(lookup_query: string): BusinessRegistryEntry | undefined {
  return business_objects.get(lookup_query);
}
