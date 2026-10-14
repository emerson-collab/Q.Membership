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

import { StableRuntimeError } from '#q/p0/runtime_contract';
import type { HookBinding, RuntimeContext } from '#q/p0/runtime_contract';
import { register_business_operation } from '../../business_runtime/business_operation_registry';
import type {
  BusinessOperationAuthorization,
  BusinessOperationHandler,
  BusinessOperationRouteBinding,
  P1StaticRuntimeSlotProjection,
} from '../../business_runtime/business_operation_registry';
import type { P1CapabilityGeneralSlotProjection } from '../../business_runtime/stage_extension_contract';
import {
  StableError,
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
  Clock,
  CreateMemberRequest,
  CreateMemberResponse,
  MemberRepository,
  MemberRuntimeDeps,
  OperationHandler,
  StoredMember,
} from '../../export/member/types';

/**
 * 两种受支持的调用入口只共享这一份业务实现。
 * 授权属于执行入口；此函数只负责请求校验和原子建立。
 */
async function executeCreateMember(
  input: unknown,
  repository: MemberRepository,
  commitTime: () => string,
): Promise<CreateMemberResponse> {
  const validation = validateOperationRequest('create_member', input);
  if (!validation.ok) {
    throw stableError(
      'create_member',
      validation.category === 'identity'
        ? 'MEMBER_IDENTITY_MISSING'
        : 'MEMBERSHIP_REQUIRED_INPUT_MISSING',
    );
  }

  const request = input as CreateMemberRequest;
  const record: StoredMember = {
    member_ref: generateMemberRef(),
    identity_namespace: request.member_identity.identity_namespace,
    identity_value: request.member_identity.identity_value,
    display_name: request.registration_profile.display_name,
    contact_email: request.registration_profile.contact_email ?? null,
    member_status: 'active',
    created_at: commitTime(),
    terminated_at: null,
    terminate_reason: null,
    version: 1,
  };

  // 精确原始身份键；唯一性校验与写入必须由仓储原子保证。
  const result = await repository.insertMemberAtomic(record);
  if (!result.ok) {
    throw stableError(
      'create_member',
      result.reason === 'DUPLICATE_IDENTITY'
        ? 'MEMBER_DUPLICATE_REGISTRATION'
        : 'CONCURRENT_MODIFICATION_CONFLICT',
    );
  }
  return {
    member_ref: result.record.member_ref,
    member_status: 'active',
  };
}

/**
 * 保留原 Member 本地调用契约，避免破坏现有 client/test 使用者。
 * 与 P1 执行入口共享同一个 executeCreateMember，不复制业务处理。
 */
export function createCreateMemberHandler(
  deps: MemberRuntimeDeps,
): OperationHandler<CreateMemberRequest, CreateMemberResponse> {
  const authorizer = deps.authorizer ?? trustedEntryAuthorizer;
  const clock = deps.clock ?? (() => new Date().toISOString());

  return async function handle(
    request: CreateMemberRequest,
    context: CallContext,
  ): Promise<CallOutcome<CreateMemberResponse>> {
    // 原入口维持授权在前；无可信授权默认拒绝。
    const authorized = await authorizer.authorize({
      operation_id: 'create_member',
      request,
      context,
    });
    if (!authorized) {
      return fail(context, stableError('create_member', 'OPERATION_NOT_AUTHORIZED'));
    }

    try {
      const result = await executeCreateMember(
        request,
        deps.repository,
        () => context.commit_time ?? clock(),
      );
      return succeed(context, result);
    } catch (error) {
      if (error instanceof StableError) return fail(context, error);
      throw error;
    }
  };
}

/**
 * 符合 P1 Registry 所要求的 BusinessOperationHandler。
 * P1 在调用本函数之前完成授权；P0 负责唯一一次业务执行。
 * RuntimeContext 不被伪装成原来的业务 CallContext。
 */
function createP1CreateMemberOperation(
  repository: MemberRepository,
  clock: Clock,
): BusinessOperationHandler {
  return async function createMember(
    input: unknown,
    _runtimeContext: RuntimeContext,
  ): Promise<CreateMemberResponse> {
    try {
      return await executeCreateMember(input, repository, clock);
    } catch (error) {
      if (error instanceof StableError) {
        throw new StableRuntimeError(error.code, error.message);
      }
      throw error;
    }
  };
}

/**
 * 将此 Operation 的实际函数引用注册到现有 P1 Framework Registry。
 * GENERAL/static Slots 与授权回执必须由现有受治理装配过程提供；
 * 此处不制造哈希、权限规则或 Runtime 变量，也不修改 P1 骨架。
 * 注册应在装配阶段调用一次；不是每次请求都重新注册。
 */
export function registerCreateMemberWithP1(binding: {
  readonly general_slots: P1CapabilityGeneralSlotProjection;
  readonly static_runtime_slots: P1StaticRuntimeSlotProjection;
  readonly authorization: BusinessOperationAuthorization;
  readonly repository: MemberRepository;
  readonly clock?: Clock;
  readonly hook_binding_set?: readonly HookBinding[];
}): BusinessOperationRouteBinding {
  // 防止把 create_member 的 Handler 绑定到其他 Operation / Interface。
  const expectedContractRef = 'Q.MEMBERSHIP.CONTRACT.CAPABILITY.MEMBER@V0104';
  const slots = binding.general_slots;
  if (
    slots.capability_contract_ref?.value !== expectedContractRef
    || slots.capability_id?.value !== 'member'
    || slots.operation_id?.value !== 'create_member'
    || slots.operation_ref?.value !== `${expectedContractRef}#/operations/create_member`
    || slots.interface_ref?.value !== `${expectedContractRef}#/interfaces/member_creation_invoke`
    || slots.surface?.value !== 'CALL'
    || slots.kind?.value !== 'CALL_INVOKE'
    || slots.method_ref?.value !== 'create_member'
  ) {
    throw new StableRuntimeError(
      'P1_BINDING_INVALID',
      'create_member must bind its exact declared Member Operation and Interface',
    );
  }

  const handler: BusinessOperationHandler = createP1CreateMemberOperation(
    binding.repository,
    binding.clock ?? (() => new Date().toISOString()),
  );
  return register_business_operation(
    binding.general_slots,
    handler,
    binding.static_runtime_slots,
    binding.authorization,
    binding.hook_binding_set,
  );
}
