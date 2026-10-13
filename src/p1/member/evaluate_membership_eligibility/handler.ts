/**
 * Operation 08｜evaluate_membership_eligibility｜判断会员资格（对外）
 *
 * 业务要点（DESC 二.08 / R-ELIGIBILITY-BASIS / R-ELIGIBILITY-REASON-PRIORITY）：
 *  - 仅支持 check_purpose=membership_validity；decision_time 不得晚于处理时点。
 *  - 必须读取该时点会员状态历史与关系历史；证据缺失/冲突/依赖异常
 *    不得伪装成 eligible=false，返回稳定错误。
 *  - 【补充候选】原因优先级：
 *      A. 该时点 terminated      -> false / MEMBER_TERMINATED
 *      B. active 且恰有一条生效关系 -> true  / MEMBERSHIP_VALID
 *      C. active 且权威证明无关系   -> false / NO_EFFECTIVE_MEMBERSHIP
 *      D. 事实缺失或多条相互矛盾    -> 稳定错误，不制造真假结论
 *  - eligible=false 是正常业务结果，不触发 StableError；不代表权益可用或支付完成。
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
} from '../../export/member/contracts';
import type {
  CallContext,
  CallOutcome,
  EligibilityDecision,
  EvaluateMembershipEligibilityRequest,
  EvaluateMembershipEligibilityResponse,
  MemberRuntimeDeps,
  MemberStatus,
  OperationHandler,
} from '../../export/member/types';

/** 读取会员在指定时点的生命周期状态；早于建立时点返回 null（事实不可解释） */
function memberStatusAt(
  member: { created_at: string; terminated_at: string | null },
  atEpochMs: number,
): MemberStatus | null {
  if (atEpochMs < toEpoch(member.created_at)) return null;
  if (
    member.terminated_at !== null &&
    atEpochMs >= toEpoch(member.terminated_at)
  ) {
    return 'terminated';
  }
  return 'active';
}

export function createEvaluateMembershipEligibilityHandler(
  deps: MemberRuntimeDeps,
): OperationHandler<
  EvaluateMembershipEligibilityRequest,
  EvaluateMembershipEligibilityResponse
> {
  const authorizer = deps.authorizer ?? trustedEntryAuthorizer;
  const clock = deps.clock ?? (() => new Date().toISOString());

  return async function handle(
    request: EvaluateMembershipEligibilityRequest,
    context: CallContext,
  ): Promise<CallOutcome<EligibilityDecision>> {
    // 1. 授权
    const authorized = await authorizer.authorize({
      operation_id: 'evaluate_membership_eligibility',
      request,
      context,
    });
    if (!authorized) {
      return fail(
        context,
        stableError('evaluate_membership_eligibility', 'OPERATION_NOT_AUTHORIZED'),
      );
    }

    // 2. 请求 Schema 校验（B-06）：五要素不完整不得给结论；
    //    不支持的 check_purpose 枚举 -> DEPENDENCY_INFORMATION_INCOMPLETE；
    //    非法真实日期（含 02-30 等）-> INVALID_BUSINESS_TIME（B-08）。
    const validation = validateOperationRequest(
      'evaluate_membership_eligibility',
      request,
    );
    if (!validation.ok) {
      const code =
        validation.category === 'identity'
          ? 'MEMBER_IDENTITY_MISSING'
          : validation.category === 'time'
            ? 'INVALID_BUSINESS_TIME'
            : validation.category === 'enum'
              ? 'DEPENDENCY_INFORMATION_INCOMPLETE'
              : 'MEMBERSHIP_REQUIRED_INPUT_MISSING';
      return fail(
        context,
        stableError('evaluate_membership_eligibility', code),
      );
    }
    // Schema 已保证 decision_time 为合法 date-time
    const decisionDate = parseDateTime(request.decision_time);
    if (decisionDate === null) {
      return fail(
        context,
        stableError('evaluate_membership_eligibility', 'INVALID_BUSINESS_TIME'),
      );
    }

    const commitTime = context.commit_time ?? clock();
    if (decisionDate.getTime() > toEpoch(commitTime)) {
      return fail(
        context,
        stableError('evaluate_membership_eligibility', 'INVALID_BUSINESS_TIME'),
      );
    }
    const decisionEpoch = decisionDate.getTime();

    // 3. 会员身份与时点生命周期历史必须可确认
    const member = await deps.repository.getMemberByRef(request.member_ref);
    if (member === null) {
      return fail(
        context,
        stableError('evaluate_membership_eligibility', 'MEMBER_NOT_FOUND'),
      );
    }
    const statusAtDecision = memberStatusAt(member, decisionEpoch);
    if (statusAtDecision === null) {
      // decision_time 早于会员建立：历史事实不可用，不能判 false
      return fail(
        context,
        stableError(
          'evaluate_membership_eligibility',
          'DEPENDENCY_INFORMATION_INCOMPLETE',
        ),
      );
    }

    // 4. 读取该时点关系历史；多条互相矛盾属于系统无法判断（分支 D）
    const all = await deps.repository.listMembershipsByMember(
      request.member_ref,
    );
    const effectiveAtTime = all.filter((m) =>
      isEffectiveAt(m.effective_time, m.termination_time, decisionEpoch),
    );
    if (effectiveAtTime.length > 1) {
      return fail(
        context,
        stableError(
          'evaluate_membership_eligibility',
          'DEPENDENCY_INFORMATION_INCOMPLETE',
        ),
      );
    }

    const consideredRefs = effectiveAtTime.map((m) => m.membership_ref);
    const decision: EligibilityDecision = {
      eligible: false,
      basis: {
        reason_code: 'NO_EFFECTIVE_MEMBERSHIP',
        check_purpose: 'membership_validity',
        decision_time: request.decision_time,
        member_status_at_decision: statusAtDecision,
        membership_refs_considered: consideredRefs,
      },
    };

    // 5. 原因优先级：先会员状态（A），后关系状态（B/C）
    if (statusAtDecision === 'terminated') {
      // A. 会员已终止：即便同时无关系，也以终止为首要原因
      decision.basis.reason_code = 'MEMBER_TERMINATED';
      decision.eligible = false;
    } else if (effectiveAtTime.length === 1) {
      // B. active 且恰有一条生效关系
      decision.basis.reason_code = 'MEMBERSHIP_VALID';
      decision.eligible = true;
    } else {
      // C. active 且权威历史证明无生效关系
      decision.basis.reason_code = 'NO_EFFECTIVE_MEMBERSHIP';
      decision.eligible = false;
    }

    return succeed(context, decision);
  };
}
