import { createHash } from "node:crypto";

import { StableRuntimeError, deep_freeze, exact_ref } from "#q/p0/runtime_contract";
import { resolve_p1_framework_anchor } from "../src/p1/business_runtime/stage_extension_contract.ts";
import {
  handler as exposeStaticData,
  type JsonObject as StaticJsonObject,
} from "../src/p2/provider/governed_data_exposure/expose_static_data/handler.ts";
import { handler as exposeDynamicData } from "../src/p2/provider/governed_data_exposure/expose_dynamic_data/handler.ts";
import { handler as exposeRuntimeData } from "../src/p2/provider/governed_data_exposure/expose_runtime_data/handler.ts";

export const REPOSITORY_SKELETON_REF =
  "Q.SS.STD.META.CONTRACT.REPOSITORY_DIRECTORY_SKELETON@V0152" as const;
export const REPOSITORY_SKELETON_HASH =
  "sha256:0d8b2a5fb33b657db9eff3d379969b8c26e541f9ff5827d443bd8d2aa8fe60c9" as const;
export const P1_CAPABILITY_MATERIALIZATION_REF =
  "Q.SS.STD.META.CONTRACT.P1_CAPABILITY_MATERIALIZATION@V0117" as const;
export const P1_CAPABILITY_MATERIALIZATION_HASH =
  // Exact SHA-256 of the frozen P1 Materialization Source bytes.
  // This is an integrity binding, not a second semantic authority.
  "sha256:cc1d1933d88125b400b8a6f3fd0042b521f22276ff74b2dda19798ddce76757f" as const;
export const P1_BUSINESS_RUNTIME_REF =
  "Q.SS.STD.P1.CONTRACT.BUSINESS_RUNTIME@V0186" as const;
export const P2_CONTRACT_REF =
  "Q.SS.STD.P2.CONTRACT.CROSS_DOMAIN_REALIZATION@V0128" as const;
export const P2_CONTRACT_HASH =
  "sha256:15549a6a4a0c005ccbeddb0c7b40b4f4918f336c731b7c2017f05e2926bbb71d" as const;
export const GOVERNED_DATA_TRIAD_SCHEMA_REF =
  `${P2_CONTRACT_REF}#/provider_governed_data_json_triad_contract/file_projection_required_fields` as const;
export const P1_TO_P2_HANDOFF_SOURCE_BOUNDARY_REF =
  `${P1_CAPABILITY_MATERIALIZATION_REF}#/p1_to_p2_handoff_declaration_contract` as const;
export const GOVERNED_DATA_TRIAD_SOURCE_BOUNDARY_REF =
  `${P1_CAPABILITY_MATERIALIZATION_REF}#/governed_data_exposure_binding_projection_contract` as const;
export const GOVERNED_DATA_TRIAD_CATEGORY_PARTITION_REF =
  `${P2_CONTRACT_REF}#/provider_governed_data_json_triad_contract/binding_projection` as const;
export const GOVERNED_DATA_TRIAD_SET_INTEGRITY_REF =
  `${P2_CONTRACT_REF}#/provider_governed_data_json_triad_contract/materialization_integrity` as const;
export const GOVERNED_DATA_TRIAD_EXECUTION_BOUNDARY_REF =
  `${P1_CAPABILITY_MATERIALIZATION_REF}#/governed_data_exposure_binding_projection_contract/execution_boundary` as const;
export const GOVERNED_DATA_TRIAD_SET_HASH_ALGORITHM =
  "SHA256_CANONICAL_ORDERED_FILE_HASH_TUPLE" as const;

export type GovernedDataCategory = "STATIC" | "DYNAMIC" | "RUNTIME";
export type GovernedDataFilename = "static.json" | "dynamic.json" | "runtime.json";
export type P2GovernedDataOperationId =
  | "expose_static_data"
  | "expose_dynamic_data"
  | "expose_runtime_data";
export type SourceAccessKind =
  | "P1_AUTHORIZED_STATIC_OR_PACKAGE_FACT"
  | "DECLARED_Q_INTERFACE_SOURCE_FACT"
  | "AUTHORIZED_GOVERNED_STATE_OR_REGISTRY_FACT"
  | "ALREADY_PRODUCED_RUNTIME_FACT";

export interface GovernedDataHandoffMember {
  readonly member_ref: string;
  readonly source_fact_ref: string;
  readonly source_fact_authority_ref: string;
}

export interface GovernedDataHandoffBinding {
  readonly binding_ref: string;
  readonly data_category: GovernedDataCategory;
  readonly source_operation_ref: string;
  readonly source_interface_ref: string;
  readonly source_access_kind: SourceAccessKind;
  readonly source_access_ref: string;
  readonly members: readonly GovernedDataHandoffMember[];
}

export interface GovernedDataBindingExecution {
  readonly binding_ref: string;
  readonly p2_operation_input: StaticJsonObject;
  readonly runtime_context: StaticJsonObject;
  readonly trace_id: string;
  readonly request_id: string;
  readonly p1_interface_anchor_binding_ref?: string;
}

/**
 * Exact pre-instance Source Interface facts are resolved by the owning frozen
 * Capability Contract, not invented by P2, transport, test data or filenames.
 * This is a verification-only repository dependency, NOT a new Framework
 * Interface, invocation entry point, Source authority or Runtime.
 */
export interface P1SourceInterfaceResolution {
  readonly capability_contract_ref: string;
  readonly capability_contract_content_hash: string;
  readonly operation_ref: string;
  readonly interface_ref: string;
  readonly authorized_source_access_ref: string;
  readonly verified_members: readonly GovernedDataHandoffMember[];
  readonly surface: string;
  readonly kind_code: string;
  readonly kind: string;
  readonly method_ref: string;
  readonly path: readonly string[];
  readonly static_mount: readonly string[];
  readonly dynamic_mount: readonly string[];
  readonly framework_anchor_binding_ref: string;
}

export interface GovernedTriadFrozenAuthorities {
  /** Read a verified, immutable Q.Prompt obligation, not a caller's hash echo. */
  readonly frozen_prompt_projection_hash: (input: Readonly<{
    p1_capability_materialization_ref: typeof P1_CAPABILITY_MATERIALIZATION_REF;
    p1_capability_materialization_hash: typeof P1_CAPABILITY_MATERIALIZATION_HASH;
    capability_contract_ref: string;
    capability_contract_content_hash: string;
    p2_contract_ref: string;
    p2_contract_content_hash: string;
    p2_handoff_obligation_snapshot_hash: string;
  }>) => Promise<string>;
  /** Resolve P1's exact owner Capability Contract/interface closure. */
  readonly resolve_source_interface: (input: Readonly<{
    capability_contract_ref: string;
    capability_contract_content_hash: string;
    binding_ref: string;
    data_category: GovernedDataCategory;
    source_operation_ref: string;
    source_interface_ref: string;
    source_access_kind: SourceAccessKind;
    source_access_ref: string;
    members: readonly GovernedDataHandoffMember[];
  }>) => Promise<Readonly<P1SourceInterfaceResolution>>;
}

export interface P2GovernedDataExposureMaterializer {
  produce_exposure_material(input: Readonly<{
    data_category: GovernedDataCategory;
    authorized_exposure_request: StaticJsonObject;
    exact_source_authority: StaticJsonObject;
    owning_persistence_contract: StaticJsonObject;
    integrity_profile: StaticJsonObject;
    artifact_store_binding: StaticJsonObject;
  }>): Promise<StaticJsonObject>;
}

export interface GovernedDataTriadDurableStore {
  readonly authority_ref: string;
  write_file(input: Readonly<{
    filename: GovernedDataFilename;
    bytes: Uint8Array;
    content_hash: string;
  }>): Promise<void>;
  read_file(input: Readonly<{
    filename: GovernedDataFilename;
    content_hash: string;
  }>): Promise<Uint8Array>;
  compute_triad_set_hash(input: Readonly<{
    algorithm: typeof GOVERNED_DATA_TRIAD_SET_HASH_ALGORITHM;
    ordered_files: readonly Readonly<{
      filename: GovernedDataFilename;
      content_hash: string;
    }>[];
  }>): Promise<string>;
  commit_verified_triad_and_switch_current(input: Readonly<{
    ordered_files: readonly Readonly<{
      filename: GovernedDataFilename;
      content_hash: string;
    }>[];
    triad_set_hash: string;
  }>): Promise<void>;
}

export interface GovernedDataTriadRealizationInput {
  readonly p2_handoff_obligation: Readonly<Record<string, unknown>>;
  readonly governed_data_json_triad_obligation: Readonly<Record<string, unknown>>;
  /** Exact frozen V0117 projection and its independent canonical hash. */
  readonly governed_data_exposure_binding_projection: Readonly<Record<string, unknown>>;
  readonly governed_data_exposure_binding_projection_hash: string;
  readonly binding_executions: readonly GovernedDataBindingExecution[];
}

export interface GovernedDataTriadFileResult {
  readonly filename: GovernedDataFilename;
  readonly data_category: GovernedDataCategory;
  readonly p2_operation_id: P2GovernedDataOperationId;
  readonly content_hash: string;
}

export interface GovernedDataTriadRealizationResult {
  readonly repository_support_ref: typeof REPOSITORY_SKELETON_REF;
  readonly repository_support_hash: typeof REPOSITORY_SKELETON_HASH;
  readonly p1_capability_materialization_ref: typeof P1_CAPABILITY_MATERIALIZATION_REF;
  readonly p1_capability_materialization_hash: typeof P1_CAPABILITY_MATERIALIZATION_HASH;
  readonly p1_business_runtime_ref: typeof P1_BUSINESS_RUNTIME_REF;
  readonly p2_contract_ref: typeof P2_CONTRACT_REF;
  readonly p2_contract_hash: typeof P2_CONTRACT_HASH;
  readonly storage_or_persistence_authority_ref: string;
  readonly files: Readonly<{
    STATIC: GovernedDataTriadFileResult;
    DYNAMIC: GovernedDataTriadFileResult;
    RUNTIME: GovernedDataTriadFileResult;
  }>;
  readonly triad_set_hash_algorithm: typeof GOVERNED_DATA_TRIAD_SET_HASH_ALGORITHM;
  readonly triad_set_hash: string;
}

export class GovernedDataProviderRealizationError extends StableRuntimeError {
  constructor(code: string, message: string, details?: Readonly<Record<string, unknown>>) {
    super(code, message, details);
    this.name = "GovernedDataProviderRealizationError";
  }
}

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;

const CATEGORY_ACCESS = {
  STATIC: ["P1_AUTHORIZED_STATIC_OR_PACKAGE_FACT"],
  DYNAMIC: [
    "DECLARED_Q_INTERFACE_SOURCE_FACT",
    "AUTHORIZED_GOVERNED_STATE_OR_REGISTRY_FACT",
  ],
  RUNTIME: ["ALREADY_PRODUCED_RUNTIME_FACT"],
} as const satisfies Readonly<Record<GovernedDataCategory, readonly SourceAccessKind[]>>;

/** Exact V0186 Concrete Interface Kind codes, for verifying already-owned facts. */
const P1_V0186_KIND_CODES = Object.freeze({
  CALL_INVOKE: "M1",
  HOOK_BIND: "M2",
  HOOK_EVALUATE: "M3",
  EVENT_PUBLISH: "M4",
  EVENT_CONSUME: "M5",
  REGISTRY_REGISTER: "M6",
  REGISTRY_RESOLVE: "M7",
  REGISTRY_LOOKUP: "M8",
} as const);

const TRIAD_FILES = Object.freeze({
  STATIC: Object.freeze({
    filename: "static.json" as const,
    p2_operation_id: "expose_static_data" as const,
  }),
  DYNAMIC: Object.freeze({
    filename: "dynamic.json" as const,
    p2_operation_id: "expose_dynamic_data" as const,
  }),
  RUNTIME: Object.freeze({
    filename: "runtime.json" as const,
    p2_operation_id: "expose_runtime_data" as const,
  }),
});

const TRIAD_ORDER = Object.freeze([
  "STATIC",
  "DYNAMIC",
  "RUNTIME",
] as const satisfies readonly GovernedDataCategory[]);

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new GovernedDataProviderRealizationError(
      "RDS_GOVERNED_DATA_BINDING_INVALID",
      `${field} must be a non-empty string`,
    );
  }
  return value;
}

function exactHash(value: unknown, field: string): string {
  const text = requiredString(value, field);
  if (!SHA256_PATTERN.test(text)) {
    throw new GovernedDataProviderRealizationError(
      "RDS_GOVERNED_DATA_BINDING_INVALID",
      `${field} must be an exact sha256 binding`,
    );
  }
  return text;
}

function objectValue(value: unknown, field: string): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new GovernedDataProviderRealizationError(
      "RDS_GOVERNED_DATA_BINDING_INVALID",
      `${field} must be an object`,
    );
  }
  return value as Readonly<Record<string, unknown>>;
}

function arrayValue(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new GovernedDataProviderRealizationError(
      "RDS_GOVERNED_DATA_BINDING_INVALID",
      `${field} must be an array`,
    );
  }
  return value;
}

function exactCategory(value: unknown): GovernedDataCategory {
  if (value !== "STATIC" && value !== "DYNAMIC" && value !== "RUNTIME") {
    throw new GovernedDataProviderRealizationError(
      "RDS_GOVERNED_DATA_CATEGORY_INVALID",
      "data_category must be explicitly STATIC, DYNAMIC, or RUNTIME",
    );
  }
  return value;
}

function canonicalClone(value: unknown, active = new WeakSet<object>()): unknown {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new GovernedDataProviderRealizationError(
      "RDS_GOVERNED_DATA_CANONICALIZATION_FAILED",
      "non-finite numbers are not JSON facts and cannot enter a canonical projection",
    );
  }
  if (Array.isArray(value)) {
    if (active.has(value)) {
      throw new GovernedDataProviderRealizationError(
        "RDS_GOVERNED_DATA_CANONICALIZATION_FAILED",
        "cyclic JSON arrays are forbidden in an immutable projection",
      );
    }
    active.add(value);
    try {
      return value.map(member => canonicalClone(member, active));
    } finally {
      active.delete(value);
    }
  }
  if (value !== null && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new GovernedDataProviderRealizationError(
        "RDS_GOVERNED_DATA_CANONICALIZATION_FAILED",
        "a frozen projection must contain JSON objects, not class or host instances",
      );
    }
    if (active.has(value)) {
      throw new GovernedDataProviderRealizationError(
        "RDS_GOVERNED_DATA_CANONICALIZATION_FAILED",
        "cyclic JSON objects are forbidden in an immutable projection",
      );
    }
    active.add(value);
    try {
      const source = value as Record<string, unknown>;
      const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      for (const key of Object.keys(source).sort()) {
        const nested = source[key];
        if (nested === undefined) {
          throw new GovernedDataProviderRealizationError(
            "RDS_GOVERNED_DATA_CANONICALIZATION_FAILED",
            `undefined JSON member is forbidden: ${key}`,
          );
        }
        out[key] = canonicalClone(nested, active);
      }
      return out;
    } finally {
      active.delete(value);
    }
  }
  if (
    value === undefined || typeof value === "bigint"
    || typeof value === "function" || typeof value === "symbol"
  ) {
    throw new GovernedDataProviderRealizationError(
      "RDS_GOVERNED_DATA_CANONICALIZATION_FAILED",
      "triad projection must contain exact JSON values only",
    );
  }
  return value;
}

function canonicalJson(value: unknown): string {
  const serialized = JSON.stringify(canonicalClone(value));
  if (serialized === undefined) {
    throw new GovernedDataProviderRealizationError(
      "RDS_GOVERNED_DATA_CANONICALIZATION_FAILED",
      "triad projection did not produce canonical JSON",
    );
  }
  return serialized;
}

function canonicalBytes(value: unknown): Uint8Array {
  return Buffer.from(canonicalJson(value), "utf8");
}

function sha256Bytes(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function sha256Json(value: unknown): string {
  return sha256Bytes(canonicalBytes(value));
}

function withoutField(
  value: Readonly<Record<string, unknown>>,
  field: string,
): Readonly<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (key !== field) out[key] = nested;
  }
  return out;
}

function validateHandoffBinding(value: unknown): GovernedDataHandoffBinding {
  const binding = objectValue(value, "p2_handoff_obligation.governed_data_exposure.bindings[]");
  const bindingRef = requiredString(binding.binding_ref, "binding_ref");
  const category = exactCategory(binding.data_category);
  const sourceOperationRef = requiredString(binding.source_operation_ref, `${bindingRef}.source_operation_ref`);
  const sourceInterfaceRef = requiredString(binding.source_interface_ref, `${bindingRef}.source_interface_ref`);
  const sourceAccessKind = requiredString(
    binding.source_access_kind,
    `${bindingRef}.source_access_kind`,
  ) as SourceAccessKind;
  if (!(CATEGORY_ACCESS[category] as readonly string[]).includes(sourceAccessKind)) {
    throw new GovernedDataProviderRealizationError(
      "RDS_GOVERNED_DATA_SOURCE_ACCESS_INVALID",
      `${bindingRef} source_access_kind is not allowed for ${category}`,
    );
  }
  const sourceAccessRef = requiredString(
    binding.source_access_ref,
    `${bindingRef}.source_access_ref`,
  );
  const membersRaw = arrayValue(binding.members, `${bindingRef}.members`);
  if (membersRaw.length === 0) {
    throw new GovernedDataProviderRealizationError(
      "RDS_GOVERNED_DATA_BINDING_INVALID",
      `${bindingRef}.members must be non-empty`,
    );
  }
  const memberRefs = new Set<string>();
  const members = membersRaw.map((memberValue) => {
    const member = objectValue(memberValue, `${bindingRef}.members[]`);
    const memberRef = requiredString(member.member_ref, `${bindingRef}.members[].member_ref`);
    if (memberRefs.has(memberRef)) {
      throw new GovernedDataProviderRealizationError(
        "RDS_GOVERNED_DATA_BINDING_INVALID",
        `${bindingRef} contains duplicate member_ref ${memberRef}`,
      );
    }
    memberRefs.add(memberRef);
    return Object.freeze({
      member_ref: memberRef,
      source_fact_ref: requiredString(
        member.source_fact_ref,
        `${bindingRef}.${memberRef}.source_fact_ref`,
      ),
      source_fact_authority_ref: requiredString(
        member.source_fact_authority_ref,
        `${bindingRef}.${memberRef}.source_fact_authority_ref`,
      ),
    });
  });
  const canonicalMemberRefs = [...memberRefs].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  if (members.some((member, index) => member.member_ref !== canonicalMemberRefs[index])) {
    throw new GovernedDataProviderRealizationError(
      "RDS_GOVERNED_DATA_BINDING_ORDER_INVALID",
      `${bindingRef}.members must already be ordered by member_ref_ASCENDING`,
    );
  }

  return Object.freeze({
    binding_ref: bindingRef,
    data_category: category,
    source_operation_ref: sourceOperationRef,
    source_interface_ref: sourceInterfaceRef,
    source_access_kind: sourceAccessKind,
    source_access_ref: sourceAccessRef,
    members: Object.freeze(members),
  });
}

function validateP2HandoffObligation(
  value: Readonly<Record<string, unknown>>,
): Readonly<{
  capability_contract_ref: string;
  capability_contract_hash: string;
  p2_handoff_obligation_snapshot_hash: string;
  bindings: readonly GovernedDataHandoffBinding[];
}> {
  if (value.source_boundary_ref !== P1_TO_P2_HANDOFF_SOURCE_BOUNDARY_REF) {
    throw new GovernedDataProviderRealizationError(
      "RDS_GOVERNED_DATA_HANDOFF_OBLIGATION_INVALID",
      `p2_handoff_obligation source_boundary_ref must bind ${P1_TO_P2_HANDOFF_SOURCE_BOUNDARY_REF}`,
    );
  }
  if (value.canonical_binding_order !== "binding_ref_ASCENDING_THEN_member_ref_ASCENDING") {
    throw new GovernedDataProviderRealizationError(
      "RDS_GOVERNED_DATA_HANDOFF_OBLIGATION_INVALID",
      "p2_handoff_obligation canonical_binding_order mismatch",
    );
  }

  const capabilityContractRef = requiredString(
    value.source_capability_contract_ref,
    "p2_handoff_obligation.source_capability_contract_ref",
  );
  const capabilityContractHash = exactHash(
    value.source_capability_contract_hash,
    "p2_handoff_obligation.source_capability_contract_hash",
  );
  if (!exact_ref(capabilityContractRef) || capabilityContractRef.includes("#/")) {
    throw new GovernedDataProviderRealizationError(
      "RDS_GOVERNED_DATA_SOURCE_IDENTITY_INVALID",
      "V0117 requires an exact versioned owner Capability Contract identity",
    );
  }
  // V0117 p2_handoff has two independent required declarations.
  // This Provider path does not execute capability publication, but it must
  // not silently accept an incomplete or retargeted Handoff declaration.
  const publication = objectValue(
    value.capability_publication,
    "p2_handoff_obligation.capability_publication",
  );
  if (
    (publication.mode !== "NONE" && publication.mode !== "PUBLICATION_ELIGIBLE")
    || publication.external_provider_surface_ref !==
      `${capabilityContractRef}#/external_provider_surface`
  ) {
    throw new GovernedDataProviderRealizationError(
      "RDS_GOVERNED_DATA_HANDOFF_OBLIGATION_INVALID",
      "V0117 requires an exact capability_publication mode and owning external_provider_surface_ref",
    );
  }
  if (value.exact_current_p2_ref !== P2_CONTRACT_REF) {
    throw new GovernedDataProviderRealizationError(
      "RDS_GOVERNED_DATA_AUTHORITY_MISMATCH",
      `p2_handoff_obligation exact_current_p2_ref must equal ${P2_CONTRACT_REF}`,
    );
  }
  if (value.exact_current_p2_hash !== P2_CONTRACT_HASH) {
    throw new GovernedDataProviderRealizationError(
      "RDS_GOVERNED_DATA_AUTHORITY_MISMATCH",
      "p2_handoff_obligation exact_current_p2_hash mismatch",
    );
  }

  const expectedSnapshotHash = sha256Json(
    withoutField(value, "p2_handoff_obligation_snapshot_hash"),
  );
  const actualSnapshotHash = exactHash(
    value.p2_handoff_obligation_snapshot_hash,
    "p2_handoff_obligation.p2_handoff_obligation_snapshot_hash",
  );
  if (actualSnapshotHash !== expectedSnapshotHash) {
    throw new GovernedDataProviderRealizationError(
      "RDS_GOVERNED_DATA_HANDOFF_SNAPSHOT_HASH_MISMATCH",
      "p2_handoff_obligation snapshot hash does not match exact canonical obligation",
    );
  }

  const exposure = objectValue(
    value.governed_data_exposure,
    "p2_handoff_obligation.governed_data_exposure",
  );
  if (exposure.mode !== "DECLARED") {
    throw new GovernedDataProviderRealizationError(
      "RDS_GOVERNED_DATA_NOT_DECLARED",
      "triad execution requires exact governed_data_exposure mode DECLARED",
    );
  }
  const bindingValues = arrayValue(
    exposure.bindings,
    "p2_handoff_obligation.governed_data_exposure.bindings",
  );
  if (bindingValues.length === 0) {
    throw new GovernedDataProviderRealizationError(
      "RDS_GOVERNED_DATA_BINDING_INVALID",
      "DECLARED governed_data_exposure requires non-empty exact bindings",
    );
  }

  const refs = new Set<string>();
  const sourceInterfaceCategories = new Map<string, GovernedDataCategory>();
  const bindings = bindingValues.map(validateHandoffBinding);
  for (const binding of bindings) {
    for (const [key, ref] of [
      ["source_operation_ref", binding.source_operation_ref],
      ["source_interface_ref", binding.source_interface_ref],
    ] as const) {
      const collection = key === "source_operation_ref" ? "operations" : "interfaces";
      const prefix = `${capabilityContractRef}#/${collection}/`;
      if (!exact_ref(ref) || !ref.startsWith(prefix) || ref.length <= prefix.length) {
        throw new GovernedDataProviderRealizationError(
          "RDS_GOVERNED_DATA_SOURCE_IDENTITY_INVALID",
          `${binding.binding_ref} must bind an exact ${collection} member of the owner Capability Contract`,
        );
      }
    }
    const category = sourceInterfaceCategories.get(binding.source_interface_ref);
    if (category !== undefined && category !== binding.data_category) {
      throw new GovernedDataProviderRealizationError(
        "RDS_GOVERNED_DATA_SOURCE_INTERFACE_CATEGORY_CONFLICT",
        "V0117 forbids one concrete source Interface in multiple governed-data categories",
      );
    }
    sourceInterfaceCategories.set(binding.source_interface_ref, binding.data_category);
    if (refs.has(binding.binding_ref)) {
      throw new GovernedDataProviderRealizationError(
        "RDS_GOVERNED_DATA_BINDING_INVALID",
        `duplicate governed-data binding_ref: ${binding.binding_ref}`,
      );
    }
    refs.add(binding.binding_ref);
  }

  const canonicalBindingRefs = bindings
    .map((binding) => binding.binding_ref)
    .slice()
    .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  if (bindings.some((binding, index) => binding.binding_ref !== canonicalBindingRefs[index])) {
    throw new GovernedDataProviderRealizationError(
      "RDS_GOVERNED_DATA_BINDING_ORDER_INVALID",
      "governed_data_exposure.bindings must already be ordered by binding_ref_ASCENDING",
    );
  }

  return Object.freeze({
    capability_contract_ref: capabilityContractRef,
    capability_contract_hash: capabilityContractHash,
    p2_handoff_obligation_snapshot_hash: actualSnapshotHash,
    bindings: Object.freeze(bindings),
  });
}

function validateTriadObligation(
  value: Readonly<Record<string, unknown>>,
  handoff: Readonly<{
    capability_contract_ref: string;
    capability_contract_hash: string;
  }>,
): void {
  if (value.source_boundary_ref !== GOVERNED_DATA_TRIAD_SOURCE_BOUNDARY_REF) {
    throw new GovernedDataProviderRealizationError(
      "RDS_GOVERNED_DATA_TRIAD_OBLIGATION_INVALID",
      `triad source_boundary_ref must bind ${GOVERNED_DATA_TRIAD_SOURCE_BOUNDARY_REF}`,
    );
  }
  if (value.applicability !== "DECLARED") {
    throw new GovernedDataProviderRealizationError(
      "RDS_GOVERNED_DATA_NOT_DECLARED",
      "triad execution requires governed_data_json_triad_obligation.applicability DECLARED",
    );
  }
  if (
    value.source_capability_contract_ref !== handoff.capability_contract_ref
    || value.source_capability_contract_hash !== handoff.capability_contract_hash
  ) {
    throw new GovernedDataProviderRealizationError(
      "RDS_GOVERNED_DATA_TRIAD_OBLIGATION_INVALID",
      "triad source Capability Contract ref/hash must equal exact p2_handoff obligation source",
    );
  }
  if (
    value.exact_current_p2_ref !== P2_CONTRACT_REF
    || value.exact_current_p2_hash !== P2_CONTRACT_HASH
  ) {
    throw new GovernedDataProviderRealizationError(
      "RDS_GOVERNED_DATA_AUTHORITY_MISMATCH",
      "triad exact CURRENT P2/GDM authority binding mismatch",
    );
  }
  if (
    value.canonical_json_schema_ref !== GOVERNED_DATA_TRIAD_SCHEMA_REF
    || value.category_partition_ref !== GOVERNED_DATA_TRIAD_CATEGORY_PARTITION_REF
    || value.triad_set_integrity_ref !== GOVERNED_DATA_TRIAD_SET_INTEGRITY_REF
    || value.execution_boundary_ref !== GOVERNED_DATA_TRIAD_EXECUTION_BOUNDARY_REF
  ) {
    throw new GovernedDataProviderRealizationError(
      "RDS_GOVERNED_DATA_TRIAD_OBLIGATION_INVALID",
      "triad schema/category/integrity/execution refs must equal the declared frozen P1/P2 boundaries",
    );
  }

  const fileSet = objectValue(
    value.canonical_file_set,
    "governed_data_json_triad_obligation.canonical_file_set",
  );
  const keys = Object.keys(fileSet).sort();
  if (keys.join(",") !== "DYNAMIC,RUNTIME,STATIC") {
    throw new GovernedDataProviderRealizationError(
      "RDS_GOVERNED_DATA_TRIAD_OBLIGATION_INVALID",
      "triad canonical_file_set must contain exactly STATIC/DYNAMIC/RUNTIME",
    );
  }
  for (const category of TRIAD_ORDER) {
    const item = objectValue(fileSet[category], `canonical_file_set.${category}`);
    const expected = TRIAD_FILES[category];
    if (
      item.filename !== expected.filename
      || item.p2_operation_id !== expected.p2_operation_id
    ) {
      throw new GovernedDataProviderRealizationError(
        "RDS_GOVERNED_DATA_TRIAD_OBLIGATION_INVALID",
        `canonical_file_set.${category} identity mismatch`,
      );
    }
  }
}

/**
 * V0117 immutable pre-instance binding projection is independent of the P2
 * physical JSON triad. It must be verified before any Provider execution or
 * durable write; neither code nor category names may reconstruct it.
 */
function verifyFrozenV0117Projection(
  projectionValue: Readonly<Record<string, unknown>>,
  suppliedHash: string,
  handoff: Readonly<{
    capability_contract_ref: string;
    capability_contract_hash: string;
    p2_handoff_obligation_snapshot_hash: string;
    bindings: readonly GovernedDataHandoffBinding[];
  }>,
): void {
  const projection = objectValue(projectionValue, "governed_data_exposure_binding_projection");
  const hash = exactHash(suppliedHash, "governed_data_exposure_binding_projection_hash");
  if (sha256Json(projection) !== hash) {
    throw new GovernedDataProviderRealizationError(
      "RDS_GOVERNED_DATA_PROJECTION_HASH_MISMATCH",
      "V0117 frozen binding projection SHA256 does not match exact canonical bytes",
    );
  }
  // V0117 names the two exact ref+hash root facts but does not prescribe
  // inner keys such as {ref,hash}. Check their exact scalar facts without
  // promoting a test-fixture object shape into a new Contract schema.
  const exactPair = (value: unknown, field: string, expectedRef: string, expectedHash: string): boolean => {
    const pair = objectValue(value, field);
    const values = Object.values(pair);
    return values.length === 2 && values.includes(expectedRef) && values.includes(expectedHash);
  };
  if (
    !exactPair(
      projection.exact_capability_contract_ref_and_hash,
      "exact_capability_contract_ref_and_hash",
      handoff.capability_contract_ref,
      handoff.capability_contract_hash,
    )
    || !exactPair(
      projection.exact_frozen_current_p2_ref_and_hash,
      "exact_frozen_current_p2_ref_and_hash",
      P2_CONTRACT_REF,
      P2_CONTRACT_HASH,
    )
    || projection.p2_handoff_obligation_snapshot_hash !== handoff.p2_handoff_obligation_snapshot_hash
  ) {
    throw new GovernedDataProviderRealizationError(
      "RDS_GOVERNED_DATA_PROJECTION_IDENTITY_MISMATCH",
      "V0117 projection must bind exact source Capability, P2 and Handoff snapshot identities",
    );
  }
  const bindings = arrayValue(projection.bindings, "governed_data_exposure_binding_projection.bindings");
  if (bindings.length !== handoff.bindings.length) {
    throw new GovernedDataProviderRealizationError(
      "RDS_GOVERNED_DATA_PROJECTION_BINDING_MISMATCH",
      "frozen V0117 projection must contain every exact Handoff binding once",
    );
  }
  const seen = new Set<string>();
  for (let index = 0; index < bindings.length; index++) {
    const b = objectValue(bindings[index], "projection.bindings[]");
    const source = handoff.bindings[index];
    if (!source) throw new Error("unreachable projection index");
    const id = requiredString(b.binding_ref, "projection.binding_ref");
    if (seen.has(id) || id !== source.binding_ref) {
      throw new GovernedDataProviderRealizationError(
        "RDS_GOVERNED_DATA_PROJECTION_BINDING_MISMATCH",
        "V0117 frozen projection binding identity/order differs from Handoff",
      );
    }
    seen.add(id);
    for (const field of [
      "data_category", "source_operation_ref", "source_interface_ref",
      "source_access_kind", "source_access_ref",
    ] as const) {
      if (b[field] !== source[field]) {
        throw new GovernedDataProviderRealizationError(
          "RDS_GOVERNED_DATA_PROJECTION_BINDING_MISMATCH",
          `V0117 projection ${id}.${field} differs from frozen Handoff`,
        );
      }
    }
    const expectedOperation = TRIAD_FILES[source.data_category].p2_operation_id;
    if (
      b.target_p2_operation_id !== expectedOperation
      || b.target_p2_operation_catalog_ref !== `${P2_CONTRACT_REF}#/operation_catalog/provider/governed_data_exposure`
      || b.target_p2_primary_interface_profile_ref !== `${P2_CONTRACT_REF}#/interface_semantics/new_governed_data_operations_primary_interface`
      || b.target_p2_carrier_binding_ref !== `${P2_CONTRACT_REF}#/governed_data_material_contract/q_interface_carrier_binding`
    ) {
      throw new GovernedDataProviderRealizationError(
        "RDS_GOVERNED_DATA_PROJECTION_TARGET_MISMATCH",
        "V0117 target Operation, profile and carrier must match the frozen P2 authority",
      );
    }
    const instanceRefs = arrayValue(b.declared_instance_variable_refs, `${id}.declared_instance_variable_refs`);
    if (
      instanceRefs.some(ref => typeof ref !== "string" || !exact_ref(ref))
      || new Set(instanceRefs).size !== instanceRefs.length
    ) {
      throw new GovernedDataProviderRealizationError(
        "RDS_GOVERNED_DATA_PROJECTION_BINDING_MISMATCH",
        "instance variable refs must be unique exact declared identities, not instance values",
      );
    }
    const members = arrayValue(b.members, `${id}.members`);
    if (sha256Json(members) !== sha256Json(source.members)) {
      throw new GovernedDataProviderRealizationError(
        "RDS_GOVERNED_DATA_PROJECTION_BINDING_MISMATCH",
        "V0117 projection members differ from frozen source binding",
      );
    }
  }
}

/**
 * Read, don't invent, both upstream proofs. The verifier's two adapters are
 * supplied by the governed outer boundary: Q.Prompt's immutable snapshot and
 * the exact owner Capability Contract. Nothing here acts as a P2 source resolver,
 * generates a Framework anchor, or expands the provider's semantic authority.
 */
async function verifyFrozenPreInstanceClosure(
  handoff: Readonly<{
    capability_contract_ref: string;
    capability_contract_hash: string;
    p2_handoff_obligation_snapshot_hash: string;
    bindings: readonly GovernedDataHandoffBinding[];
  }>,
  projection_hash: string,
  executions: ReadonlyMap<string, GovernedDataBindingExecution>,
  authorities: GovernedTriadFrozenAuthorities,
): Promise<void> {
  if (
    !authorities
    || typeof authorities.frozen_prompt_projection_hash !== "function"
    || typeof authorities.resolve_source_interface !== "function"
  ) {
    throw new GovernedDataProviderRealizationError(
      "RDS_GOVERNED_DATA_AUTHORITY_UNAVAILABLE",
      "V0117 requires frozen Q.Prompt and exact source Capability Contract verification before P2 exposure",
    );
  }

  const exactPromptHash = exactHash(
    await authorities.frozen_prompt_projection_hash(Object.freeze({
      p1_capability_materialization_ref: P1_CAPABILITY_MATERIALIZATION_REF,
      p1_capability_materialization_hash: P1_CAPABILITY_MATERIALIZATION_HASH,
      capability_contract_ref: handoff.capability_contract_ref,
      capability_contract_content_hash: handoff.capability_contract_hash,
      p2_contract_ref: P2_CONTRACT_REF,
      p2_contract_content_hash: P2_CONTRACT_HASH,
      p2_handoff_obligation_snapshot_hash: handoff.p2_handoff_obligation_snapshot_hash,
    })),
    "frozen_prompt_projection_hash",
  );
  if (exactPromptHash !== projection_hash) {
    throw new GovernedDataProviderRealizationError(
      "RDS_GOVERNED_DATA_PROMPT_PROJECTION_MISMATCH",
      "V0117 projection hash must equal the independently verified immutable Q.Prompt obligation hash",
    );
  }

  for (const binding of handoff.bindings) {
    const execution = executions.get(binding.binding_ref);
    if (!execution) {
      throw new GovernedDataProviderRealizationError(
        "RDS_GOVERNED_DATA_EXECUTION_BINDING_INVALID",
        "every declared V0117 binding must have one execution before exposure",
      );
    }
    const source: Readonly<P1SourceInterfaceResolution> =
      await authorities.resolve_source_interface(Object.freeze({
        capability_contract_ref: handoff.capability_contract_ref,
        capability_contract_content_hash: handoff.capability_contract_hash,
        binding_ref: binding.binding_ref,
        data_category: binding.data_category,
        source_operation_ref: binding.source_operation_ref,
        source_interface_ref: binding.source_interface_ref,
        source_access_kind: binding.source_access_kind,
        source_access_ref: binding.source_access_ref,
        members: binding.members,
      }));
    if (
      source === null || typeof source !== "object"
      || source.capability_contract_ref !== handoff.capability_contract_ref
      || source.capability_contract_content_hash !== handoff.capability_contract_hash
      || source.operation_ref !== binding.source_operation_ref
      || source.interface_ref !== binding.source_interface_ref
      || source.authorized_source_access_ref !== binding.source_access_ref
      || sha256Json(source.verified_members) !== sha256Json(binding.members)
    ) {
      throw new GovernedDataProviderRealizationError(
        "RDS_GOVERNED_DATA_SOURCE_INTERFACE_MISMATCH",
        "exact owner Operation, Interface, source-access authorization and member lineage must match frozen V0117 binding",
      );
    }
    let anchor: ReturnType<typeof resolve_p1_framework_anchor>;
    try {
      anchor = resolve_p1_framework_anchor({
        surface: source.surface,
        kind: source.kind,
        method_ref: source.method_ref,
      });
    } catch {
      throw new GovernedDataProviderRealizationError(
        "RDS_GOVERNED_DATA_SOURCE_ANCHOR_INVALID",
        "source Interface Surface/Kind/Method must resolve exactly one pre-existing V0186 Framework anchor",
      );
    }
    const expectedAnchorRef =
      `${P1_BUSINESS_RUNTIME_REF}#/concrete_interface_framework_anchor_crosswalk/anchors/${anchor.kind}`;
    const code = P1_V0186_KIND_CODES[anchor.kind as keyof typeof P1_V0186_KIND_CODES];
    if (
      !code || source.kind_code !== code
      || source.framework_anchor_binding_ref !== expectedAnchorRef
      || execution.p1_interface_anchor_binding_ref !== expectedAnchorRef
    ) {
      throw new GovernedDataProviderRealizationError(
        "RDS_GOVERNED_DATA_SOURCE_ANCHOR_INVALID",
        "source Interface execution requires p1_interface_anchor_binding_ref from its pre-instance V0186 Framework anchor",
      );
    }
    const layerFields: string[] = [];
    for (const layer of ["path", "static_mount", "dynamic_mount"] as const) {
      const facts = source[layer];
      if (
        !Array.isArray(facts)
        || facts.some((field: unknown) => typeof field !== "string" || field.length === 0)
      ) {
        throw new GovernedDataProviderRealizationError(
          "RDS_GOVERNED_DATA_SOURCE_INTERFACE_MISMATCH",
          "source Interface must carry complete declared PATH/STATIC_MOUNT/DYNAMIC_MOUNT field sets",
        );
      }
      layerFields.push(...facts);
    }
    if (new Set(layerFields).size !== layerFields.length) {
      throw new GovernedDataProviderRealizationError(
        "RDS_GOVERNED_DATA_SOURCE_INTERFACE_MISMATCH",
        "source Interface Layer field identities must be unique and disjoint",
      );
    }
  }
}

function executionMap(
  executions: readonly GovernedDataBindingExecution[],
  bindings: readonly GovernedDataHandoffBinding[],
): ReadonlyMap<string, GovernedDataBindingExecution> {
  const declared = new Set(bindings.map((binding) => binding.binding_ref));
  const mapped = new Map<string, GovernedDataBindingExecution>();
  for (const execution of executions) {
    const ref = requiredString(execution.binding_ref, "binding_executions[].binding_ref");
    if (!declared.has(ref)) {
      throw new GovernedDataProviderRealizationError(
        "RDS_GOVERNED_DATA_EXECUTION_BINDING_INVALID",
        `execution supplied for undeclared binding_ref: ${ref}`,
      );
    }
    if (mapped.has(ref)) {
      throw new GovernedDataProviderRealizationError(
        "RDS_GOVERNED_DATA_EXECUTION_BINDING_INVALID",
        `duplicate execution supplied for binding_ref: ${ref}`,
      );
    }
    requiredString(execution.trace_id, `${ref}.trace_id`);
    requiredString(execution.request_id, `${ref}.request_id`);
    mapped.set(ref, execution);
  }
  if (mapped.size !== bindings.length) {
    const missing = bindings
      .map((binding) => binding.binding_ref)
      .filter((ref) => !mapped.has(ref));
    throw new GovernedDataProviderRealizationError(
      "RDS_GOVERNED_DATA_EXECUTION_BINDING_INVALID",
      `every declared non-empty binding requires one exact execution input; missing: ${missing.join(",")}`,
    );
  }
  return mapped;
}

async function executeBinding(
  binding: GovernedDataHandoffBinding,
  execution: GovernedDataBindingExecution,
  materialization: P2GovernedDataExposureMaterializer,
): Promise<StaticJsonObject> {
  if (
    binding.source_access_kind === "DECLARED_Q_INTERFACE_SOURCE_FACT"
    && (
      execution.p1_interface_anchor_binding_ref === undefined
      || execution.p1_interface_anchor_binding_ref.length === 0
    )
  ) {
    throw new GovernedDataProviderRealizationError(
      "RDS_GOVERNED_DATA_SOURCE_ACCESS_INVALID",
      `${binding.binding_ref} requires p1_interface_anchor_binding_ref`,
    );
  }
  if (
    binding.data_category === "RUNTIME"
    && execution.p2_operation_input.reexecution_requested === true
  ) {
    throw new GovernedDataProviderRealizationError(
      "RDS_GOVERNED_DATA_RUNTIME_REEXECUTION_FORBIDDEN",
      "RUNTIME exposure may use only already-produced runtime facts",
    );
  }

  const request = Object.freeze({
    input: execution.p2_operation_input,
    runtime_context: execution.runtime_context,
    trace_id: execution.trace_id,
    request_id: execution.request_id,
  });
  const dependencies = Object.freeze({
    materialize_governed_data: (
      materializationInput: Parameters<
        P2GovernedDataExposureMaterializer["produce_exposure_material"]
      >[0],
    ) => materialization.produce_exposure_material(materializationInput),
  });

  let response: Awaited<ReturnType<typeof exposeStaticData>>;
  switch (binding.data_category) {
    case "STATIC":
      response = await exposeStaticData(request, dependencies);
      break;
    case "DYNAMIC":
      response = await exposeDynamicData(request, dependencies);
      break;
    case "RUNTIME":
      response = await exposeRuntimeData(request, dependencies);
      break;
  }

  const resultCategory = response.runtime_result.data_category;
  if (resultCategory !== binding.data_category) {
    throw new GovernedDataProviderRealizationError(
      "RDS_GOVERNED_DATA_P2_RESULT_MISMATCH",
      `P2 result category does not match binding ${binding.binding_ref}`,
    );
  }
  return objectValue(
    response.runtime_result.material_envelope,
    `${binding.binding_ref}.runtime_result.material_envelope`,
  );
}

function projectBinding(binding: GovernedDataHandoffBinding): StaticJsonObject {
  return Object.freeze({
    binding_ref: binding.binding_ref,
    data_category: binding.data_category,
    source_operation_ref: binding.source_operation_ref,
    source_interface_ref: binding.source_interface_ref,
    source_access_kind: binding.source_access_kind,
    source_access_ref: binding.source_access_ref,
    members: Object.freeze(
      binding.members.map((member) => Object.freeze({
        member_ref: member.member_ref,
        source_fact_ref: member.source_fact_ref,
        source_fact_authority_ref: member.source_fact_authority_ref,
      })),
    ),
  });
}

export async function realizeGovernedDataTriad(
  input: Readonly<GovernedDataTriadRealizationInput>,
  materialization: P2GovernedDataExposureMaterializer,
  store: GovernedDataTriadDurableStore,
  authorities: GovernedTriadFrozenAuthorities,
): Promise<GovernedDataTriadRealizationResult> {
  const storeAuthorityRef = requiredString(
    store.authority_ref,
    "storage_or_persistence_authority_ref",
  );

  const handoff = validateP2HandoffObligation(input.p2_handoff_obligation);
  validateTriadObligation(input.governed_data_json_triad_obligation, handoff);
  verifyFrozenV0117Projection(
    input.governed_data_exposure_binding_projection,
    input.governed_data_exposure_binding_projection_hash,
    handoff,
  );
  const executions = executionMap(input.binding_executions, handoff.bindings);
  await verifyFrozenPreInstanceClosure(
    handoff,
    input.governed_data_exposure_binding_projection_hash,
    executions,
    authorities,
  );

  const projectedFiles = new Map<
    GovernedDataCategory,
    Readonly<{
      filename: GovernedDataFilename;
      p2_operation_id: P2GovernedDataOperationId;
      bytes: Uint8Array;
      content_hash: string;
    }>
  >();

  for (const category of TRIAD_ORDER) {
    const bindings = handoff.bindings.filter((binding) => binding.data_category === category);
    const materialEnvelopes: StaticJsonObject[] = [];
    for (const binding of bindings) {
      const execution = executions.get(binding.binding_ref);
      if (execution === undefined) {
        throw new GovernedDataProviderRealizationError(
          "RDS_GOVERNED_DATA_EXECUTION_BINDING_INVALID",
          `missing execution for ${binding.binding_ref}`,
        );
      }
      materialEnvelopes.push(
        await executeBinding(binding, execution, materialization),
      );
    }

    const fileValue = Object.freeze({
      schema_ref: GOVERNED_DATA_TRIAD_SCHEMA_REF,
      capability_contract_ref: handoff.capability_contract_ref,
      capability_contract_content_hash: handoff.capability_contract_hash,
      p2_contract_ref: P2_CONTRACT_REF,
      p2_contract_content_hash: P2_CONTRACT_HASH,
      p2_handoff_obligation_snapshot_hash: handoff.p2_handoff_obligation_snapshot_hash,
      data_category: category,
      bindings: Object.freeze(bindings.map(projectBinding)),
      material_envelopes: Object.freeze(materialEnvelopes),
    });
    const bytes = canonicalBytes(fileValue);
    const expected = TRIAD_FILES[category];
    projectedFiles.set(category, Object.freeze({
      filename: expected.filename,
      p2_operation_id: expected.p2_operation_id,
      bytes,
      content_hash: sha256Bytes(bytes),
    }));
  }

  for (const category of TRIAD_ORDER) {
    const file = projectedFiles.get(category);
    if (file === undefined) throw new Error("unreachable triad projection");
    await store.write_file(Object.freeze({
      filename: file.filename,
      bytes: file.bytes,
      content_hash: file.content_hash,
    }));
  }

  for (const category of TRIAD_ORDER) {
    const file = projectedFiles.get(category);
    if (file === undefined) throw new Error("unreachable triad projection");
    const readback = await store.read_file(Object.freeze({
      filename: file.filename,
      content_hash: file.content_hash,
    }));
    if (sha256Bytes(readback) !== file.content_hash) {
      throw new GovernedDataProviderRealizationError(
        "RDS_GOVERNED_DATA_TRIAD_READBACK_HASH_MISMATCH",
        `${file.filename} exact read-back hash mismatch`,
      );
    }
  }

  const orderedFiles = Object.freeze(
    TRIAD_ORDER.map((category) => {
      const file = projectedFiles.get(category);
      if (file === undefined) throw new Error("unreachable triad projection");
      return Object.freeze({
        filename: file.filename,
        content_hash: file.content_hash,
      });
    }),
  );
  const triadSetHash = exactHash(
    await store.compute_triad_set_hash(Object.freeze({
      algorithm: GOVERNED_DATA_TRIAD_SET_HASH_ALGORITHM,
      ordered_files: orderedFiles,
    })),
    "triad_set_hash",
  );

  await store.commit_verified_triad_and_switch_current(Object.freeze({
    ordered_files: orderedFiles,
    triad_set_hash: triadSetHash,
  }));

  const staticFile = projectedFiles.get("STATIC");
  const dynamicFile = projectedFiles.get("DYNAMIC");
  const runtimeFile = projectedFiles.get("RUNTIME");
  if (staticFile === undefined || dynamicFile === undefined || runtimeFile === undefined) {
    throw new Error("unreachable triad result");
  }

  return deep_freeze({
    repository_support_ref: REPOSITORY_SKELETON_REF,
    repository_support_hash: REPOSITORY_SKELETON_HASH,
    p1_capability_materialization_ref: P1_CAPABILITY_MATERIALIZATION_REF,
    p1_capability_materialization_hash: P1_CAPABILITY_MATERIALIZATION_HASH,
    p1_business_runtime_ref: P1_BUSINESS_RUNTIME_REF,
    p2_contract_ref: P2_CONTRACT_REF,
    p2_contract_hash: P2_CONTRACT_HASH,
    storage_or_persistence_authority_ref: storeAuthorityRef,
    files: Object.freeze({
      STATIC: Object.freeze({
        filename: staticFile.filename,
        data_category: "STATIC" as const,
        p2_operation_id: staticFile.p2_operation_id,
        content_hash: staticFile.content_hash,
      }),
      DYNAMIC: Object.freeze({
        filename: dynamicFile.filename,
        data_category: "DYNAMIC" as const,
        p2_operation_id: dynamicFile.p2_operation_id,
        content_hash: dynamicFile.content_hash,
      }),
      RUNTIME: Object.freeze({
        filename: runtimeFile.filename,
        data_category: "RUNTIME" as const,
        p2_operation_id: runtimeFile.p2_operation_id,
        content_hash: runtimeFile.content_hash,
      }),
    }),
    triad_set_hash_algorithm: GOVERNED_DATA_TRIAD_SET_HASH_ALGORITHM,
    triad_set_hash: triadSetHash,
  });
}
