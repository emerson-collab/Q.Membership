/**
 * Operation 09｜resolve_membership｜精确读取已有会员关系（仅内部，不对外发布）
 *
 * 业务要点（DESC 二.09 / R-EXACT-INTERNAL-MEMBERSHIP-READ）：
 *  - 仅限被允许的内部业务用途：既要有操作授权，也要有内部用途证据。
 *  - 严格按 membership_ref 取唯一记录，绝不自动选“最新”、不以其它关系代替。
 *  - replaced 历史关系只要仍保存，就按指定 ID 原样返回。
 */

import {
  fail,
  hasInternalPurpose,
  stableError,
  succeed,
  trustedEntryAuthorizer,
  validateOperationRequest,
} from '../../export/member/contracts.ts';
import { toMembershipView } from '../lookup_membership/handler.ts';
import type {
  CallContext,
  CallOutcome,
  MemberRuntimeDeps,
  OperationHandler,
  ResolveMembershipRequest,
  ResolveMembershipResponse,
} from '../../export/member/types.ts';

export function createResolveMembershipHandler(
  deps: MemberRuntimeDeps,
): OperationHandler<ResolveMembershipRequest, ResolveMembershipResponse> {
  const authorizer = deps.authorizer ?? trustedEntryAuthorizer;

  return async function handle(
    request: ResolveMembershipRequest,
    context: CallContext,
  ): Promise<CallOutcome<ResolveMembershipResponse>> {
    // 1. 内部授权：操作授权 + 明确的内部用途证据，缺一不可
    const authorized = await authorizer.authorize({
      operation_id: 'resolve_membership',
      request,
      context,
    });
    if (!authorized || !hasInternalPurpose(context)) {
      return fail(
        context,
        stableError('resolve_membership', 'OPERATION_NOT_AUTHORIZED'),
      );
    }

    // 2. 请求 Schema 校验（B-06；空 membership_ref -> MEMBERSHIP_REF_REQUIRED）
    const validation = validateOperationRequest('resolve_membership', request);
    if (!validation.ok) {
      return fail(
        context,
        stableError(
          'resolve_membership',
          validation.category === 'ref_required'
            ? 'MEMBERSHIP_REF_REQUIRED'
            : 'MEMBERSHIP_REQUIRED_INPUT_MISSING',
        ),
      );
    }

    // 3. 按 ID 精确读取（ANY_STATE：replaced 也返回；不重新选择）
    const stored = await deps.repository.getMembershipByRef(
      request.membership_ref,
    );
    if (stored === null) {
      return fail(
        context,
        stableError('resolve_membership', 'MEMBERSHIP_NOT_FOUND'),
      );
    }

    return succeed(context, { membership: toMembershipView(stored) });
  };
}
