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

import { succeed, trustedEntryAuthorizer } from '../../export/member/contracts';
import type {
  CallContext,
  CallOutcome,
  CreateMembershipRequest,
  CreateMembershipResponse,
  MemberRuntimeDeps,
  OperationHandler,
} from '../../export/member/types';
import { validateCreateMembershipRequest } from './validator';
import { evaluateCreateMembershipTime, hasCreateMembershipOverlap } from './policy';
import { resolveActiveCreateMembershipPlan } from './dependency';
import {
  loadCreateMembershipMember,
  listCreateMembershipRelations,
  insertCreateMembershipAtomic,
} from './repository';
import {
  createMembershipFailure,
  createMembershipProviderFailure,
  createMembershipInsertErrorCode,
} from './errors';
import { toCreateMembershipResponse } from './mapper';

/**
 * Operation entry stays here. Roles below remain implementation-private
 * inside this same Operation directory; no extra execution or Anchor layer.
 */
export function createCreateMembershipHandler(
  deps: MemberRuntimeDeps,
): OperationHandler<CreateMembershipRequest, CreateMembershipResponse> {
  const authorizer = deps.authorizer ?? trustedEntryAuthorizer;
  const clock = deps.clock ?? (() => new Date().toISOString());

  return async function handle(
    request: CreateMembershipRequest,
    context: CallContext,
  ): Promise<CallOutcome<CreateMembershipResponse>> {
    // 1. Authorization precedes validation and any business dependency.
    const authorized = await authorizer.authorize({
      operation_id: 'create_membership',
      request,
      context,
    });
    if (!authorized) {
      return createMembershipFailure(context, 'OPERATION_NOT_AUTHORIZED');
    }

    // 2. Existing exact schema and requested-time validation.
    const validation = validateCreateMembershipRequest(request, context);
    if (!validation.ok) return validation.outcome;

    // 3. Member existence must be established before effective-time rules.
    const member = await loadCreateMembershipMember(deps.repository, request.member_ref);
    if (member === null) {
      return createMembershipFailure(context, 'MEMBER_NOT_FOUND');
    }

    // 4–5. Contract-defined business-time and member-state guards.
    const commitTime = context.commit_time ?? clock();
    const timing = evaluateCreateMembershipTime(
      member, validation.requestedTime, request.requested_effective_time, commitTime,
    );
    if (!timing.ok) {
      return createMembershipFailure(context, timing.errorCode);
    }

    // 6. Existing declared Membership Plan Provider, without importing its handler.
    const plan = await resolveActiveCreateMembershipPlan(
      deps.planProvider, request.plan_ref, context,
    );
    if (plan.kind === 'provider_stable_error') {
      return createMembershipProviderFailure(context, plan.stableError);
    }
    if (plan.kind === 'rejected') {
      return createMembershipFailure(context, plan.errorCode);
    }

    // 7. Preflight overlap; the repository remains the atomic final authority.
    const existing = await listCreateMembershipRelations(deps.repository, request.member_ref);
    if (hasCreateMembershipOverlap(existing, timing.effectiveEpoch)) {
      return createMembershipFailure(context, 'MEMBERSHIP_RELATION_CONFLICT');
    }

    // 8. Atomic commit and stable-error closure.
    const inserted = await insertCreateMembershipAtomic(
      deps.repository, member.member_ref, request.plan_ref, timing.effectiveTime,
    );
    if (!inserted.ok) {
      return createMembershipFailure(context, createMembershipInsertErrorCode(inserted.reason));
    }
    return succeed(context, toCreateMembershipResponse(inserted.record));
  };
}
