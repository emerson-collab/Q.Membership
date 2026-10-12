/**
 * Operation 06｜update_membership_plan｜替换会员方案（对外；不含续期）
 *
 * 业务要点（DESC 二.06 / R-ATOMIC-RELATION-REPLACEMENT / R-RETRY-NO-DUPLICATE-RELATION）：
 *  - 旧关系必须明确指定、属于该会员且处于 active；已 replaced 不得二次成功。
 *  - 目标方案经 Provider 精确解析且 state=active，且与旧方案不同。
 *  - 生效时点不得早于旧关系开始、不得晚于提交；不得产生重叠区间。
 *  - 同一业务时点原子结束旧关系（replaced）并建立新关系（active）；
 *    旧关系 termination_time 必须等于新关系 effective_time。
 */

import {
  StableError,
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
  MemberRuntimeDeps,
  OperationHandler,
  StoredMembership,
  UpdateMembershipPlanRequest,
  UpdateMembershipPlanResponse,
} from '../../export/member/types';

export function createUpdateMembershipPlanHandler(
  deps: MemberRuntimeDeps,
): OperationHandler<UpdateMembershipPlanRequest, UpdateMembershipPlanResponse> {
  const authorizer = deps.authorizer ?? trustedEntryAuthorizer;
  const clock = deps.clock ?? (() => new Date().toISOString());

  return async function handle(
    request: UpdateMembershipPlanRequest,
    context: CallContext,
  ): Promise<CallOutcome<UpdateMembershipPlanResponse>> {
    // 1. 授权
    const authorized = await authorizer.authorize({
      operation_id: 'update_membership_plan',
      request,
      context,
    });
    if (!authorized) {
      return fail(
        context,
        stableError('update_membership_plan', 'OPERATION_NOT_AUTHORIZED'),
      );
    }

    // 2. 请求 Schema 完整校验（B-06）
    const validation = validateOperationRequest('update_membership_plan', request);
    if (!validation.ok) {
      const code =
        validation.category === 'identity'
          ? 'MEMBER_IDENTITY_MISSING'
          : validation.category === 'time'
            ? 'INVALID_BUSINESS_TIME'
            : 'MEMBERSHIP_REQUIRED_INPUT_MISSING';
      return fail(context, stableError('update_membership_plan', code));
    }
    let requestedTime: Date | null = null;
    if (request.requested_effective_time !== undefined) {
      requestedTime = parseDateTime(request.requested_effective_time);
      if (requestedTime === null) {
        return fail(
          context,
          stableError('update_membership_plan', 'INVALID_BUSINESS_TIME'),
        );
      }
    }

    // 3. 会员与旧关系必须精确解析且归属正确
    const member = await deps.repository.getMemberByRef(request.member_ref);
    if (member === null) {
      return fail(context, stableError('update_membership_plan', 'MEMBER_NOT_FOUND'));
    }
    const previous = await deps.repository.getMembershipByRef(
      request.current_membership_ref,
    );
    if (previous === null || previous.member_ref !== request.member_ref) {
      return fail(
        context,
        stableError('update_membership_plan', 'MEMBERSHIP_NOT_FOUND'),
      );
    }
    // 只有 active 关系可更换；replaced 重试不得产生第二个后继
    if (previous.membership_status !== 'active') {
      return fail(
        context,
        stableError('update_membership_plan', 'INVALID_STATE_TRANSITION'),
      );
    }

    // 4. 时间边界
    const commitTime = context.commit_time ?? clock();
    const commitEpoch = toEpoch(commitTime);
    const effectiveTime = requestedTime
      ? request.requested_effective_time!
      : commitTime;
    const effectiveEpoch = requestedTime ? requestedTime.getTime() : commitEpoch;

    if (effectiveEpoch > commitEpoch) {
      return fail(
        context,
        stableError('update_membership_plan', 'INVALID_BUSINESS_TIME'),
      );
    }
    // B-04：前置“不早于”与对象不变量“replaced 必须 effective<termination”
    // 取交集——新起点必须严格晚于旧关系开始；等于旧开始会制造零长度旧区间。
    if (effectiveEpoch <= toEpoch(previous.effective_time)) {
      return fail(
        context,
        stableError('update_membership_plan', 'INVALID_BUSINESS_TIME'),
      );
    }

    // 5. 目标方案必须存在、active，且与旧方案不同
    if (request.target_plan_ref === previous.plan_ref) {
      return fail(
        context,
        stableError('update_membership_plan', 'INVALID_STATE_TRANSITION'),
      );
    }
    let planResult: Awaited<
      ReturnType<MemberRuntimeDeps['planProvider']['resolveMembershipPlan']>
    >;
    try {
      planResult = await deps.planProvider.resolveMembershipPlan(
        { membership_plan_ref: request.target_plan_ref },
        context,
      );
    } catch {
      return fail(
        context,
        stableError('update_membership_plan', 'DEPENDENCY_INFORMATION_INCOMPLETE'),
      );
    }
    if (planResult.outcome_type === 'STABLE_ERROR') {
      return fail(
        context,
        new StableError(
          planResult.stable_error.code,
          planResult.stable_error.message,
        ),
      );
    }
    // B-01/B-02：与 create_membership 同一判定——结构完整、身份精确、active
    const bindingIssue = validatePlanResolution(
      planResult.membership_plan,
      request.target_plan_ref,
    );
    if (!bindingIssue.ok) {
      if (bindingIssue.reason === 'MALFORMED_BINDING') {
        return fail(
          context,
          stableError(
            'update_membership_plan',
            'DEPENDENCY_INFORMATION_INCOMPLETE',
          ),
        );
      }
      return fail(
        context,
        stableError('update_membership_plan', 'MEMBERSHIP_PLAN_NOT_FOUND'),
      );
    }

    // 6. 除旧关系外不得与其它关系在替换时点重叠
    const siblings = await deps.repository.listMembershipsByMember(
      request.member_ref,
    );
    const otherOverlap = siblings.some(
      (m) =>
        m.membership_ref !== previous.membership_ref &&
        (m.termination_time === null ||
          toEpoch(m.termination_time) > effectiveEpoch),
    );
    if (otherOverlap) {
      return fail(
        context,
        stableError('update_membership_plan', 'MEMBERSHIP_RELATION_CONFLICT'),
      );
    }

    // 7. 原子更换：旧终止与新建立同成败
    const newRecord: StoredMembership = {
      membership_ref: generateMembershipRef(),
      member_ref: request.member_ref,
      plan_ref: request.target_plan_ref,
      membership_status: 'active',
      effective_time: effectiveTime,
      termination_time: null,
      version: 1,
    };
    const result = await deps.repository.replaceMembershipAtomic({
      member_ref: request.member_ref,
      current_membership_ref: previous.membership_ref,
      expected_version: previous.version,
      effective_time: effectiveTime,
      new_record: newRecord,
    });

    if (!result.ok) {
      switch (result.reason) {
        case 'MEMBERSHIP_NOT_FOUND':
          return fail(
            context,
            stableError('update_membership_plan', 'MEMBERSHIP_NOT_FOUND'),
          );
        case 'NOT_BELONG_TO_MEMBER':
          return fail(
            context,
            stableError('update_membership_plan', 'MEMBERSHIP_NOT_FOUND'),
          );
        case 'NOT_ACTIVE':
          return fail(
            context,
            stableError('update_membership_plan', 'INVALID_STATE_TRANSITION'),
          );
        case 'OVERLAP':
          return fail(
            context,
            stableError('update_membership_plan', 'MEMBERSHIP_RELATION_CONFLICT'),
          );
        case 'INVALID_INTERVAL':
          // B-04：提交时并发复核未过（旧区间会退化为零长度），整体回滚
          return fail(
            context,
            stableError('update_membership_plan', 'INVALID_BUSINESS_TIME'),
          );
        default:
          return fail(
            context,
            stableError('update_membership_plan', 'CONCURRENT_MODIFICATION_CONFLICT'),
          );
      }
    }

    return succeed(context, {
      membership_ref: result.current.membership_ref,
      previous_membership_ref: result.previous.membership_ref,
      membership_status: 'active',
      effective_time: effectiveTime,
    });
  };
}
