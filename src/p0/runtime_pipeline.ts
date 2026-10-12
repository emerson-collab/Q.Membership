import { HookAnchor } from "./hook_anchor.ts";
import {
  StableRuntimeError,
  assert_stage_extension,
  deep_freeze,
  normalize_runtime_error,
} from "./runtime_contract.ts";
import type {
  HookBinding,
  HookEvidence,
  RuntimeContext,
  RuntimeInvokeRequest,
  RuntimeInvokeResult,
} from "./runtime_contract.ts";

function validate_context(context: RuntimeContext): RuntimeContext {
  const required: readonly (keyof RuntimeContext)[] = [
    "stage_contract_ref",
    "operation_ref",
    "trace_id",
    "request_id",
    "invocation_id",
    "binding_set_ref",
  ];
  for (const key of required) {
    const value = context[key];
    if (typeof value !== "string" || value.length === 0) {
      throw new StableRuntimeError(
        "P0_CONTEXT_INVALID",
        `Runtime context field ${key} must be a non-empty string`,
      );
    }
  }
  if (!Object.isFrozen(context)) {
    // P0 never mutates caller context; it freezes a cloned invocation view.
  }
  return context.attributes === undefined
    ? deep_freeze({ ...context })
    : deep_freeze({ ...context, attributes: { ...context.attributes } });
}

function same_refs(left: readonly string[], right: readonly string[]): boolean {
  return [...left].sort().join("\n") === [...right].sort().join("\n");
}

export class RuntimePipeline {
  readonly #hook_anchor: HookAnchor;

  constructor(hook_anchor: HookAnchor) {
    this.#hook_anchor = hook_anchor;
  }

  async invoke<TInput, TOutput>(
    request: RuntimeInvokeRequest<TInput, TOutput>,
  ): Promise<RuntimeInvokeResult<TOutput>> {
    let operation_attempts: 0 | 1 = 0;
    let business_effect_state: "not_started" | "completed" | "unknown" = "not_started";
    const evidence: HookEvidence[] = [];
    let context: RuntimeContext;
    let frozen_bindings: readonly HookBinding[];

    try {
      assert_stage_extension(request.stage_extension);
      context = validate_context(request.runtime_context);
      frozen_bindings = this.#hook_anchor.freeze(request.hook_binding_set);
      if (
        !same_refs(
          request.stage_extension.hook_binding_refs,
          frozen_bindings.map((binding) => binding.binding_ref),
        )
      ) {
        throw new StableRuntimeError(
          "P0_BINDING_SET_MISMATCH",
          "StageExtension hook_binding_refs do not match the invocation binding set",
        );
      }
    } catch (error) {
      const stable = normalize_runtime_error(error, "P0_REQUEST_INVALID");
      return deep_freeze({
        outcome: "error",
        error: stable,
        business_effect_state,
        trace_id: request.runtime_context.trace_id,
        request_id: request.runtime_context.request_id,
        invocation_id: request.runtime_context.invocation_id,
        operation_attempts,
        hook_evidence: evidence,
      });
    }

    const base = deep_freeze({
      trace_id: context.trace_id,
      request_id: context.request_id,
      invocation_id: context.invocation_id,
      runtime_context: context,
      input_ref: request.input,
    });

    const before = await this.#hook_anchor.evaluate(
      "before_process",
      deep_freeze({ ...base, hook_point_ref: "before_process" as const }),
      frozen_bindings,
    );
    evidence.push(...before.evidence);

    if (before.stable_error !== undefined) {
      return this.#error_result(
        before.stable_error,
        business_effect_state,
        context,
        operation_attempts,
        evidence,
        frozen_bindings,
        request.input,
      );
    }
    if (before.decision === "deny") {
      return deep_freeze({
        outcome: "denied",
        reason: "before_process_deny",
        trace_id: context.trace_id,
        request_id: context.request_id,
        invocation_id: context.invocation_id,
        operation_attempts: 0,
        hook_evidence: evidence,
      });
    }

    let value: TOutput;
    try {
      operation_attempts = 1;
      value = await request.operation(request.input, context);
      business_effect_state = "completed";
    } catch (error) {
      business_effect_state = "unknown";
      return this.#error_result(
        normalize_runtime_error(error),
        business_effect_state,
        context,
        operation_attempts,
        evidence,
        frozen_bindings,
        request.input,
      );
    }

    const after = await this.#hook_anchor.evaluate(
      "after_process",
      deep_freeze({
        ...base,
        hook_point_ref: "after_process" as const,
        result_ref: value,
      }),
      frozen_bindings,
    );
    evidence.push(...after.evidence);

    if (after.stable_error !== undefined) {
      return this.#error_result(
        after.stable_error,
        "completed",
        context,
        operation_attempts,
        evidence,
        frozen_bindings,
        request.input,
      );
    }

    return deep_freeze({
      outcome: "success",
      value,
      recompute_requested:
        after.decision === "recompute" || before.decision === "recompute",
      trace_id: context.trace_id,
      request_id: context.request_id,
      invocation_id: context.invocation_id,
      operation_attempts,
      hook_evidence: evidence,
    });
  }

  async #error_result<TInput, TOutput>(
    primary: StableRuntimeError,
    state: "not_started" | "completed" | "unknown",
    context: RuntimeContext,
    attempts: 0 | 1,
    evidence: HookEvidence[],
    bindings: readonly HookBinding[],
    input: TInput,
  ): Promise<RuntimeInvokeResult<TOutput>> {
    const on_error = await this.#hook_anchor.evaluate(
      "on_error",
      deep_freeze({
        hook_point_ref: "on_error",
        trace_id: context.trace_id,
        request_id: context.request_id,
        invocation_id: context.invocation_id,
        runtime_context: context,
        input_ref: input,
        error_ref: primary,
      }),
      bindings,
    );
    evidence.push(...on_error.evidence);

    return deep_freeze({
      outcome: "error",
      error: primary,
      business_effect_state: state,
      trace_id: context.trace_id,
      request_id: context.request_id,
      invocation_id: context.invocation_id,
      operation_attempts: attempts,
      hook_evidence: evidence,
    });
  }
}
