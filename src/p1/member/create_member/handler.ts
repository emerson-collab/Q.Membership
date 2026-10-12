/**
 * Operation 01｜create_member｜创建会员（对外）
 *
 * 业务要点（DESC 二.01 / R-DUPLICATE-REGISTRATION / R-AUTH-DEFAULT-DENY）：
 *  - 先授权；无证据默认拒绝（OPERATION_NOT_AUTHORIZED）。
 *  - (identity_namespace, identity_value) 原始字节组合精确判重，
 *    不做大小写或空白归一化。
 *  - 唯一性确认与创建是同一次原子业务动作；并发不得双双成功。
 *  - 初始 member_status=active；不建立方案关系、账号、订单或支付事实。
 */

import {
  fail,
  generateMemberRef,
  stableError,
  succeed,
  trustedEntryAuthorizer,
  validateOperationRequest,
} from '../../export/member/contracts';
import type {
  CallContext,
  CallOutcome,
  CreateMemberRequest,
  CreateMemberResponse,
  MemberRuntimeDeps,
  OperationHandler,
  StoredMember,
} from '../../export/member/types';

export function createCreateMemberHandler(
  deps: MemberRuntimeDeps,
): OperationHandler<CreateMemberRequest, CreateMemberResponse> {
  const authorizer = deps.authorizer ?? trustedEntryAuthorizer;
  const clock = deps.clock ?? (() => new Date().toISOString());

  return async function handle(
    request: CreateMemberRequest,
    context: CallContext,
  ): Promise<CallOutcome<CreateMemberResponse>> {
    // 1. 授权（R-AUTH-DEFAULT-DENY，FAIL_CLOSED）
    const authorized = await authorizer.authorize({
      operation_id: 'create_member',
      request,
      context,
    });
    if (!authorized) {
      return fail(context, stableError('create_member', 'OPERATION_NOT_AUTHORIZED'));
    }

    // 2. 请求 Schema 完整校验（B-06）：顶层与 member_identity/
    //    registration_profile 嵌套对象均 additionalProperties:false，
    //    长度/email 约束按契约执行；直接调用路径不可绕过。
    const validation = validateOperationRequest('create_member', request);
    if (!validation.ok) {
      return fail(
        context,
        stableError(
          'create_member',
          validation.category === 'identity'
            ? 'MEMBER_IDENTITY_MISSING'
            : 'MEMBERSHIP_REQUIRED_INPUT_MISSING',
        ),
      );
    }

    const identity = request.member_identity;
    const profile = request.registration_profile;
    const commitTime = context.commit_time ?? clock();

    // 3. 原子判重 + 创建（精确键，不做任何归一化）
    const record: StoredMember = {
      member_ref: generateMemberRef(),
      identity_namespace: identity.identity_namespace,
      identity_value: identity.identity_value,
      display_name: profile.display_name,
      contact_email: profile.contact_email ?? null,
      member_status: 'active',
      created_at: commitTime,
      terminated_at: null,
      terminate_reason: null,
      version: 1,
    };

    const result = await deps.repository.insertMemberAtomic(record);
    if (!result.ok) {
      const code =
        result.reason === 'DUPLICATE_IDENTITY'
          ? 'MEMBER_DUPLICATE_REGISTRATION'
          : 'CONCURRENT_MODIFICATION_CONFLICT';
      return fail(context, stableError('create_member', code));
    }

    // 4. 成功仅表示会员身份建立，不蕴含关系/支付/权益
    return succeed(context, {
      member_ref: result.record.member_ref,
      member_status: 'active',
    });
  };
}
