/**
 * Operation 05｜create_membership｜建立会员与方案的有效关系（对外）
 *
 * 业务要点（DESC 二.05 / R-PLAN-EXISTENCE / R-TEMPORAL-BOUNDS /
 *           R-EFFECTIVE-TIME-MEMBER-STATUS / R-ONE-EFFECTIVE-RELATION）：
 *  - 会员在拟生效时点必须 active（读取状态历史，不用当前状态替代）。
 *  - 目标方案必须经 Membership Plan Provider 精确解析且 state=active。
 *  - 时点缺省=提交时点；显式时点不得晚于提交、不得早于会员建立。
 *  - 同一时点最多一条生效关系；并发由原子写入保护。
 *  - 不以支付成功为前置；不产生订单、付款或权益履约事实。
 */

import {
  preserveExactProviderStableError,
  fail,
  generateMembershipRef,
  parseDateTime,
  stableError,
  succeed,
  toEpoch,
  trustedEntryAuthorizer,
  validateOperationRequest,
  validatePlanResolution,
} from '../../export/member/contracts';
import type {
  CallContext,
  CallOutcome,
  CreateMembershipRequest,
  CreateMembershipResponse,
  MemberRuntimeDeps,
  OperationHandler,
  StoredMembership,
} from '../../export/member/types';

export function createCreateMembershipHandler(
  deps: MemberRuntimeDeps,
): OperationHandler<CreateMembershipRequest, CreateMembershipResponse> {
  const authorizer = deps.authorizer ?? trustedEntryAuthorizer;
  const clock = deps.clock ?? (() => new Date().toISOString());

  return async function handle(
    request: CreateMembershipRequest,
    context: CallContext,
  ): Promise<CallOutcome<CreateMembershipResponse>> {
    // 1. 授权
    const authorized = await authorizer.authorize({
      operation_id: 'create_membership',
      request,
      context,
    });
    if (!authorized) {
      return fail(
        context,
        stableError('create_membership', 'OPERATION_NOT_AUTHORIZED'),
      );
    }

    // 2. 请求 Schema 完整校验（B-06：required/type/additionalProperties/
    //    minLength/date-time；直接调用路径同样不可绕过）
    const validation = validateOperationRequest('create_membership', request);
    if (!validation.ok) {
      const code =
        validation.category === 'identity'
          ? 'MEMBER_IDENTITY_MISSING'
          : validation.category === 'time'
            ? 'INVALID_BUSINESS_TIME'
            : 'MEMBERSHIP_REQUIRED_INPUT_MISSING';
      return fail(context, stableError('create_membership', code));
    }
    let requestedTime: Date | null = null;
    if (request.requested_effective_time !== undefined) {
      requestedTime = parseDateTime(request.requested_effective_time);
      if (requestedTime === null) {
        return fail(
          context,
          stableError('create_membership', 'INVALID_BUSINESS_TIME'),
        );
      }
    }

    // 3. 会员必须真实存在
    const member = await deps.repository.getMemberByRef(request.member_ref);
    if (member === null) {
      return fail(context, stableError('create_membership', 'MEMBER_NOT_FOUND'));
    }

    // 4. 生效时点边界（R-TEMPORAL-BOUNDS）
    const commitTime = context.commit_time ?? clock();
    const commitEpoch = toEpoch(commitTime);
    const effectiveTime = requestedTime
      ? request.requested_effective_time!
      : commitTime;
    const effectiveEpoch = requestedTime
      ? requestedTime.getTime()
      : commitEpoch;

    if (effectiveEpoch > commitEpoch) {
      return fail(
        context,
        stableError('create_membership', 'INVALID_BUSINESS_TIME'),
      );
    }
    if (effectiveEpoch < toEpoch(member.created_at)) {
      return fail(
        context,
        stableError('create_membership', 'INVALID_BUSINESS_TIME'),
      );
    }

    // 5. 拟生效时点会员生命周期状态必须 active（R-EFFECTIVE-TIME-MEMBER-STATUS）
    if (
      member.terminated_at !== null &&
      effectiveEpoch >= toEpoch(member.terminated_at)
    ) {
      return fail(
        context,
        stableError('create_membership', 'INVALID_STATE_TRANSITION'),
      );
    }

    // 6. 精确解析外部方案；只接受 state=active（R-PLAN-EXISTENCE）
    let planResult: Awaited<
      ReturnType<MemberRuntimeDeps['planProvider']['resolveMembershipPlan']>
    >;
    try {
      planResult = await deps.planProvider.resolveMembershipPlan(
        { membership_plan_ref: request.plan_ref },
        context,
      );
    } catch {
      return fail(
        context,
        stableError('create_membership', 'DEPENDENCY_INFORMATION_INCOMPLETE'),
      );
    }
    if (planResult.outcome_type === 'STABLE_ERROR') {
      // stable_error_mode: PRESERVE_EXACT
      return fail(
        context,
        preserveExactProviderStableError(
          'create_membership',
          planResult.stable_error,
        ),
      );
    }
    // B-01/B-02：五必填字段完整性 + 响应身份与请求 plan_ref 精确核对 + active。
    // 调用成功、非空对象或“恰好某个方案 active”均不得替代精确解析。
    const bindingIssue = validatePlanResolution(
      planResult.membership_plan,
      request.plan_ref,
    );
    if (!bindingIssue.ok) {
      if (bindingIssue.reason === 'MALFORMED_BINDING') {
        return fail(
          context,
          stableError('create_membership', 'DEPENDENCY_INFORMATION_INCOMPLETE'),
        );
      }
      // PLAN_REF_MISMATCH（A→B）与 PLAN_NOT_ACTIVE（A→A/inactive）
      return fail(
        context,
        stableError('create_membership', 'MEMBERSHIP_PLAN_NOT_FOUND'),
      );
    }

    // 7. 有效区间不得重叠（R-ONE-EFFECTIVE-RELATION 的预检，原子写入兜底）
    const existing = await deps.repository.listMembershipsByMember(
      request.member_ref,
    );
    const overlap = existing.some(
      (m) =>
        m.termination_time === null || toEpoch(m.termination_time) > effectiveEpoch,
    );
    if (overlap) {
      return fail(
        context,
        stableError('create_membership', 'MEMBERSHIP_RELATION_CONFLICT'),
      );
    }

    // 8. 原子建立关系
    const record: StoredMembership = {
      membership_ref: generateMembershipRef(),
      member_ref: member.member_ref,
      plan_ref: request.plan_ref,
      membership_status: 'active',
      effective_time: effectiveTime,
      termination_time: null,
      version: 1,
    };
    const inserted = await deps.repository.insertMembershipAtomic(record);
    if (!inserted.ok) {
      // B-03：提交时会员已终止/历史状态不满足 -> INVALID_STATE_TRANSITION；
      // 仓储事务保证拒绝时无任何部分写入。
      const code =
        inserted.reason === 'OVERLAP'
          ? 'MEMBERSHIP_RELATION_CONFLICT'
          : inserted.reason === 'MEMBER_NOT_ACTIVE_AT_TIME'
            ? 'INVALID_STATE_TRANSITION'
            : inserted.reason === 'MEMBER_NOT_FOUND'
              ? 'MEMBER_NOT_FOUND'
              : 'CONCURRENT_MODIFICATION_CONFLICT';
      return fail(context, stableError('create_membership', code));
    }

    return succeed(context, {
      membership_ref: inserted.record.membership_ref,
      membership_status: 'active',
      effective_time: inserted.record.effective_time,
    });
  };
}
