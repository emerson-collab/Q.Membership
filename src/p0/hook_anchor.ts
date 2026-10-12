import { createHash } from "node:crypto";
import {
  P0_BIND_INTERFACE_REF,
  P0_EVALUATE_INTERFACE_REF,
  StableRuntimeError,
  deep_freeze,
  exact_ref,
  normalize_runtime_error,
} from "./runtime_contract.ts";
import type {
  HookBindRequest,
  HookBindResult,
  HookBinding,
  HookDecisionValue,
  HookEnvelope,
  HookEvaluateResult,
  HookEvidence,
  HookPointRef,
} from "./runtime_contract.ts";

const ALLOWED: Readonly<Record<HookPointRef, readonly HookDecisionValue[]>> = deep_freeze({
  before_process: ["continue", "deny", "recompute"],
  after_process: ["continue", "recompute"],
  on_error: ["continue"],
});

function sha256_hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function sort_binding(a: HookBinding, b: HookBinding): number {
  return a.order - b.order
    || a.consumer_ref.localeCompare(b.consumer_ref)
    || a.binding_ref.localeCompare(b.binding_ref);
}

function validate_binding(binding: HookBinding): void {
  if (
    !binding.binding_ref
    || !binding.canonical_name
    || binding.consumer.consumer_ref !== binding.consumer_ref
  ) {
    throw new StableRuntimeError(
      "P0_BINDING_INVALID",
      "Binding identity is incomplete or inconsistent",
    );
  }
  if (
    !exact_ref(binding.binding_ref)
    || !exact_ref(binding.consumer_ref)
    || ![binding.consumer_contract_ref, binding.enabled_rule_ref, binding.rule_version_ref]
      .every(exact_ref)
  ) {
    throw new StableRuntimeError(
      "P0_BINDING_REF_INVALID",
      "Binding contains a non-exact formal reference",
    );
  }
  if (
    binding.provider_bind_interface_ref !== P0_BIND_INTERFACE_REF
    || binding.provider_evaluate_interface_ref !== P0_EVALUATE_INTERFACE_REF
  ) {
    throw new StableRuntimeError(
      "P0_BINDING_PROVIDER_MISMATCH",
      "Binding provider references do not match P0",
    );
  }
  if (
    !Number.isInteger(binding.order)
    || binding.order < -2147483648
    || binding.order > 2147483647
  ) {
    throw new StableRuntimeError(
      "P0_BINDING_INVALID",
      "Binding order is outside signed 32-bit range",
    );
  }
  if (binding.status !== "active") {
    throw new StableRuntimeError(
      "P0_BINDING_NOT_ACTIVE",
      "Only active bindings can enter an invocation snapshot",
    );
  }
  const allowed = ALLOWED[binding.hook_point_ref];
  if (
    binding.allowed_decision_subset.length === 0
    || binding.allowed_decision_subset.some((decision) => !allowed.includes(decision))
  ) {
    throw new StableRuntimeError(
      "P0_BINDING_DECISION_INVALID",
      "Binding decision subset is not closed by the Hook Point",
    );
  }
}

/**
 * P0 deliberately does not invent a numeric hook timeout. Current Source defines
 * timeout outcome semantics but no numeric duration. A governed caller/consumer may
 * surface a StableRuntimeError timeout; P0 applies the point's fail-closed behavior.
 */
export class HookAnchor {
  readonly #active_cycles = new Set<string>();

  bind(request: HookBindRequest): HookBindResult {
    validate_binding(request.binding);
    const b = request.binding;
    const canonical = JSON.stringify([
      b.binding_ref,
      b.canonical_name,
      b.hook_point_ref,
      b.consumer_ref,
      b.consumer_contract_ref,
      b.provider_bind_interface_ref,
      b.provider_evaluate_interface_ref,
      b.allowed_decision_subset,
      b.order,
      b.enabled_rule_ref,
      b.enabled,
      b.status,
      b.rule_version_ref,
    ]);
    return deep_freeze({
      binding_ref: b.binding_ref,
      outcome: "validated",
      content_hash: sha256_hex(canonical),
    });
  }

  freeze(bindings: readonly HookBinding[]): readonly HookBinding[] {
    const seen = new Set<string>();
    const frozen = bindings.map((binding) => {
      validate_binding(binding);
      if (seen.has(binding.binding_ref)) {
        throw new StableRuntimeError("P0_BINDING_DUPLICATE", "Duplicate binding_ref");
      }
      seen.add(binding.binding_ref);
      return deep_freeze({
        ...binding,
        allowed_decision_subset: [...binding.allowed_decision_subset],
        consumer: { ...binding.consumer },
      });
    });
    return deep_freeze(frozen.sort(sort_binding));
  }

  async evaluate(
    point: HookPointRef,
    envelope: HookEnvelope,
    bindings: readonly HookBinding[],
  ): Promise<HookEvaluateResult> {
    if (envelope.hook_point_ref !== point) {
      throw new StableRuntimeError(
        "P0_HOOK_ENVELOPE_INVALID",
        "HookEnvelope point does not match evaluation point",
      );
    }

    const evidence: HookEvidence[] = [];
    const decisions: HookDecisionValue[] = [];
    const applicable = bindings
      .filter((binding) => binding.enabled && binding.hook_point_ref === point)
      .sort(sort_binding);

    for (const binding of applicable) {
      const cycle = `${point}:${envelope.invocation_id}:${binding.consumer_ref}`;
      if (this.#active_cycles.has(cycle)) {
        const error = new StableRuntimeError("P0_HOOK_REENTRY", "Hook reentry is forbidden");
        evidence.push(deep_freeze({
          hook_point_ref: point,
          binding_ref: binding.binding_ref,
          consumer_ref: binding.consumer_ref,
          error,
        }));
        if (point !== "on_error") {
          return deep_freeze({
            decision: point === "before_process" ? "deny" : "continue",
            evidence,
            stable_error: error,
          });
        }
        continue;
      }

      this.#active_cycles.add(cycle);
      try {
        const result = await Promise.resolve(
          binding.consumer.evaluate(deep_freeze({ ...envelope })),
        );
        if (!binding.allowed_decision_subset.includes(result.decision)) {
          throw new StableRuntimeError(
            "P0_HOOK_DECISION_INVALID",
            "Consumer decision is outside the binding subset",
          );
        }
        decisions.push(result.decision);
        evidence.push(deep_freeze({
          hook_point_ref: point,
          binding_ref: binding.binding_ref,
          consumer_ref: binding.consumer_ref,
          decision: result.decision,
          ...(result.evidence === undefined ? {} : { consumer_evidence: result.evidence }),
        }));
      } catch (error) {
        const stable = normalize_runtime_error(error, "P0_HOOK_FAILED");
        evidence.push(deep_freeze({
          hook_point_ref: point,
          binding_ref: binding.binding_ref,
          consumer_ref: binding.consumer_ref,
          error: stable,
        }));
        if (point !== "on_error") {
          return deep_freeze({
            decision: point === "before_process" ? "deny" : "continue",
            evidence,
            stable_error: stable,
          });
        }
      } finally {
        this.#active_cycles.delete(cycle);
      }
    }

    const decision: HookDecisionValue =
      point === "before_process"
        ? decisions.includes("deny")
          ? "deny"
          : decisions.includes("recompute")
            ? "recompute"
            : "continue"
        : point === "after_process" && decisions.includes("recompute")
          ? "recompute"
          : "continue";

    return deep_freeze({ decision, evidence });
  }
}
