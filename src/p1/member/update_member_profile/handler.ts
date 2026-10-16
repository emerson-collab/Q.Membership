/**
 * Operation 03｜update_member_profile｜修改会员档案（对外）
 *
 * 业务要点（DESC 二.03 / R-IDENTITY-STABLE）：
 *  - 仅允许修改 display_name、contact_email；稳定身份与状态不可改。
 *  - profile_changes 至少一个可维护字段；空操作拒绝。
 *  - 不禁止已终止会员的合法资料修正（不得擅自增设限制）。
 *  - 相同内容重复提交不产生额外事实（幂等返回 no_change）。
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
  ProfileChanges,
  UpdateMemberProfileRequest,
  UpdateMemberProfileResponse,
} from '../../export/member/types.ts';

export function createUpdateMemberProfileHandler(
  deps: MemberRuntimeDeps,
): OperationHandler<UpdateMemberProfileRequest, UpdateMemberProfileResponse> {
  const authorizer = deps.authorizer ?? trustedEntryAuthorizer;

  return async function handle(
    request: UpdateMemberProfileRequest,
    context: CallContext,
  ): Promise<CallOutcome<UpdateMemberProfileResponse>> {
    // 1. 授权
    const authorized = await authorizer.authorize({
      operation_id: 'update_member_profile',
      request,
      context,
    });
    if (!authorized) {
      return fail(
        context,
        stableError('update_member_profile', 'OPERATION_NOT_AUTHORIZED'),
      );
    }

    // 2/3. 请求 Schema 完整校验（B-06）：
    //      顶层 additionalProperties:false；profile_changes 仅允许
    //      display_name/contact_email（member_ref、member_status 等任何
    //      未声明键 -> MEMBER_PROFILE_FIELD_NOT_MODIFIABLE），minProperties:1。
    const validation = validateOperationRequest('update_member_profile', request);
    if (!validation.ok) {
      const code =
        validation.category === 'identity'
          ? 'MEMBER_IDENTITY_MISSING'
          : validation.category === 'field_policy'
            ? 'MEMBER_PROFILE_FIELD_NOT_MODIFIABLE'
            : 'MEMBERSHIP_REQUIRED_INPUT_MISSING';
      return fail(context, stableError('update_member_profile', code));
    }

    const candidate = request.profile_changes as ProfileChanges;

    // 4. 会员必须存在（ANY_STATE：不限制 terminated 会员修正档案）
    const stored = await deps.repository.getMemberByRef(request.member_ref);
    if (stored === null) {
      return fail(context, stableError('update_member_profile', 'MEMBER_NOT_FOUND'));
    }

    // 5. 乐观锁原子更新；内容相同视为 no_change，不制造额外事实
    const updateResult = await deps.repository.updateMemberProfileAtomic({
      member_ref: request.member_ref,
      expected_version: stored.version,
      ...(candidate.display_name !== undefined
        ? { display_name: candidate.display_name }
        : {}),
      ...(candidate.contact_email !== undefined
        ? { contact_email: candidate.contact_email }
        : {}),
    });

    if (!updateResult.ok) {
      const code =
        updateResult.reason === 'NOT_FOUND'
          ? 'MEMBER_NOT_FOUND'
          : 'CONCURRENT_MODIFICATION_CONFLICT';
      return fail(context, stableError('update_member_profile', code));
    }

    return succeed(context, {
      member_ref: updateResult.record.member_ref,
      update_result: updateResult.changed ? 'applied' : 'no_change',
      member_profile: {
        display_name: updateResult.record.display_name,
      },
    });
  };
}
