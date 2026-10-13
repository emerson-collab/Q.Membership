/**
 * Candidate, read-only projection of the exact Member owner Contract V0104.
 * P1CM V0117 supplies structure; this module neither creates business
 * semantics nor certifies an accepted scoped field whitelist or runtime path.
 *
 * Full state/rule/permission/relation/schema facts live only in the
 * source-bound spec/p1/member projections. Do not hand-copy short aliases.
 */
import { ALL_OPERATION_IDS, INTERNAL_OPERATION_IDS, PUBLIC_OPERATION_IDS, STABLE_ERROR_CODE_SETS } from './contracts';
import type { OperationId } from './types';

const MEMBER_CONTRACT_REF = 'Q.MEMBERSHIP.CONTRACT.CAPABILITY.MEMBER@V0104' as const;
const MEMBER_CAPABILITY_REF = 'Q.MEMBERSHIP.CAPABILITY.MEMBER@V0104' as const;

export const MEMBER_OPERATION_INTERFACE_IDS = Object.freeze({
  "create_member": "member_creation_invoke",
  "resolve_member": "member_resolution_invoke",
  "update_member_profile": "member_profile_update_invoke",
  "update_member_status": "member_status_update_invoke",
  "create_membership": "membership_creation_invoke",
  "update_membership_plan": "membership_plan_update_invoke",
  "lookup_membership": "membership_lookup_invoke",
  "evaluate_membership_eligibility": "membership_eligibility_evaluation_invoke",
  "resolve_membership": "membership_exact_resolution_invoke",
} as const satisfies Record<OperationId, string>);

const declaredOperations = ALL_OPERATION_IDS.map((operationId) => Object.freeze({
  operation_id: operationId,
  operation_ref: `${MEMBER_CONTRACT_REF}#/operations/${operationId}`,
  interface_ref: `${MEMBER_CONTRACT_REF}#/interfaces/${MEMBER_OPERATION_INTERFACE_IDS[operationId]}`,
  surface: 'CALL' as const,
  kind: 'CALL_INVOKE' as const,
  method_ref: operationId,
  public: (PUBLIC_OPERATION_IDS as readonly string[]).includes(operationId),
  internal: (INTERNAL_OPERATION_IDS as readonly string[]).includes(operationId),
  stable_error_codes: STABLE_ERROR_CODE_SETS[operationId],
}));

export const MEMBER_CAPABILITY_METADATA = Object.freeze({
  q_id: 'Q.MEMBERSHIP.CONTRACT.CAPABILITY.MEMBER',
  q_version: 'V0104',
  q_role: 'capability_contract',
  q_status: 'candidate' as const,
  capability_ref: MEMBER_CAPABILITY_REF,
  capability_id: 'member',
  capability_version: 'V0104',
  capability_contract_ref: MEMBER_CONTRACT_REF,
  capability_contract_integrity_binding_ref: `${MEMBER_CONTRACT_REF}#/capability_contract_integrity_binding`,
  stable_code: 'MEMBER',
  canonical_name: 'member',
  repository_owner_namespace: 'Q.MEMBERSHIP',
  operation_count: ALL_OPERATION_IDS.length,
  public_operation_count: PUBLIC_OPERATION_IDS.length,
  internal_operation_count: INTERNAL_OPERATION_IDS.length,
  operations: Object.freeze(declaredOperations),
  gate_pass_implied: false,
  activation_implied: false,
  publication_executed: false,
});

/**
 * The 13 GENERAL facts must not be materialized without a frozen external
 * owner hash and exact stage/runtime bindings. These three fields are
 * deliberately null: no arbitrary caller string may authorize them.
 * Diagnostic only; NEVER pass a candidate as an execution binding.
 */
export function getMemberGeneralExportCandidate(operationId: OperationId) {
  const operation = declaredOperations.find(x => x.operation_id === operationId);
  if (!operation) throw new TypeError('Undeclared Member Operation');
  return Object.freeze({
    capability_ref: MEMBER_CAPABILITY_REF,
    capability_id: 'member' as const,
    capability_version: 'V0104' as const,
    capability_contract_ref: MEMBER_CONTRACT_REF,
    capability_contract_content_hash: null,
    stage_contract_ref: null,
    runtime_contract_ref: null,
    operation_id: operation.operation_id,
    operation_ref: operation.operation_ref,
    interface_ref: operation.interface_ref,
    surface: operation.surface,
    kind: operation.kind,
    method_ref: operation.method_ref,
  });
}

export type MemberCapabilityMetadata = typeof MEMBER_CAPABILITY_METADATA;
