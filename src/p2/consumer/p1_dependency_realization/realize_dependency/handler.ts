import { createHash } from "node:crypto";

export type JsonObject = Readonly<Record<string, unknown>>;
export interface P2OperationRequest { readonly input: JsonObject; readonly runtime_context: JsonObject; readonly trace_id: string; readonly request_id: string; }
export interface P2OperationResponse { readonly outcome_type: "response"; readonly runtime_result: JsonObject; readonly trace_id: string; readonly request_id: string; }
export class P2StableError extends Error { readonly code: string; constructor(code: string, message: string) { super(message); this.name = "P2StableError"; this.code = code; } }

function objectValue(value: unknown, field: string): JsonObject { if (value === null || typeof value !== "object" || Array.isArray(value)) throw new P2StableError("P2_INVALID_INPUT", `${field} must be an object`); return value as JsonObject; }
function stringValue(value: unknown, field: string): string { if (typeof value !== "string" || !value) throw new P2StableError("P2_INVALID_INPUT", `${field} must be non-empty string`); return value; }
function exactCapabilityContractRef(value: unknown, field: string): string { const text = stringValue(value, field); if (!/@V\d{4}$/.test(text)) throw new P2StableError("P2_CAPABILITY_CONTRACT_INVALID", `${field} must be exact-versioned`); return text; }
function sha256Value(value: unknown, field: string): string { const text = stringValue(value, field); if (!/^sha256:[0-9a-f]{64}$/.test(text)) throw new P2StableError("P2_INTEGRITY_BINDING_INVALID", `${field} must be exact sha256`); return text; }
function stableClone(value: unknown): unknown { if (Array.isArray(value)) return Object.freeze(value.map(stableClone)); if (value !== null && typeof value === "object") { const source = value as Record<string, unknown>; const out: Record<string, unknown> = {}; for (const key of Object.keys(source).sort()) out[key] = stableClone(source[key]); return Object.freeze(out); } return value; }
function canonical(value: unknown): string { return JSON.stringify(stableClone(value)); }
function sha256Json(value: unknown): string { return `sha256:${createHash("sha256").update(canonical(value), "utf8").digest("hex")}`; }
function success(request: P2OperationRequest, runtime_result: JsonObject): P2OperationResponse { return Object.freeze({ outcome_type: "response" as const, runtime_result: Object.freeze({ ...runtime_result }), trace_id: request.trace_id, request_id: request.request_id }); }

export const STAGE_CONTRACT_REF = "Q.SS.STD.P2.CONTRACT.CROSS_DOMAIN_REALIZATION@V0128" as const;
export const ROLE = "consumer" as const;
export const CAPABILITY_ID = "p1_dependency_realization" as const;
export const OPERATION_ID = "realize_dependency" as const;
const P1_DEPENDENCY_INTERFACE_REF = "Q.SS.STD.P1.CONTRACT.BUSINESS_RUNTIME@V0186#/interfaces/dependency_invoke" as const;

function validateActiveMountSetMember(value: JsonObject): boolean {
  if (value.source_binding_kind !== "ACTIVE_MOUNT_SET_MEMBER") return false;
  sha256Value(value.active_mount_set_hash, "verified_binding.active_mount_set_hash");
  const provider = exactCapabilityContractRef(value.provider_capability_contract_ref, "verified_binding.provider_capability_contract_ref");
  const mount = objectValue(value.selected_mount, "verified_binding.selected_mount");
  const publication = objectValue(mount.verified_publication, "verified_binding.selected_mount.verified_publication");
  if (publication.verified !== true || publication.capability_contract_ref !== provider) throw new P2StableError("P2_PROVIDER_BINDING_NOT_VERIFIED", "selected mount Provider Capability Contract mismatch");
  sha256Value(mount.mount_hash, "verified_binding.selected_mount.mount_hash");
  const resolver_state = objectValue(mount.resolver_state, "verified_binding.selected_mount.resolver_state");
  if (resolver_state.verified !== true) throw new P2StableError("P2_RESOLVER_STATE_NOT_VERIFIED", "selected mount resolver state must be verified");
  const implementation_binding_hash = sha256Value(mount.implementation_binding_hash, "verified_binding.selected_mount.implementation_binding_hash");
  if (implementation_binding_hash !== sha256Json(resolver_state)) throw new P2StableError("P2_IMPLEMENTATION_BINDING_HASH_MISMATCH", "selected mount implementation binding mismatch");
  return true;
}

function validateGovernedDataBinding(value: JsonObject): boolean {
  const category = value.data_category;
  if (category !== "STATIC" && category !== "DYNAMIC" && category !== "RUNTIME") return false;
  stringValue(value.source_domain_identity, "verified_binding.source_domain_identity");
  stringValue(value.subject_identity, "verified_binding.subject_identity");
  objectValue(value.source_provenance, "verified_binding.source_provenance");
  stringValue(value.source_fact_authority, "verified_binding.source_fact_authority");
  objectValue(value.governed_access_binding, "verified_binding.governed_access_binding");
  objectValue(value.integrity_binding, "verified_binding.integrity_binding");
  stringValue(value.material_ref, "verified_binding.material_ref");
  sha256Value(value.content_hash, "verified_binding.content_hash");
  if (value.creates_evidence_or_gate_result !== false) throw new P2StableError("P2_GOVERNED_DATA_BINDING_INVALID", "governed data binding may not create evidence or gate semantics");
  return true;
}

function validateVerifiedBinding(value: JsonObject): "ACTIVE_MOUNT_SET_MEMBER" | "GOVERNED_DATA_CONSUMPTION_BINDING" {
  if (validateActiveMountSetMember(value)) return "ACTIVE_MOUNT_SET_MEMBER";
  if (validateGovernedDataBinding(value)) return "GOVERNED_DATA_CONSUMPTION_BINDING";
  throw new P2StableError("P2_PROVIDER_BINDING_NOT_VERIFIED", "only exact active mount-set member or governed-data consumption binding may realize P1 dependency");
}

interface DependencyBindingIdentity {
  readonly exact_owner_capability_ref: string;
  readonly exact_receiving_operation_ref: string;
  readonly exact_local_dependency_ref: string;
  readonly active_mount_set_hash: string;
  readonly binding_hash: string;
}

function dependencyBindingIdentity(binding: JsonObject): Readonly<DependencyBindingIdentity> {
  if (binding.source_binding_kind !== "ACTIVE_MOUNT_SET_MEMBER") throw new P2StableError("P2_PROVIDER_BINDING_NOT_VERIFIED", "mounted dependency persistence requires ACTIVE_MOUNT_SET_MEMBER binding");
  if (binding.creates_or_writes_p1_business_semantics !== false) throw new P2StableError("P2_P1_DEPENDENCY_CREATION_FORBIDDEN", "persisted dependency realization must not write P1 business semantics");
  const verified_provider_binding_or_governed_data_binding = objectValue(binding.verified_provider_binding_or_governed_data_binding, "dependency_realization_binding.verified_provider_binding_or_governed_data_binding");
  validateActiveMountSetMember(verified_provider_binding_or_governed_data_binding);
  const exact_owner_capability_ref = stringValue(binding.exact_owner_capability_ref, "dependency_realization_binding.exact_owner_capability_ref");
  const exact_receiving_operation_ref = stringValue(binding.exact_receiving_operation_ref, "dependency_realization_binding.exact_receiving_operation_ref");
  const exact_local_dependency_ref = stringValue(binding.exact_local_dependency_ref, "dependency_realization_binding.exact_local_dependency_ref");
  const p1_dependency_interface_ref = stringValue(binding.p1_dependency_interface_ref, "dependency_realization_binding.p1_dependency_interface_ref");
  const binding_hash = sha256Value(binding.binding_hash, "dependency_realization_binding.binding_hash");
  const expected = sha256Json(stableClone({
    verified_provider_binding_or_governed_data_binding,
    exact_owner_capability_ref,
    exact_receiving_operation_ref,
    exact_local_dependency_ref,
    p1_dependency_interface_ref,
  }));
  if (binding_hash !== expected) throw new P2StableError("P2_INTEGRITY_BINDING_INVALID", "dependency realization binding_hash mismatch");
  const active_mount_set_hash = sha256Value(verified_provider_binding_or_governed_data_binding.active_mount_set_hash, "verified_binding.active_mount_set_hash");
  return Object.freeze({ exact_owner_capability_ref, exact_receiving_operation_ref, exact_local_dependency_ref, active_mount_set_hash, binding_hash });
}

export async function handler(request: P2OperationRequest): Promise<P2OperationResponse> {
  const verified_provider_binding_or_governed_data_binding = objectValue(request.input.verified_provider_binding_or_governed_data_binding, "verified_provider_binding_or_governed_data_binding");
  const source_binding_kind = validateVerifiedBinding(verified_provider_binding_or_governed_data_binding);
  const receiving_p1_binding = objectValue(request.input.receiving_p1_binding, "receiving_p1_binding");
  const exact_owner_capability_ref = stringValue(receiving_p1_binding.exact_owner_capability_ref, "receiving_p1_binding.exact_owner_capability_ref");
  const exact_receiving_operation_ref = stringValue(receiving_p1_binding.exact_receiving_operation_ref, "receiving_p1_binding.exact_receiving_operation_ref");
  const exact_local_dependency_ref = stringValue(receiving_p1_binding.exact_local_dependency_ref, "receiving_p1_binding.exact_local_dependency_ref");
  if (request.input.create_p1_dependency === true) throw new P2StableError("P2_P1_DEPENDENCY_CREATION_FORBIDDEN", "P2.Consumer may only realize an already-declared P1 dependency");
  const payload = stableClone({
    verified_provider_binding_or_governed_data_binding,
    exact_owner_capability_ref,
    exact_receiving_operation_ref,
    exact_local_dependency_ref,
    p1_dependency_interface_ref: P1_DEPENDENCY_INTERFACE_REF,
  }) as JsonObject;
  return success(request, {
    result_kind: "P1_DEPENDENCY_REALIZATION_BINDING",
    dependency_realization_binding: Object.freeze({ ...payload, binding_hash: sha256Json(payload), source_binding_kind, creates_or_writes_p1_business_semantics: false }),
  });
}

export interface OwnerLocalDependencyBindingPersistencePort {
  persist_dependency_binding_record(input: Readonly<{
    receiving_domain_ref: string;
    exact_owner_capability_ref: string;
    exact_receiving_operation_ref: string;
    exact_local_dependency_ref: string;
    active_mount_set_hash: string;
    binding_hash: string;
    binding: JsonObject;
  }>): Promise<void>;
  read_dependency_binding_record(input: Readonly<{
    receiving_domain_ref: string;
    exact_owner_capability_ref: string;
    exact_receiving_operation_ref: string;
    exact_local_dependency_ref: string;
    active_mount_set_hash: string;
  }>): Promise<JsonObject | undefined>;
}

export async function persist_dependency_realization_with_owner(
  receiving_domain_ref: string,
  binding: JsonObject,
  persistence: OwnerLocalDependencyBindingPersistencePort,
): Promise<void> {
  const domain = stringValue(receiving_domain_ref, "receiving_domain_ref");
  const identity = dependencyBindingIdentity(binding);
  await persistence.persist_dependency_binding_record(Object.freeze({
    receiving_domain_ref: domain,
    exact_owner_capability_ref: identity.exact_owner_capability_ref,
    exact_receiving_operation_ref: identity.exact_receiving_operation_ref,
    exact_local_dependency_ref: identity.exact_local_dependency_ref,
    active_mount_set_hash: identity.active_mount_set_hash,
    binding_hash: identity.binding_hash,
    binding: stableClone(binding) as JsonObject,
  }));
  const readback = await persistence.read_dependency_binding_record(Object.freeze({
    receiving_domain_ref: domain,
    exact_owner_capability_ref: identity.exact_owner_capability_ref,
    exact_receiving_operation_ref: identity.exact_receiving_operation_ref,
    exact_local_dependency_ref: identity.exact_local_dependency_ref,
    active_mount_set_hash: identity.active_mount_set_hash,
  }));
  if (readback === undefined || canonical(readback) !== canonical(binding)) throw new P2StableError("P2_INTEGRITY_BINDING_INVALID", "owner-local dependency realization exact read-back failed");
  const readbackIdentity = dependencyBindingIdentity(readback);
  if (
    readbackIdentity.exact_owner_capability_ref !== identity.exact_owner_capability_ref
    || readbackIdentity.exact_receiving_operation_ref !== identity.exact_receiving_operation_ref
    || readbackIdentity.exact_local_dependency_ref !== identity.exact_local_dependency_ref
    || readbackIdentity.active_mount_set_hash !== identity.active_mount_set_hash
    || readbackIdentity.binding_hash !== identity.binding_hash
  ) {
    throw new P2StableError("P2_INTEGRITY_BINDING_INVALID", "owner-local dependency realization binding identity mismatch");
  }
}
