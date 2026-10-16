/**
 * Operation 04｜update_member_status｜变更会员生命周期状态（对外）
 *
 * 业务要点（DESC 二.04 / R-STATE-TRANSITION-GUARD）：
 *  - 本版唯一允许迁移：active -> terminated；无暂停、恢复、重复终止。
 *  - 原子变更并记录真实业务时点（提交时点）与可追溯事件。
 *  - 不删除身份/历史关系，不暗中更换方案关系。
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
  MemberRuntimeDeps,
  OperationHandler,
  UpdateMemberStatusRequest,
  UpdateMemberStatusResponse,
} from '../../export/member/types.ts';

export function createUpdateMemberStatusHandler(
  deps: MemberRuntimeDeps,
): OperationHandler<UpdateMemberStatusRequest, UpdateMemberStatusResponse> {
  const authorizer = deps.authorizer ?? trustedEntryAuthorizer;
  const clock = deps.clock ?? (() => new Date().toISOString());

  return async function handle(
    request: UpdateMemberStatusRequest,
    context: CallContext,
  ): Promise<CallOutcome<UpdateMemberStatusResponse>> {
    // 1. 授权
    const authorized = await authorizer.authorize({
      operation_id: 'update_member_status',
      request,
      context,
    });
    if (!authorized) {
      return fail(
        context,
        stableError('update_member_status', 'OPERATION_NOT_AUTHORIZED'),
      );
    }

    // 2. 请求 Schema 校验（B-06/B-07）：
    //    target_status 枚举非 terminated -> INVALID_STATE_TRANSITION（FAIL_CLOSED）；
    //    reason 字段一旦出现必须是 minLength:1 的字符串（不做 trim 后非空）。
    const validation = validateOperationRequest('update_member_status', request);
    if (!validation.ok) {
      const code =
        validation.category === 'identity'
          ? 'MEMBER_IDENTITY_MISSING'
          : validation.category === 'enum'
            ? 'INVALID_STATE_TRANSITION'
            : 'MEMBERSHIP_REQUIRED_INPUT_MISSING';
      return fail(context, stableError('update_member_status', code));
    }

    const stored = await deps.repository.getMemberByRef(request.member_ref);
    if (stored === null) {
      return fail(context, stableError('update_member_status', 'MEMBER_NOT_FOUND'));
    }
    // 重复终止不得制造第二次成功迁移
    if (stored.member_status !== 'active') {
      return fail(
        context,
        stableError('update_member_status', 'INVALID_STATE_TRANSITION'),
      );
    }

    // 3. CAS 原子终止，terminated_at 取真实业务提交时点
    const commitTime = context.commit_time ?? clock();
    const result = await deps.repository.terminateMemberAtomic({
      member_ref: request.member_ref,
      expected_version: stored.version,
      terminated_at: commitTime,
      reason: request.reason ?? null,
    });

    if (!result.ok) {
      const code =
        result.reason === 'NOT_FOUND'
          ? 'MEMBER_NOT_FOUND'
          : result.reason === 'NOT_ACTIVE'
            ? 'INVALID_STATE_TRANSITION'
            : 'CONCURRENT_MODIFICATION_CONFLICT';
      return fail(context, stableError('update_member_status', code));
    }

    return succeed(context, {
      member_ref: result.record.member_ref,
      member_status: 'terminated',
    });
  };
}
