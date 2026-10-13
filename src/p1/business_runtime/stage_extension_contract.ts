import { P0_CONTRACT_REF, P0_PROVIDER_SYMBOL_REF, deep_freeze, exact_ref } from "../../p0/runtime_contract.ts";
import type { StageExtensionContract } from "../../p0/runtime_contract.ts";

export const P1_CONTRACT_REF = "Q.SS.STD.P1.CONTRACT.BUSINESS_RUNTIME@V0186" as const;
export const P1_CONTRACT_HASH =
  "sha256:4637e7370406d558514f8ff3e076336b0e557e5b002e8a7123fa51db4d68dbc3" as const;
export const P1_CAPABILITY_MATERIALIZATION_REF = "Q.SS.STD.META.CONTRACT.P1_CAPABILITY_MATERIALIZATION@V0116" as const;

export const P1_CAPABILITY_GENERAL_SLOT_IDS = [
  "capability_ref",
  "capability_id",
  "capability_version",
  "capability_contract_ref",
  "capability_contract_content_hash",
  "stage_contract_ref",
  "runtime_contract_ref",
  "operation_id",
  "operation_ref",
  "interface_ref",
  "surface",
  "kind",
  "method_ref",
] as const;

export type P1CapabilityGeneralSlotId = (typeof P1_CAPABILITY_GENERAL_SLOT_IDS)[number];

export const P1_CAPABILITY_GENERAL_SLOT_REFS = deep_freeze(
  Object.fromEntries(
    P1_CAPABILITY_GENERAL_SLOT_IDS.map((slotId) => [
      slotId,
      `${P1_CONTRACT_REF}#/overlay_slot_catalog/capability_general_slots/${slotId}`,
    ]),
  ) as Record<P1CapabilityGeneralSlotId, string>,
);

export interface P1CapabilityGeneralFacts {
  readonly capability_ref: string;
  readonly capability_id: string;
  readonly capability_version: string;
  readonly capability_contract_ref: string;
  readonly capability_contract_content_hash: string;
  readonly stage_contract_ref: string;
  readonly runtime_contract_ref: string;
  readonly operation_id: string;
  readonly operation_ref: string;
  readonly interface_ref: string;
  readonly surface: string;
  readonly kind: string;
  readonly method_ref: string;
}

export interface P1CapabilityGeneralSlotBinding {
  readonly slot_ref: string;
  readonly value: string;
}

export type P1CapabilityGeneralSlotProjection = Readonly<
  Record<P1CapabilityGeneralSlotId, Readonly<P1CapabilityGeneralSlotBinding>>
>;

export type P1FrameworkAnchorMethodPolicy =
  | "PRESERVE_CONCRETE_METHOD_REF_SEPARATE_FROM_FRAMEWORK_ENTRY_METHOD"
  | "MUST_EQUAL_FRAMEWORK_ENTRY_METHOD_REF_UNDER_EXISTING_EVENT_CONTRACT";

export interface P1FrameworkAnchorBinding {
  readonly surface: string;
  readonly kind: string;
  readonly framework_interface_ref: string;
  readonly framework_entry_method_ref: string;
  readonly concrete_method_ref_policy: P1FrameworkAnchorMethodPolicy;
}

export const P1_FRAMEWORK_ANCHOR_CROSSWALK: Readonly<
  Record<string, Readonly<P1FrameworkAnchorBinding>>
> = deep_freeze({
  "CALL:CALL_INVOKE": {
    surface: "CALL",
    kind: "CALL_INVOKE",
    framework_interface_ref: `${P1_CONTRACT_REF}#/interfaces/business_operation_invoke`,
    framework_entry_method_ref: "invoke_business_operation",
    concrete_method_ref_policy:
      "PRESERVE_CONCRETE_METHOD_REF_SEPARATE_FROM_FRAMEWORK_ENTRY_METHOD",
  },
  "HOOK:HOOK_BIND": {
    surface: "HOOK",
    kind: "HOOK_BIND",
    framework_interface_ref: `${P1_CONTRACT_REF}#/interfaces/business_hook_bind`,
    framework_entry_method_ref: "bind_business_hook",
    concrete_method_ref_policy:
      "PRESERVE_CONCRETE_METHOD_REF_SEPARATE_FROM_FRAMEWORK_ENTRY_METHOD",
  },
  "HOOK:HOOK_EVALUATE": {
    surface: "HOOK",
    kind: "HOOK_EVALUATE",
    framework_interface_ref: `${P1_CONTRACT_REF}#/interfaces/business_hook_evaluate`,
    framework_entry_method_ref: "evaluate_business_hook",
    concrete_method_ref_policy:
      "PRESERVE_CONCRETE_METHOD_REF_SEPARATE_FROM_FRAMEWORK_ENTRY_METHOD",
  },
  "EVENT:EVENT_PUBLISH": {
    surface: "EVENT",
    kind: "EVENT_PUBLISH",
    framework_interface_ref: `${P1_CONTRACT_REF}#/interfaces/business_event_publish`,
    framework_entry_method_ref: "publish_business_event",
    concrete_method_ref_policy:
      "MUST_EQUAL_FRAMEWORK_ENTRY_METHOD_REF_UNDER_EXISTING_EVENT_CONTRACT",
  },
  "EVENT:EVENT_CONSUME": {
    surface: "EVENT",
    kind: "EVENT_CONSUME",
    framework_interface_ref: `${P1_CONTRACT_REF}#/interfaces/business_event_consume`,
    framework_entry_method_ref: "consume_business_event",
    concrete_method_ref_policy:
      "MUST_EQUAL_FRAMEWORK_ENTRY_METHOD_REF_UNDER_EXISTING_EVENT_CONTRACT",
  },
  "REGISTRY:REGISTRY_REGISTER": {
    surface: "REGISTRY",
    kind: "REGISTRY_REGISTER",
    framework_interface_ref: `${P1_CONTRACT_REF}#/interfaces/business_registry_register`,
    framework_entry_method_ref: "register_business_object",
    concrete_method_ref_policy:
      "PRESERVE_CONCRETE_METHOD_REF_SEPARATE_FROM_FRAMEWORK_ENTRY_METHOD",
  },
  "REGISTRY:REGISTRY_RESOLVE": {
    surface: "REGISTRY",
    kind: "REGISTRY_RESOLVE",
    framework_interface_ref: `${P1_CONTRACT_REF}#/interfaces/business_registry_resolve`,
    framework_entry_method_ref: "resolve_business_object",
    concrete_method_ref_policy:
      "PRESERVE_CONCRETE_METHOD_REF_SEPARATE_FROM_FRAMEWORK_ENTRY_METHOD",
  },
  "REGISTRY:REGISTRY_LOOKUP": {
    surface: "REGISTRY",
    kind: "REGISTRY_LOOKUP",
    framework_interface_ref: `${P1_CONTRACT_REF}#/interfaces/business_registry_lookup`,
    framework_entry_method_ref: "lookup_business_object",
    concrete_method_ref_policy:
      "PRESERVE_CONCRETE_METHOD_REF_SEPARATE_FROM_FRAMEWORK_ENTRY_METHOD",
  },
});

export function resolve_p1_framework_anchor(
  input: Readonly<{ surface: string; kind: string; method_ref: string }>,
): Readonly<P1FrameworkAnchorBinding> {
  const surface = required(input.surface, "surface");
  const kind = required(input.kind, "kind");
  const methodRef = required(input.method_ref, "method_ref");
  const anchor = P1_FRAMEWORK_ANCHOR_CROSSWALK[`${surface}:${kind}`];

  if (
    anchor === undefined
    || anchor.surface !== surface
    || anchor.kind !== kind
  ) {
    throw new TypeError(
      "surface/kind must resolve exactly one pre-existing P1 V0186 framework anchor",
    );
  }

  if (
    anchor.concrete_method_ref_policy
      === "MUST_EQUAL_FRAMEWORK_ENTRY_METHOD_REF_UNDER_EXISTING_EVENT_CONTRACT"
    && methodRef !== anchor.framework_entry_method_ref
  ) {
    throw new TypeError(
      "EVENT concrete method_ref must equal the existing P1 V0186 framework entry method",
    );
  }

  return anchor;
}

function required(value: string, field: string): string {
  if (value.length === 0) throw new TypeError(`${field} must be a non-empty string`);
  return value;
}

export function project_p1_capability_general_slots(
  facts: Readonly<P1CapabilityGeneralFacts>,
): P1CapabilityGeneralSlotProjection {
  for (const slotId of P1_CAPABILITY_GENERAL_SLOT_IDS) required(facts[slotId], slotId);

  if (!exact_ref(facts.capability_ref)) {
    throw new TypeError("capability_ref must be an exact versioned Capability identity");
  }
  if (!exact_ref(facts.capability_contract_ref) || facts.capability_contract_ref.includes("#/")) {
    throw new TypeError("capability_contract_ref must be an exact versioned Capability Contract ref");
  }
  if (!/^V\d{4}$/.test(facts.capability_version)) {
    throw new TypeError("capability_version must be Vdddd");
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(facts.capability_contract_content_hash)) {
    throw new TypeError("capability_contract_content_hash must be an exact sha256 hash");
  }
  if (facts.stage_contract_ref !== P1_CONTRACT_REF) {
    throw new TypeError("stage_contract_ref must equal the active P1 Business Runtime Contract");
  }
  if (facts.runtime_contract_ref !== P0_CONTRACT_REF) {
    throw new TypeError("runtime_contract_ref must equal the sole P0 Runtime Contract");
  }
  if (
    !exact_ref(facts.operation_ref)
    || facts.operation_ref !== `${facts.capability_contract_ref}#/operations/${facts.operation_id}`
  ) {
    throw new TypeError("operation_ref must exactly match the declared operation_id member");
  }
  if (
    !exact_ref(facts.interface_ref)
    || !facts.interface_ref.startsWith(`${facts.capability_contract_ref}#/interfaces/`)
  ) {
    throw new TypeError("interface_ref must be an exact member of capability_contract_ref");
  }

  resolve_p1_framework_anchor({
    surface: facts.surface,
    kind: facts.kind,
    method_ref: facts.method_ref,
  });

  return deep_freeze(
    Object.fromEntries(
      P1_CAPABILITY_GENERAL_SLOT_IDS.map((slotId) => [
        slotId,
        {
          slot_ref: P1_CAPABILITY_GENERAL_SLOT_REFS[slotId],
          value: facts[slotId],
        },
      ]),
    ) as Record<P1CapabilityGeneralSlotId, P1CapabilityGeneralSlotBinding>,
  );
}

export interface P1CapabilityOverlayBinding {
  readonly general_slots: P1CapabilityGeneralSlotProjection;
  readonly implementation_ref: string;
  readonly provided_interface_refs: readonly string[];
  readonly hook_consumer_refs?: readonly string[];
  readonly hook_binding_refs?: readonly string[];
  readonly port_refs?: readonly string[];
}

function assertExactSlot(
  projection: P1CapabilityGeneralSlotProjection,
  slotId: P1CapabilityGeneralSlotId,
): string {
  const binding = projection[slotId];
  if (binding.slot_ref !== P1_CAPABILITY_GENERAL_SLOT_REFS[slotId]) {
    throw new TypeError(`${slotId} must bind its exact predeclared P1 V0186 slot_ref`);
  }
  return required(binding.value, slotId);
}

export function create_p1_capability_stage_extension(
  binding: P1CapabilityOverlayBinding,
): StageExtensionContract {
  const capabilityContractRef = assertExactSlot(binding.general_slots, "capability_contract_ref");
  const interfaceRef = assertExactSlot(binding.general_slots, "interface_ref");
  assertExactSlot(binding.general_slots, "operation_ref");
  const surface = assertExactSlot(binding.general_slots, "surface");
  const kind = assertExactSlot(binding.general_slots, "kind");
  const methodRef = assertExactSlot(binding.general_slots, "method_ref");
  resolve_p1_framework_anchor({
    surface,
    kind,
    method_ref: methodRef,
  });

  if (binding.implementation_ref !== capabilityContractRef) {
    throw new TypeError("implementation_ref must equal the exact bound Capability Contract ref");
  }
  if (!binding.provided_interface_refs.includes(interfaceRef)) {
    throw new TypeError("provided_interface_refs must include the exact bound interface_ref");
  }

  return deep_freeze({
    stage_id: "P1",
    stage_role: "NONE",
    stage_contract_ref: P1_CONTRACT_REF,
    implementation_ref: binding.implementation_ref,
    provided_interface_refs: [...binding.provided_interface_refs],
    consumed_interface_refs: [`${P0_CONTRACT_REF}#/interfaces/runtime_execution_invoke`],
    hook_consumer_refs: [...(binding.hook_consumer_refs ?? [])],
    hook_binding_refs: [...(binding.hook_binding_refs ?? [])],
    port_refs: [...(binding.port_refs ?? [])],
    upstream_runtime_ref: P0_CONTRACT_REF,
    runtime_provider_symbol_ref: P0_PROVIDER_SYMBOL_REF,
    status: "active",
    rule_version_ref: P1_CONTRACT_REF,
  });
}
