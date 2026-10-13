/**
 * 统一会员能力 V0103 — 能力客户端与本地开发适配器
 *
 * MemberCapabilityClient：本地/候选业务逻辑测试客户端，不代表已完成 V0117
 * 的 exact Owner Contract / Interface Inventory / permission / rule closure。
 * 未注入 Owner 授权验证器时必须默认拒绝调用。
 * InMemoryMemberRepository：满足 MemberRepository 端口的内存实现，
 *   内置写串行化与 CAS，保证身份唯一、区间不重叠与更换原子性；
 *   仅用于本地开发/测试，不声明物理数据库所有权。
 * staticMembershipPlanProvider：基于静态方案表的 Provider 适配器。
 */

import { createCreateMemberHandler } from '../../member/create_member/handler';
import { createResolveMemberHandler } from '../../member/resolve_member/handler';
import { createUpdateMemberProfileHandler } from '../../member/update_member_profile/handler';
import { createUpdateMemberStatusHandler } from '../../member/update_member_status/handler';
import { createCreateMembershipHandler } from '../../member/create_membership/handler';
import { createUpdateMembershipPlanHandler } from '../../member/update_membership_plan/handler';
import { createLookupMembershipHandler } from '../../member/lookup_membership/handler';
import { createEvaluateMembershipEligibilityHandler } from '../../member/evaluate_membership_eligibility/handler';
import { createResolveMembershipHandler } from '../../member/resolve_membership/handler';
import {
  defaultClock,
  generateEventRef,
  normalizeCallContext,
  toEpoch,
  trustedEntryAuthorizer,
} from './contracts';
import type {
  CallContext,
  CallOutcome,
  Clock,
  CreateMemberRequest,
  CreateMemberResponse,
  CreateMembershipRequest,
  CreateMembershipResponse,
  EvaluateMembershipEligibilityRequest,
  EvaluateMembershipEligibilityResponse,
  LookupMembershipRequest,
  LookupMembershipResponse,
  MemberRepository,
  MemberRuntimeDeps,
  MemberStatusEvent,
  MembershipPlanProvider,
  MembershipPlanResolutionBinding,
  MembershipRelationEvent,
  OperationAuthorizer,
  ResolveMemberRequest,
  ResolveMemberResponse,
  ResolveMembershipRequest,
  ResolveMembershipResponse,
  StoredMember,
  StoredMembership,
  UpdateMemberProfileRequest,
  UpdateMemberProfileResponse,
  UpdateMemberStatusRequest,
  UpdateMemberStatusResponse,
  UpdateMembershipPlanRequest,
  UpdateMembershipPlanResponse,
} from './types';

// ---------------------------------------------------------------------------
// 客户端
// ---------------------------------------------------------------------------

export class MemberCapabilityClient {
  private readonly clock: Clock;
  private readonly createMember: ReturnType<typeof createCreateMemberHandler>;
  private readonly resolveMember: ReturnType<typeof createResolveMemberHandler>;
  private readonly updateMemberProfile: ReturnType<
    typeof createUpdateMemberProfileHandler
  >;
  private readonly updateMemberStatus: ReturnType<
    typeof createUpdateMemberStatusHandler
  >;
  private readonly createMembership: ReturnType<
    typeof createCreateMembershipHandler
  >;
  private readonly updateMembershipPlan: ReturnType<
    typeof createUpdateMembershipPlanHandler
  >;
  private readonly lookupMembership: ReturnType<
    typeof createLookupMembershipHandler
  >;
  private readonly evaluateEligibility: ReturnType<
    typeof createEvaluateMembershipEligibilityHandler
  >;
  private readonly resolveMembership: ReturnType<
    typeof createResolveMembershipHandler
  >;

  constructor(deps: MemberRuntimeDeps) {
    this.clock = deps.clock ?? defaultClock;
    const resolvedDeps: MemberRuntimeDeps = {
      ...deps,
      clock: this.clock,
      authorizer: deps.authorizer ?? trustedEntryAuthorizer,
    };
    this.createMember = createCreateMemberHandler(resolvedDeps);
    this.resolveMember = createResolveMemberHandler(resolvedDeps);
    this.updateMemberProfile = createUpdateMemberProfileHandler(resolvedDeps);
    this.updateMemberStatus = createUpdateMemberStatusHandler(resolvedDeps);
    this.createMembership = createCreateMembershipHandler(resolvedDeps);
    this.updateMembershipPlan = createUpdateMembershipPlanHandler(resolvedDeps);
    this.lookupMembership = createLookupMembershipHandler(resolvedDeps);
    this.evaluateEligibility =
      createEvaluateMembershipEligibilityHandler(resolvedDeps);
    this.resolveMembership = createResolveMembershipHandler(resolvedDeps);
  }

  private invoke<TReq, TRes>(
    handler: (request: TReq, context: CallContext) => Promise<CallOutcome<TRes>>,
    request: TReq,
    context?: Partial<CallContext>,
  ): Promise<CallOutcome<TRes>> {
    return handler(request, normalizeCallContext(context, this.clock));
  }

  /** 01 创建会员（对外） */
  create(
    request: CreateMemberRequest,
    context?: Partial<CallContext>,
  ): Promise<CallOutcome<CreateMemberResponse>> {
    return this.invoke(this.createMember, request, context);
  }

  /** 02 查询会员（对外） */
  resolve(
    request: ResolveMemberRequest,
    context?: Partial<CallContext>,
  ): Promise<CallOutcome<ResolveMemberResponse>> {
    return this.invoke(this.resolveMember, request, context);
  }

  /** 03 修改会员档案（对外） */
  updateProfile(
    request: UpdateMemberProfileRequest,
    context?: Partial<CallContext>,
  ): Promise<CallOutcome<UpdateMemberProfileResponse>> {
    return this.invoke(this.updateMemberProfile, request, context);
  }

  /** 04 变更会员生命周期状态（对外） */
  updateStatus(
    request: UpdateMemberStatusRequest,
    context?: Partial<CallContext>,
  ): Promise<CallOutcome<UpdateMemberStatusResponse>> {
    return this.invoke(this.updateMemberStatus, request, context);
  }

  /** 05 建立会员与方案关系（对外） */
  createRelation(
    request: CreateMembershipRequest,
    context?: Partial<CallContext>,
  ): Promise<CallOutcome<CreateMembershipResponse>> {
    return this.invoke(this.createMembership, request, context);
  }

  /** 06 替换会员方案（对外） */
  replacePlan(
    request: UpdateMembershipPlanRequest,
    context?: Partial<CallContext>,
  ): Promise<CallOutcome<UpdateMembershipPlanResponse>> {
    return this.invoke(this.updateMembershipPlan, request, context);
  }

  /** 07 按时点查询有效关系（对外） */
  lookupRelation(
    request: LookupMembershipRequest,
    context?: Partial<CallContext>,
  ): Promise<CallOutcome<LookupMembershipResponse>> {
    return this.invoke(this.lookupMembership, request, context);
  }

  /** 08 判断会员关系有效性资格（对外） */
  evaluateEligible(
    request: EvaluateMembershipEligibilityRequest,
    context?: Partial<CallContext>,
  ): Promise<CallOutcome<EvaluateMembershipEligibilityResponse>> {
    return this.invoke(this.evaluateEligibility, request, context);
  }

  /** 09 按精确 membership_ref 读取关系（仅内部） */
  resolveRelation(
    request: ResolveMembershipRequest,
    context?: Partial<CallContext>,
  ): Promise<CallOutcome<ResolveMembershipResponse>> {
    return this.invoke(this.resolveMembership, request, context);
  }
}

// ---------------------------------------------------------------------------
// 内存仓储适配器（开发/测试用；写操作串行化模拟原子事务）
// ---------------------------------------------------------------------------

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class InMemoryMemberRepository implements MemberRepository {
  private readonly membersByRef = new Map<string, StoredMember>();
  // B-05：身份二元组使用嵌套原生 Map 表示（namespace -> value -> member_ref），
  // 不拼接分隔符，从结构上消除 (a\u0000b,c) 与 (a,b\u0000c) 同键碰撞；
  // 键为原始取值，不做大小写/空白归一化。
  private readonly refByIdentity = new Map<string, Map<string, string>>();
  private readonly membershipsByRef = new Map<string, StoredMembership>();
  private readonly refsByMember = new Map<string, Set<string>>();
  private readonly memberStatusEvents: MemberStatusEvent[] = [];
  private readonly relationEvents: MembershipRelationEvent[] = [];
  private txQueue: Promise<unknown> = Promise.resolve();

  private serialize<T>(fn: () => T): Promise<T> {
    const run = this.txQueue.then(() => fn());
    this.txQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  // -- member ---------------------------------------------------------------

  insertMemberAtomic(record: StoredMember) {
    return this.serialize(() => {
      const identities = this.identityBucket(record.identity_namespace);
      if (identities.has(record.identity_value)) {
        return { ok: false as const, reason: 'DUPLICATE_IDENTITY' as const };
      }
      const stored = clone(record);
      this.membersByRef.set(stored.member_ref, stored);
      identities.set(stored.identity_value, stored.member_ref);
      this.appendMemberStatusEvent({
        event_ref: generateEventRef('msev'),
        member_ref: stored.member_ref,
        from_status: null,
        to_status: 'active',
        occurred_at: stored.created_at,
        reason: null,
      });
      return { ok: true as const, record: clone(stored) };
    });
  }

  async getMemberByRef(memberRef: string): Promise<StoredMember | null> {
    const found = this.membersByRef.get(memberRef);
    return found ? clone(found) : null;
  }

  async getMemberByIdentity(
    namespace: string,
    value: string,
  ): Promise<StoredMember | null> {
    const ref = this.refByIdentity.get(namespace)?.get(value);
    const found = ref ? this.membersByRef.get(ref) : undefined;
    return found ? clone(found) : null;
  }

  updateMemberProfileAtomic(input: {
    member_ref: string;
    expected_version: number;
    display_name?: string;
    contact_email?: string;
  }) {
    return this.serialize(() => {
      const stored = this.membersByRef.get(input.member_ref);
      if (!stored) {
        return { ok: false as const, reason: 'NOT_FOUND' as const };
      }
      if (stored.version !== input.expected_version) {
        return { ok: false as const, reason: 'CONCURRENT' as const };
      }
      const changed =
        (input.display_name !== undefined &&
          stored.display_name !== input.display_name) ||
        (input.contact_email !== undefined &&
          stored.contact_email !== input.contact_email);
      if (changed) {
        if (input.display_name !== undefined) {
          stored.display_name = input.display_name;
        }
        if (input.contact_email !== undefined) {
          stored.contact_email = input.contact_email;
        }
        stored.version += 1;
      }
      return {
        ok: true as const,
        record: clone(stored),
        changed,
      };
    });
  }

  terminateMemberAtomic(input: {
    member_ref: string;
    expected_version: number;
    terminated_at: string;
    reason: string | null;
  }) {
    return this.serialize(() => {
      const stored = this.membersByRef.get(input.member_ref);
      if (!stored) {
        return { ok: false as const, reason: 'NOT_FOUND' as const };
      }
      if (stored.member_status !== 'active') {
        return { ok: false as const, reason: 'NOT_ACTIVE' as const };
      }
      if (stored.version !== input.expected_version) {
        return { ok: false as const, reason: 'CONCURRENT' as const };
      }
      stored.member_status = 'terminated';
      stored.terminated_at = input.terminated_at;
      stored.terminate_reason = input.reason;
      stored.version += 1;
      this.appendMemberStatusEvent({
        event_ref: generateEventRef('msev'),
        member_ref: stored.member_ref,
        from_status: 'active',
        to_status: 'terminated',
        occurred_at: input.terminated_at,
        reason: input.reason,
      });
      return { ok: true as const, record: clone(stored) };
    });
  }

  // -- membership -----------------------------------------------------------

  insertMembershipAtomic(record: StoredMembership) {
    return this.serialize(() => {
      // B-03：提交边界内重新核验会员在拟生效时点的历史状态。
      // 与终止/重叠检查同处一个串行化事务，Provider 等待期间发生的
      // 终止在此刻必然可见，杜绝“终止后才生效”的关系。
      const member = this.membersByRef.get(record.member_ref);
      if (!member) {
        return { ok: false as const, reason: 'MEMBER_NOT_FOUND' as const };
      }
      const effectiveEpoch = toEpoch(record.effective_time);
      if (effectiveEpoch < toEpoch(member.created_at)) {
        return {
          ok: false as const,
          reason: 'MEMBER_NOT_ACTIVE_AT_TIME' as const,
        };
      }
      if (
        member.terminated_at !== null &&
        effectiveEpoch >= toEpoch(member.terminated_at)
      ) {
        return {
          ok: false as const,
          reason: 'MEMBER_NOT_ACTIVE_AT_TIME' as const,
        };
      }
      if (this.hasOverlap(record.member_ref, record.effective_time, null)) {
        return { ok: false as const, reason: 'OVERLAP' as const };
      }
      const stored = clone(record);
      this.membershipsByRef.set(stored.membership_ref, stored);
      this.memberRefSet(stored.member_ref).add(stored.membership_ref);
      this.appendRelationEvent({
        event_ref: generateEventRef('mrev'),
        membership_ref: stored.membership_ref,
        member_ref: stored.member_ref,
        plan_ref: stored.plan_ref,
        event_kind: 'created',
        effective_time: stored.effective_time,
        termination_time: null,
        successor_ref: null,
        predecessor_ref: null,
        occurred_at: stored.effective_time,
      });
      return { ok: true as const, record: clone(stored) };
    });
  }

  async getMembershipByRef(
    membershipRef: string,
  ): Promise<StoredMembership | null> {
    const found = this.membershipsByRef.get(membershipRef);
    return found ? clone(found) : null;
  }

  async listMembershipsByMember(memberRef: string): Promise<StoredMembership[]> {
    const refs = this.refsByMember.get(memberRef);
    if (!refs) return [];
    return [...refs]
      .map((ref) => this.membershipsByRef.get(ref))
      .filter((m): m is StoredMembership => m !== undefined)
      .map(clone);
  }

  replaceMembershipAtomic(input: {
    member_ref: string;
    current_membership_ref: string;
    expected_version: number;
    effective_time: string;
    new_record: StoredMembership;
  }) {
    return this.serialize(() => {
      const previous = this.membershipsByRef.get(input.current_membership_ref);
      if (!previous) {
        return {
          ok: false as const,
          reason: 'MEMBERSHIP_NOT_FOUND' as const,
        };
      }
      if (previous.member_ref !== input.member_ref) {
        return {
          ok: false as const,
          reason: 'NOT_BELONG_TO_MEMBER' as const,
        };
      }
      if (previous.membership_status !== 'active') {
        return { ok: false as const, reason: 'NOT_ACTIVE' as const };
      }
      if (previous.version !== input.expected_version) {
        return { ok: false as const, reason: 'CONCURRENT' as const };
      }
      // B-04：新生效时点必须严格晚于旧关系开始。
      // 等于旧开始时旧关系 effective_time == termination_time（零长度），
      // 违反 membership.x_runtime_interval_constraint；提交边界强制执行，
      // 与 handler 前置“不早于”校验合并为“严格晚于”。
      if (
        toEpoch(input.effective_time) <= toEpoch(previous.effective_time)
      ) {
        return { ok: false as const, reason: 'INVALID_INTERVAL' as const };
      }
      // 除旧关系外，新区间 [t, ∞) 不得与任何关系重叠
      const otherOverlap = this.hasOverlap(
        input.member_ref,
        input.effective_time,
        input.current_membership_ref,
      );
      if (otherOverlap) {
        return { ok: false as const, reason: 'OVERLAP' as const };
      }

      // 原子完成：旧关系在 t 终止，新关系在 t 生效
      previous.membership_status = 'replaced';
      previous.termination_time = input.effective_time;
      previous.version += 1;

      const successor = clone(input.new_record);
      this.membershipsByRef.set(successor.membership_ref, successor);
      this.memberRefSet(successor.member_ref).add(successor.membership_ref);

      this.appendRelationEvent({
        event_ref: generateEventRef('mrev'),
        membership_ref: previous.membership_ref,
        member_ref: previous.member_ref,
        plan_ref: previous.plan_ref,
        event_kind: 'replaced_out',
        effective_time: previous.effective_time,
        termination_time: input.effective_time,
        successor_ref: successor.membership_ref,
        predecessor_ref: null,
        occurred_at: input.effective_time,
      });
      this.appendRelationEvent({
        event_ref: generateEventRef('mrev'),
        membership_ref: successor.membership_ref,
        member_ref: successor.member_ref,
        plan_ref: successor.plan_ref,
        event_kind: 'created',
        effective_time: input.effective_time,
        termination_time: null,
        successor_ref: null,
        predecessor_ref: previous.membership_ref,
        occurred_at: input.effective_time,
      });

      return {
        ok: true as const,
        previous: clone(previous),
        current: clone(successor),
      };
    });
  }

  // -- 审计视图（append-only 事件） ------------------------------------------

  listMemberStatusEvents(memberRef?: string): MemberStatusEvent[] {
    return this.memberStatusEvents
      .filter((e) => memberRef === undefined || e.member_ref === memberRef)
      .map(clone);
  }

  listRelationEvents(memberRef?: string): MembershipRelationEvent[] {
    return this.relationEvents
      .filter((e) => memberRef === undefined || e.member_ref === memberRef)
      .map(clone);
  }

  // -- 内部辅助 --------------------------------------------------------------

  /** B-05：取（必要时创建）命名空间对应的身份值桶；原始值精确区分 */
  private identityBucket(namespace: string): Map<string, string> {
    let bucket = this.refByIdentity.get(namespace);
    if (!bucket) {
      bucket = new Map<string, string>();
      this.refByIdentity.set(namespace, bucket);
    }
    return bucket;
  }

  private memberRefSet(memberRef: string): Set<string> {
    let set = this.refsByMember.get(memberRef);
    if (!set) {
      set = new Set<string>();
      this.refsByMember.set(memberRef, set);
    }
    return set;
  }

  private appendMemberStatusEvent(event: MemberStatusEvent): void {
    this.memberStatusEvents.push(clone(event));
  }

  private appendRelationEvent(event: MembershipRelationEvent): void {
    this.relationEvents.push(clone(event));
  }

  /**
   * 区间重叠检查：候选区间 [candidateStart, ∞) 与既有关系
   * [effective_time, termination_time) 是否重叠。ignoreRef 指定的旧关系除外。
   */
  private hasOverlap(
    memberRef: string,
    candidateStart: string,
    ignoreRef: string | null,
  ): boolean {
    const refs = this.refsByMember.get(memberRef);
    if (!refs) return false;
    const candidateEpoch = toEpoch(candidateStart);
    for (const ref of refs) {
      if (ignoreRef !== null && ref === ignoreRef) continue;
      const m = this.membershipsByRef.get(ref);
      if (!m) continue;
      if (
        m.termination_time === null ||
        toEpoch(m.termination_time) > candidateEpoch
      ) {
        return true;
      }
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// 静态 Membership Plan Provider 适配器
// ---------------------------------------------------------------------------

/**
 * 用静态方案表实现 Provider 端口：表内不存在的 plan_ref 返回稳定错误，
 * 模拟对端能力契约（PRESERVE_EXACT 由调用 handler 保证）。
 */
export function staticMembershipPlanProvider(
  plans:
    | ReadonlyMap<string, MembershipPlanResolutionBinding>
    | readonly MembershipPlanResolutionBinding[],
): MembershipPlanProvider & { setPlan(plan: MembershipPlanResolutionBinding): void } {
  const table = new Map<string, MembershipPlanResolutionBinding>();
  const entries: ReadonlyArray<
    readonly [string, MembershipPlanResolutionBinding]
  > = Array.isArray(plans)
    ? plans.map((p) => [p.membership_plan_ref, p] as const)
    : Array.from(
        plans as ReadonlyMap<string, MembershipPlanResolutionBinding>,
      );
  for (const [ref, plan] of entries) table.set(ref, clone(plan));

  return {
    setPlan(plan: MembershipPlanResolutionBinding): void {
      table.set(plan.membership_plan_ref, clone(plan));
    },
    async resolveMembershipPlan(request: { membership_plan_ref: string }) {
      const plan = table.get(request.membership_plan_ref);
      if (!plan) {
        return {
          outcome_type: 'STABLE_ERROR' as const,
          stable_error: {
            code: 'MEMBERSHIP_PLAN_NOT_FOUND',
            message: `membership plan not found: ${request.membership_plan_ref}`,
          },
        };
      }
      return {
        outcome_type: 'SUCCESS' as const,
        membership_plan: clone(plan),
      };
    },
  };
}

export type { OperationAuthorizer };
