/**
 * 统一会员能力（Member Capability）V0103 — 公共类型与端口定义
 *
 * 唯一语义权威：Q.MEMBERSHIP.CONTRACT.CAPABILITY.MEMBER@V0103
 * 本文件为该 Contract 的 TypeScript 物化投影，不新增业务政策。
 * 候选规则（PD-1~PD-8）在业务 Owner 批准前不构成生产授权。
 */

/* eslint-disable @typescript-eslint/no-duplicate-type-constituents */

// ---------------------------------------------------------------------------
// 一、枚举与领域对象（对应 type_closure.schemas）
// ---------------------------------------------------------------------------

/** 会员生命周期状态：本版仅允许 active -> terminated */
export type MemberStatus = 'active' | 'terminated';

/** 会员关系状态：本版仅允许 active -> replaced */
export type MembershipStatus = 'active' | 'replaced';

/** 资格判定用途：本版仅支持会员关系有效性 */
export type CheckPurpose = 'membership_validity';

/** 资格结论原因码（补充候选优先级：先会员状态，后关系状态） */
export type EligibilityReasonCode =
  | 'MEMBERSHIP_VALID'
  | 'MEMBER_TERMINATED'
  | 'NO_EFFECTIVE_MEMBERSHIP';

/** 仅含已获准展示的资料；默认不披露 contact_email */
export interface MemberProfile {
  display_name: string;
}

/** type_closure.schemas.member */
export interface Member {
  member_ref: string;
  member_status: MemberStatus;
  member_profile: MemberProfile;
}

/** type_closure.schemas.membership；半开有效区间 [effective_time, termination_time) */
export interface Membership {
  membership_ref: string;
  member_ref: string;
  plan_ref: string;
  membership_status: MembershipStatus;
  effective_time: string;
  /** active 关系必须为 null；replaced 关系必须为真实时点 */
  termination_time: string | null;
}

/** 外部 Membership Plan 能力精确解析结果的本地绑定结构 */
export interface MembershipPlanResolutionBinding {
  membership_plan_ref: string;
  name: string;
  benefit_refs: string[];
  commercial_terms_ref: string;
  state: 'active' | 'inactive';
}

/** type_closure.schemas.eligibility_decision */
export interface EligibilityDecision {
  eligible: boolean;
  basis: {
    reason_code: EligibilityReasonCode;
    check_purpose: CheckPurpose;
    decision_time: string;
    member_status_at_decision: MemberStatus;
    /** 至多一条被考虑的生效关系 */
    membership_refs_considered: string[];
  };
}

// ---------------------------------------------------------------------------
// 二、Operation 请求/响应契约（对应 contracts.*_request/response_contract）
// ---------------------------------------------------------------------------

// 01 create_member

export interface MemberIdentity {
  identity_namespace: string;
  identity_value: string;
}

export interface RegistrationProfile {
  display_name: string;
  contact_email?: string;
}

export interface CreateMemberRequest {
  member_identity: MemberIdentity;
  registration_profile: RegistrationProfile;
}

export interface CreateMemberResponse {
  member_ref: string;
  member_status: 'active';
}

// 02 resolve_member

export interface ResolveMemberRequest {
  member_ref: string;
}

export interface ResolveMemberResponse {
  member: Member;
}

// 03 update_member_profile

/** 只允许 display_name / contact_email；member_ref、member_status 严禁出现 */
export interface ProfileChanges {
  display_name?: string;
  contact_email?: string;
}

export interface UpdateMemberProfileRequest {
  member_ref: string;
  profile_changes: ProfileChanges;
}

export interface UpdateMemberProfileResponse {
  member_ref: string;
  update_result: 'applied' | 'no_change';
  member_profile: MemberProfile;
}

// 04 update_member_status

export interface UpdateMemberStatusRequest {
  member_ref: string;
  target_status: 'terminated';
  reason?: string;
}

export interface UpdateMemberStatusResponse {
  member_ref: string;
  member_status: 'terminated';
}

// 05 create_membership

export interface CreateMembershipRequest {
  member_ref: string;
  plan_ref: string;
  requested_effective_time?: string;
}

export interface CreateMembershipResponse {
  membership_ref: string;
  membership_status: 'active';
  effective_time: string;
}

// 06 update_membership_plan

export interface UpdateMembershipPlanRequest {
  member_ref: string;
  current_membership_ref: string;
  target_plan_ref: string;
  requested_effective_time?: string;
}

export interface UpdateMembershipPlanResponse {
  membership_ref: string;
  previous_membership_ref: string;
  membership_status: 'active';
  effective_time: string;
}

// 07 lookup_membership

export interface LookupMembershipRequest {
  member_ref: string;
  as_of_time?: string;
}

export interface LookupMembershipResponse {
  /** 0 条 = 权威事实证明该时点无有效关系；至多 1 条 */
  memberships: Membership[];
}

// 08 evaluate_membership_eligibility

export interface EvaluateMembershipEligibilityRequest {
  member_ref: string;
  check_purpose: CheckPurpose;
  decision_time: string;
}

export type EvaluateMembershipEligibilityResponse = EligibilityDecision;

// 09 resolve_membership（仅内部）

export interface ResolveMembershipRequest {
  membership_ref: string;
}

export interface ResolveMembershipResponse {
  membership: Membership;
}

// ---------------------------------------------------------------------------
// 三、Operation 标识与调用信封（path: capability_id / operation_id / request_id / trace_id）
// ---------------------------------------------------------------------------

export type OperationId =
  | 'create_member'
  | 'resolve_member'
  | 'update_member_profile'
  | 'update_member_status'
  | 'create_membership'
  | 'update_membership_plan'
  | 'lookup_membership'
  | 'evaluate_membership_eligibility'
  | 'resolve_membership';

/**
 * 候选调用证据（PD-6）。这些调用方字符串并不构成 V0117 所要求的
 * exact actor class / authorization_rule_ref / permission_ref 证明。
 * 缺少 Owner 授权验证器时默认 DENY，不能由调用方自我签发权限。
 */
export interface AuthorizationEvidence {
  actor_ref: string;
  issued_by: string;
  /** 显式允许的 operation_id 列表；'*' 表示可信入口对该 Actor 的全权委托 */
  allowed_operations: readonly string[];
}

/** resolve_membership 的内部调用证据：不对外发布 */
export interface InternalInvocationEvidence {
  /** 被允许的内部业务用途，非空 */
  purpose: string;
  permitted: boolean;
}

export interface CallContext {
  request_id: string;
  trace_id: string;
  authorization?: AuthorizationEvidence;
  internal_invocation?: InternalInvocationEvidence;
  /** 显式注入本次业务提交时点（UTC）；缺省由运行时时钟提供 */
  commit_time?: string;
}

/** 稳定业务错误载体（carrier_field: stable_error） */
export interface StableErrorPayload {
  code: string;
  message: string;
}

/** dynamic_mount: input / runtime_result / outcome_type / stable_error */
export type CallOutcome<T> =
  | {
      request_id: string;
      trace_id: string;
      outcome_type: 'SUCCESS';
      runtime_result: T;
    }
  | {
      request_id: string;
      trace_id: string;
      outcome_type: 'STABLE_ERROR';
      stable_error: StableErrorPayload;
    };

export type OperationHandler<TRequest, TResponse> = (
  request: TRequest,
  context: CallContext,
) => Promise<CallOutcome<TResponse>>;

// ---------------------------------------------------------------------------
// 四、持久化内部模型（owner-local persistence；append-only history）
// ---------------------------------------------------------------------------

/** 会员聚合持久化记录（含默认不公开的 contact_email） */
export interface StoredMember {
  member_ref: string;
  identity_namespace: string;
  identity_value: string;
  display_name: string;
  contact_email: string | null;
  member_status: MemberStatus;
  created_at: string;
  terminated_at: string | null;
  terminate_reason: string | null;
  version: number;
}

/** 会员关系持久化记录 */
export interface StoredMembership {
  membership_ref: string;
  member_ref: string;
  plan_ref: string;
  membership_status: MembershipStatus;
  effective_time: string;
  termination_time: string | null;
  version: number;
}

export interface MemberStatusEvent {
  event_ref: string;
  member_ref: string;
  from_status: MemberStatus | null;
  to_status: MemberStatus;
  occurred_at: string;
  reason: string | null;
}

export interface MembershipRelationEvent {
  event_ref: string;
  membership_ref: string;
  member_ref: string;
  plan_ref: string;
  event_kind: 'created' | 'replaced_out' | 'replaced_in';
  effective_time: string;
  /** replaced_out 时等于后继关系 effective_time */
  termination_time: string | null;
  successor_ref: string | null;
  predecessor_ref: string | null;
  occurred_at: string;
}

// 仓储写操作判别结果

export type AtomicWriteResult<T> =
  | { ok: true; record: T }
  | { ok: false; reason: string };

/**
 * 会员能力自有持久化端口。
 * 实现必须保证：
 *  - (identity_namespace, identity_value) 原始字节组合唯一；
 *  - 任一会员同一时点最多一条生效关系（半开区间不得重叠）；
 *  - 方案更换为原子事务（旧终止 + 新建立同成败）；
 *  - 状态事件与关系事件 append-only。
 */
export interface MemberRepository {
  // member
  insertMemberAtomic(record: StoredMember): Promise<
    | { ok: true; record: StoredMember }
    | { ok: false; reason: 'DUPLICATE_IDENTITY' | 'CONCURRENT' }
  >;
  getMemberByRef(memberRef: string): Promise<StoredMember | null>;
  getMemberByIdentity(namespace: string, value: string): Promise<StoredMember | null>;
  updateMemberProfileAtomic(input: {
    member_ref: string;
    expected_version: number;
    display_name?: string;
    contact_email?: string;
  }): Promise<
    | { ok: true; record: StoredMember; changed: boolean }
    | { ok: false; reason: 'NOT_FOUND' | 'CONCURRENT' }
  >;
  terminateMemberAtomic(input: {
    member_ref: string;
    expected_version: number;
    terminated_at: string;
    reason: string | null;
  }): Promise<
    | { ok: true; record: StoredMember }
    | { ok: false; reason: 'NOT_FOUND' | 'NOT_ACTIVE' | 'CONCURRENT' }
  >;

  // membership
  /**
   * 原子建立关系。提交边界内必须同时重新核验（B-03）：
   *  - 会员真实存在；
   *  - 拟生效时点按历史状态为 active（早于建立或不早于终止时点均拒绝）；
   *  - 半开区间与既有关系不重叠。
   * Provider 调用前的预检查不能替代本提交时校验。
   */
  insertMembershipAtomic(record: StoredMembership): Promise<
    | { ok: true; record: StoredMembership }
    | {
        ok: false;
        reason:
          | 'OVERLAP'
          | 'CONCURRENT'
          | 'MEMBER_NOT_FOUND'
          | 'MEMBER_NOT_ACTIVE_AT_TIME';
      }
  >;
  getMembershipByRef(membershipRef: string): Promise<StoredMembership | null>;
  listMembershipsByMember(memberRef: string): Promise<StoredMembership[]>;
  /** 原子更换：旧关系 active->replaced（CAS）与新关系建立同成败 */
  replaceMembershipAtomic(input: {
    member_ref: string;
    current_membership_ref: string;
    expected_version: number;
    effective_time: string;
    new_record: StoredMembership;
  }): Promise<
    | { ok: true; previous: StoredMembership; current: StoredMembership }
    | {
        ok: false;
        reason:
          | 'MEMBERSHIP_NOT_FOUND'
          | 'NOT_BELONG_TO_MEMBER'
          | 'NOT_ACTIVE'
          | 'OVERLAP'
          | 'CONCURRENT'
          /** 新生效时点不严格晚于旧关系开始，会产生零长度/非法旧区间（B-04） */
          | 'INVALID_INTERVAL';
      }
  >;
}

// ---------------------------------------------------------------------------
// 五、外部依赖端口：Membership Plan Provider（已声明依赖，禁止直接 import 对方 handler）
// ---------------------------------------------------------------------------

/**
 * 对应 operational_relations：
 * request  plan_ref -> membership_plan_ref
 * response membership_plan（state 必须为 active 才允许建立/更换关系）
 * stable_error_mode = PRESERVE_EXACT
 */
export interface MembershipPlanProvider {
  resolveMembershipPlan(
    request: { membership_plan_ref: string },
    context: CallContext,
  ): Promise<
    | { outcome_type: 'SUCCESS'; membership_plan: MembershipPlanResolutionBinding }
    | { outcome_type: 'STABLE_ERROR'; stable_error: StableErrorPayload }
  >;
}

// ---------------------------------------------------------------------------
// 六、授权端口与运行时装配
// ---------------------------------------------------------------------------

/** 授权策略端口；契约默认决策 DENY，未映射到可信 Actor 的调用必须拒绝 */
export interface OperationAuthorizer {
  authorize(input: {
    operation_id: OperationId;
    request: unknown;
    context: CallContext;
  }): boolean | Promise<boolean>;
}

export type Clock = () => string;

/** 运行时依赖：每个 handler 工厂通过它获得仓储、方案能力、授权与时钟 */
export interface MemberRuntimeDeps {
  repository: MemberRepository;
  planProvider: MembershipPlanProvider;
  authorizer?: OperationAuthorizer;
  clock?: Clock;
}
