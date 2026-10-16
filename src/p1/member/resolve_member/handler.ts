/**
 * Operation 02｜resolve_member｜查询会员（对外）
 *
 * 业务要点（DESC 二.02 / R-OWNER-PROFILE-DISCLOSURE）：
 *  - 按精确 member_ref 定位；会员即使 terminated 也返回真实状态。
 *  - 默认只披露展示资料（display_name），不公开 contact_email。
 *  - 只读：不建立关系、不计算资格、不修改会员。
 */

import {
  fail,
  stableError,
  succeed,
  trustedEntryAuthorizer,
  validateOperationRequest,
} from '../../export/member/contracts.ts';
import type {
  CallContext,
  CallOutcome,
  Member,
  MemberRuntimeDeps,
  OperationHandler,
  ResolveMemberRequest,
  ResolveMemberResponse,
  StoredMember,
} from '../../export/member/types.ts';

/** 持久化会员 -> 对外会员视图（剥离联系方式） */
export function toMemberView(stored: StoredMember): Member {
  return {
    member_ref: stored.member_ref,
    member_status: stored.member_status,
    member_profile: {
      display_name: stored.display_name,
    },
  };
}

export function createResolveMemberHandler(
  deps: MemberRuntimeDeps,
): OperationHandler<ResolveMemberRequest, ResolveMemberResponse> {
  const authorizer = deps.authorizer ?? trustedEntryAuthorizer;

  return async function handle(
    request: ResolveMemberRequest,
    context: CallContext,
  ): Promise<CallOutcome<ResolveMemberResponse>> {
    // 1. 授权（权限不成立时不得泄露任何资料）
    const authorized = await authorizer.authorize({
      operation_id: 'resolve_member',
      request,
      context,
    });
    if (!authorized) {
      return fail(context, stableError('resolve_member', 'OPERATION_NOT_AUTHORIZED'));
    }

    // 2. 请求 Schema 校验（B-06；缺字段与空标识错误码不同，按契约映射）
    const validation = validateOperationRequest('resolve_member', request);
    if (!validation.ok) {
      return fail(
        context,
        stableError(
          'resolve_member',
          validation.category === 'identity'
            ? 'MEMBER_IDENTITY_MISSING'
            : 'MEMBERSHIP_REQUIRED_INPUT_MISSING',
        ),
      );
    }

    // 3. 精确读取（ANY_STATE：terminated 会员同样返回真实事实）
    const stored = await deps.repository.getMemberByRef(request.member_ref);
    if (stored === null) {
      return fail(context, stableError('resolve_member', 'MEMBER_NOT_FOUND'));
    }

    return succeed(context, { member: toMemberView(stored) });
  };
}
