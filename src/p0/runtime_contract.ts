export const P0_CONTRACT_REF = "Q.SS.STD.P0.CONTRACT.RUNTIME_CORE@V0134" as const;
export const P0_PROVIDER_SYMBOL_REF = "#q/p0/stage_handler::runtime_provider" as const;
export const P0_BIND_INTERFACE_REF = `${P0_CONTRACT_REF}#/interfaces/runtime_hook_bind` as const;
export const P0_EVALUATE_INTERFACE_REF = `${P0_CONTRACT_REF}#/interfaces/runtime_hook_evaluate` as const;

export type StageId = "P0" | "P1" | "P2" | "P3" | "P4";
export type StageRole = "NONE" | "CONSUMER" | "PROVIDER";
export type HookPointRef = "before_process" | "after_process" | "on_error";
export type HookDecisionValue = "continue" | "deny" | "recompute";
export type HookBindingStatus = "draft" | "active" | "deprecated" | "retired";
export type StageExtensionStatus = "draft" | "active" | "deprecated" | "retired";

const STAGE_ROLES = Object.freeze({
  P0: ["NONE"] as const,
  P1: ["NONE"] as const,
  P2: ["NONE", "CONSUMER", "PROVIDER"] as const,
  P3: ["NONE"] as const,
  P4: ["NONE"] as const,
}) satisfies Readonly<Record<StageId, readonly StageRole[]>>;

export interface StageContract {
  readonly stage_id: StageId;
  readonly stage_role: StageRole;
  readonly contract_ref: string;
}

export interface StageExtensionContract {
  readonly stage_id: StageId;
  readonly stage_role: StageRole;
  readonly stage_contract_ref: string;
  readonly implementation_ref: string;
  readonly provided_interface_refs: readonly string[];
  readonly consumed_interface_refs: readonly string[];
  readonly hook_consumer_refs: readonly string[];
  readonly hook_binding_refs: readonly string[];
  readonly port_refs: readonly string[];
  readonly upstream_runtime_ref: typeof P0_CONTRACT_REF;
  readonly runtime_provider_symbol_ref: typeof P0_PROVIDER_SYMBOL_REF;
  readonly status: StageExtensionStatus;
  readonly rule_version_ref: string;
}

/**
 * P0 RuntimeContext is an immutable in-process context. Business payload fields
 * remain opaque and must not be promoted into Q-wide fields.
 */
export interface RuntimeContext {
  readonly stage_contract_ref: string;
  readonly operation_ref: string;
  readonly trace_id: string;
  readonly request_id: string;
  readonly invocation_id: string;
  readonly binding_set_ref: string;
  readonly attributes?: Readonly<Record<string, unknown>>;
}

export interface StableRuntimeErrorShape {
  readonly code: string;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export class StableRuntimeError extends Error implements StableRuntimeErrorShape {
  readonly code: string;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: string,
    message: string,
    details?: Readonly<Record<string, unknown>>,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StableRuntimeError";
    this.code = code;
    if (details !== undefined) this.details = deep_freeze({ ...details });
  }
}

export interface HookEnvelope {
  readonly hook_point_ref: HookPointRef;
  readonly trace_id: string;
  readonly request_id: string;
  readonly invocation_id: string;
  readonly runtime_context: RuntimeContext;
  readonly input_ref?: unknown;
  readonly result_ref?: unknown;
  readonly error_ref?: StableRuntimeErrorShape;
}

export interface HookDecision {
  readonly decision: HookDecisionValue;
  readonly evidence?: Readonly<Record<string, unknown>>;
}

export interface HookConsumer {
  readonly consumer_ref: string;
  evaluate(envelope: HookEnvelope): HookDecision | Promise<HookDecision>;
}

export interface HookBinding {
  readonly binding_ref: string;
  readonly canonical_name: string;
  readonly hook_point_ref: HookPointRef;
  readonly consumer_ref: string;
  readonly consumer_contract_ref: string;
  readonly provider_bind_interface_ref: typeof P0_BIND_INTERFACE_REF;
  readonly provider_evaluate_interface_ref: typeof P0_EVALUATE_INTERFACE_REF;
  readonly allowed_decision_subset: readonly HookDecisionValue[];
  readonly order: number;
  readonly enabled_rule_ref: string;
  readonly enabled: boolean;
  readonly status: HookBindingStatus;
  readonly rule_version_ref: string;
  readonly consumer: HookConsumer;
}

export interface HookBindRequest {
  readonly binding: HookBinding;
}

export interface HookBindResult {
  readonly binding_ref: string;
  readonly outcome: "validated";
  readonly content_hash: string;
}

export type BindingReceipt = HookBindResult;

export interface HookEvidence {
  readonly hook_point_ref: HookPointRef;
  readonly binding_ref: string;
  readonly consumer_ref: string;
  readonly decision?: HookDecisionValue;
  readonly consumer_evidence?: Readonly<Record<string, unknown>>;
  readonly error?: StableRuntimeErrorShape;
}

export interface HookEvaluateRequest {
  readonly hook_point_ref: HookPointRef;
  readonly envelope: HookEnvelope;
  readonly frozen_bindings: readonly HookBinding[];
}

export interface HookEvaluateResult {
  readonly decision: HookDecisionValue;
  readonly evidence: readonly HookEvidence[];
  readonly stable_error?: StableRuntimeError;
}

export type HookEvaluation = HookEvaluateResult;
export type RuntimeOperation<TInput = unknown, TOutput = unknown> =
  (input: TInput, context: RuntimeContext) => TOutput | Promise<TOutput>;

export interface RuntimeInvokeRequest<TInput = unknown, TOutput = unknown> {
  readonly stage_extension: StageExtensionContract;
  readonly runtime_context: RuntimeContext;
  readonly input: TInput;
  readonly operation: RuntimeOperation<TInput, TOutput>;
  readonly hook_binding_set: readonly HookBinding[];
}

interface RuntimeResultBase {
  readonly trace_id: string;
  readonly request_id: string;
  readonly invocation_id: string;
  readonly operation_attempts: 0 | 1;
  readonly hook_evidence: readonly HookEvidence[];
}

export interface RuntimeSuccess<TOutput = unknown> extends RuntimeResultBase {
  readonly outcome: "success";
  readonly value: TOutput;
  readonly recompute_requested: boolean;
}

export interface RuntimeDenied extends RuntimeResultBase {
  readonly outcome: "denied";
  readonly reason: "before_process_deny";
}

export interface RuntimeFailure extends RuntimeResultBase {
  readonly outcome: "error";
  readonly error: StableRuntimeErrorShape;
  readonly business_effect_state: "not_started" | "completed" | "unknown";
}

export type RuntimeInvokeResult<TOutput = unknown> =
  RuntimeSuccess<TOutput> | RuntimeDenied | RuntimeFailure;
export type RuntimeResult<TOutput = unknown> = RuntimeInvokeResult<TOutput>;

export interface RuntimeProbe {
  readonly status: "ready";
  readonly contract_ref: typeof P0_CONTRACT_REF;
  readonly runtime_provider_count: 1;
  readonly runtime_pipeline_count: 1;
  readonly hook_anchor_count: 1;
  readonly persistence: "NONE";
}

export interface RuntimeProvider {
  invoke<TInput = unknown, TOutput = unknown>(
    request: RuntimeInvokeRequest<TInput, TOutput>,
  ): Promise<RuntimeInvokeResult<TOutput>>;
  bind(request: HookBindRequest): HookBindResult;
  probe(): RuntimeProbe;
}

export function deep_freeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object") return value;
  const object = value as object;
  if (seen.has(object)) return value;
  seen.add(object);
  for (const nested of Object.values(object as Record<string, unknown>)) {
    deep_freeze(nested, seen);
  }
  return Object.freeze(value);
}

export function exact_ref(value: string): boolean {
  return /^[A-Za-z0-9_.:-]+@V\d{4}(#\/.+)?$/.test(value);
}

export function normalize_runtime_error(
  error: unknown,
  fallback_code = "P0_OPERATION_FAILED",
): StableRuntimeError {
  if (error instanceof StableRuntimeError) return error;

  if (
    error !== null
    && typeof error === "object"
  ) {
    const candidate = error as {
      readonly code?: unknown;
      readonly message?: unknown;
      readonly details?: unknown;
    };

    const details_valid =
      candidate.details === undefined
      || (
        candidate.details !== null
        && typeof candidate.details === "object"
        && !Array.isArray(candidate.details)
      );

    if (
      typeof candidate.code === "string"
      && typeof candidate.message === "string"
      && details_valid
    ) {
      return new StableRuntimeError(
        candidate.code,
        candidate.message,
        candidate.details === undefined
          ? undefined
          : candidate.details as Readonly<Record<string, unknown>>,
        error instanceof Error
          ? { cause: error }
          : undefined,
      );
    }
  }

  if (error instanceof Error) {
    return new StableRuntimeError(
      fallback_code,
      error.message,
      undefined,
      { cause: error },
    );
  }

  return new StableRuntimeError(
    fallback_code,
    "Unknown runtime failure",
    { value_type: typeof error },
  );
}

export function stage_role_is_allowed(stage_id: StageId, stage_role: StageRole): boolean {
  return (STAGE_ROLES[stage_id] as readonly StageRole[]).includes(stage_role);
}

export function assert_stage_extension(extension: StageExtensionContract): void {
  if (extension.stage_id === "P0") {
    throw new StableRuntimeError(
      "P0_STAGE_EXTENSION_INVALID",
      "StageExtensionContract is for later stages only",
    );
  }
  if (!stage_role_is_allowed(extension.stage_id, extension.stage_role)) {
    throw new StableRuntimeError(
      "P0_STAGE_ROLE_INVALID",
      "Stage role does not match the closed Stage/role-profile model",
    );
  }
  if (extension.upstream_runtime_ref !== P0_CONTRACT_REF) {
    throw new StableRuntimeError(
      "P0_STAGE_EXTENSION_INVALID",
      "Later stages must bind the exact current P0 runtime Contract",
    );
  }
  if (extension.runtime_provider_symbol_ref !== P0_PROVIDER_SYMBOL_REF) {
    throw new StableRuntimeError(
      "P0_STAGE_EXTENSION_INVALID",
      "Wrong runtime provider symbol",
    );
  }
  const refs = [
    extension.stage_contract_ref,
    extension.implementation_ref,
    extension.rule_version_ref,
    ...extension.provided_interface_refs,
    ...extension.consumed_interface_refs,
    ...extension.hook_consumer_refs,
    ...extension.hook_binding_refs,
    ...extension.port_refs,
  ];
  if (refs.some((ref) => !exact_ref(ref))) {
    throw new StableRuntimeError(
      "P0_STAGE_EXTENSION_INVALID",
      "Stage extension contains a non-exact formal reference",
    );
  }
}
