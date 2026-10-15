/**
 * Operation 07｜lookup_membership｜按会员与时点查询唯一生效关系（对外）
 *
 * 业务要点（DESC 二.07 / R-HISTORICAL-INTERVAL-LOOKUP）：
 *  - 半开区间：effective_time <= as_of_time < termination_time；null 表示未结束。
 *  - as_of_time 缺省=查询时点；显式时点不得是未来，且必须严格按时点解释，
 *    不得用当前关系替代历史关系。
 *  - 完整事实证明无关系时返回空集合（权威空结果，不是错误）。
 *  - 多条重叠无法唯一解释时返回稳定错误，禁止伪造单条结果。
 */

import {
  fail,
  isEffectiveAt,
  parseDateTime,
  stableError,
  succeed,
  toEpoch,
  trustedEntryAuthorizer,
  validateOperationRequest,
} from '../../export/member/contracts.ts';
import type {
  CallContext,
  CallOutcome,
  LookupMembershipRequest,
  LookupMembershipResponse,
  MemberRuntimeDeps,
  Membership,
  OperationHandler,
  StoredMembership,
} from '../../export/member/types';

export function toMembershipView(stored: StoredMembership): Membership {
  return {
    membership_ref: stored.membership_ref,
    member_ref: stored.member_ref,
    plan_ref: stored.plan_ref,
    membership_status: stored.membership_status,
    effective_time: stored.effective_time,
    termination_time: stored.termination_time,
  };
}

export function createLookupMembershipHandler(
  deps: MemberRuntimeDeps,
): OperationHandler<LookupMembershipRequest, LookupMembershipResponse> {
  const authorizer = deps.authorizer ?? trustedEntryAuthorizer;
  const clock = deps.clock ?? (() => new Date().toISOString());

  return async function handle(
    request: LookupMembershipRequest,
    context: CallContext,
  ): Promise<CallOutcome<LookupMembershipResponse>> {
    // 1. 授权
    const authorized = await authorizer.authorize({
      operation_id: 'lookup_membership',
      request,
      context,
    });
    if (!authorized) {
      return fail(context, stableError('lookup_membership', 'OPERATION_NOT_AUTHORIZED'));
    }

    // 2. 请求 Schema 校验（B-06；as_of_time 非法真实日期由 B-08 严格解析拒绝）
    const validation = validateOperationRequest('lookup_membership', request);
    if (!validation.ok) {
      const code =
        validation.category === 'identity'
          ? 'MEMBER_IDENTITY_MISSING'
          : validation.category === 'time'
            ? 'INVALID_BUSINESS_TIME'
            : 'MEMBERSHIP_REQUIRED_INPUT_MISSING';
      return fail(context, stableError('lookup_membership', code));
    }

    const commitTime = context.commit_time ?? clock();
    const commitEpoch = toEpoch(commitTime);
    let asOfEpoch = commitEpoch;
    if (request.as_of_time !== undefined) {
      const parsed = parseDateTime(request.as_of_time);
      if (parsed === null) {
        return fail(context, stableError('lookup_membership', 'INVALID_BUSINESS_TIME'));
      }
      // PRESENT_ANY_PAST_TIMESTAMP_NOT_FUTURE
      if (parsed.getTime() > commitEpoch) {
        return fail(context, stableError('lookup_membership', 'INVALID_BUSINESS_TIME'));
      }
      asOfEpoch = parsed.getTime();
    }

    // 3. 会员身份可精确解析（历史查询也要先确认会员事实存在）
    const member = await deps.repository.getMemberByRef(request.member_ref);
    if (member === null) {
      return fail(context, stableError('lookup_membership', 'MEMBER_NOT_FOUND'));
    }

    // 4. 半开区间选择
    const all = await deps.repository.listMembershipsByMember(request.member_ref);
    const effective = all.filter((m) =>
      isEffectiveAt(m.effective_time, m.termination_time, asOfEpoch),
    );

    if (effective.length > 1) {
      // 历史互相重叠：无法唯一解释，不得伪造单条
      return fail(
        context,
        stableError('lookup_membership', 'DEPENDENCY_INFORMATION_INCOMPLETE'),
      );
    }

    return succeed(context, {
      memberships: effective.map(toMembershipView),
    });
  };
}
