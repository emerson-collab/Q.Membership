/**
 * 统一会员能力 V0103 — 物化元数据
 * 投影自：Q.MEMBERSHIP.CONTRACT.CAPABILITY.MEMBER@V0103
 * 状态：candidate；未通过 Gate、未获生产激活授权。
 */

import {
  ALL_OPERATION_IDS,
  INTERNAL_OPERATION_IDS,
  PUBLIC_OPERATION_IDS,
  STABLE_ERROR_CODE_SETS,
} from './contracts';

export const MEMBER_CAPABILITY_METADATA = {
  q_id: 'Q.MEMBERSHIP.CONTRACT.CAPABILITY.MEMBER',
  q_version: 'V0103',
  q_role: 'capability_contract',
  capability_ref: 'Q.MEMBERSHIP.CAPABILITY.MEMBER@V0103',
  capability_id: 'member',
  stable_code: 'MEMBER',
  canonical_name: 'member',
  repository_owner_namespace: 'Q.MEMBERSHIP',
  q_status: 'candidate',
  gate_pass_implied: false,
  activation_implied: false,
  publication_executed: false,
  operation_count: 9,
  public_operation_count: 8,
  internal_operation_count: 1,
  surface: 'CALL',
  kind_code: 'M1',
  kind: 'CALL_INVOKE',
  operations: ALL_OPERATION_IDS.map((operationId) => ({
    operation_id: operationId,
    public: (PUBLIC_OPERATION_IDS as readonly string[]).includes(operationId),
    internal: (INTERNAL_OPERATION_IDS as readonly string[]).includes(
      operationId,
    ),
    stable_error_codes: STABLE_ERROR_CODE_SETS[operationId],
  })),
  state_machines: {
    member: {
      state_field_path: 'member_status',
      initial_state: 'active',
      allowed_business_states: ['active', 'terminated'],
      terminal_states: ['terminated'],
      transitions: [{ from: 'active', to: 'terminated', via: 'update_member_status' }],
    },
    membership: {
      state_field_path: 'membership_status',
      initial_state: 'active',
      allowed_business_states: ['active', 'replaced'],
      terminal_states: ['replaced'],
      transitions: [
        { from: 'active', to: 'replaced', via: 'update_membership_plan' },
      ],
    },
  },
  permission_model: {
    mode: 'DECLARED',
    default_decision: 'DENY',
    effective_until_approved_actor_mapping: 'DENY_ALL',
  },
  dependencies: {
    membership_plan: {
      local_dependency_ref: 'q.membership.member.dependency.membership_plan',
      provider_capability_contract_ref:
        'Q.MEMBERSHIP.CONTRACT.CAPABILITY.MEMBERSHIP_PLAN@V0105',
      provider_operation: 'resolve_membership_plan',
      connection_mode: 'INTRA_DOMAIN',
      required_resolved_state: 'active',
      stable_error_mode: 'PRESERVE_EXACT',
    },
  },
  check_purposes: ['membership_validity'],
  eligibility_reason_codes: [
    'MEMBERSHIP_VALID',
    'MEMBER_TERMINATED',
    'NO_EFFECTIVE_MEMBERSHIP',
  ],
} as const;

export type MemberCapabilityMetadata = typeof MEMBER_CAPABILITY_METADATA;
