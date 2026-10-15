/**
 * Member 9 Operations → P1 业务运行时注册表（business_operation_registry）
 *
 * 职责（本模块只做"适配 + 注册"，不新增任何会员业务语义）：
 *  1. 把 src/p1/member 下 9 个既有的 OperationHandler（会员契约语义：
 *     (request, CallContext) => Promise<CallOutcome>）适配成注册表要求的
 *     BusinessOperationHandler（P0 运行时语义：(input, RuntimeContext) => Promise<value>，
 *     业务错误以 throw StableRuntimeError 表达）。
 *  2. 按 P1 V0186 槽位规则，为每个 Operation 构造 13 个 GENERAL 槽 + 6 个静态槽，
 *     8 个对外 Operation 经 register_business_operation 注册；
 *     1 个仅内部 Operation（resolve_membership）经 register_internal_business_operation
 *     注册（不发明具体 Interface 身份）。
 *  3. 导出路由表与 RuntimeContext/Path 构造助手，供执行方（web 演示层）
 *     经 invoke_business_operation / invoke_internal_call 唯一管线调用。
 *
 * 关键边界：
 *  - P1 框架授权闸门（BusinessOperationAuthorization）只确认"授权在 Operation 尝试前
 *    已完成"这一 V0186 事实并回执；会员【业务授权】仍由各 handler 内注入的
 *    deps.authorizer 判定（契约默认 DENY 的 fail-closed 语义原样保留），
 *    op09 的 hasInternalPurpose 内部用途守卫也仍在会员 handler 内生效。
 *  - capability_contract_content_hash：V0104 元数据刻意不提供 owner 认证哈希
 *    （getMemberGeneralExportCandidate 该字段为 null）。这里对代码侧固化的
 *    V0104 Operation 清单（operation/interface 身份、surface/kind、封闭错误码集合）
 *    做确定性 canonical SHA-256，作为【本地绑定一致性身份】，不是 owner 签发的
 *    契约内容认证；同一进程内 9 个 Operation 使用同一哈希，满足 ONE_PER_CAPABILITY。
 *  - 注册幂等：注册表的 Map 是模块级单例，重复装配同一 deps 不会二次注册。
 */

import { createHash } from 'node:crypto';

import { P0_CONTRACT_REF, StableRuntimeError } from '#q/p0/runtime_contract';
import type { RuntimeContext } from '#q/p0/runtime_contract';
import {
  P1_CONTRACT_REF,
  P1_RUNTIME_SLOT_REFS,
  project_p1_capability_general_slots,
} from '../business_runtime/stage_extension_contract.ts';
import type { P1CapabilityGeneralSlotProjection } from '../business_runtime/stage_extension_contract.ts';
import {
  register_business_operation,
  register_internal_business_operation,
} from '../business_runtime/business_operation_registry.ts';
import type {
  BusinessOperationAuthorization,
  BusinessOperationHandler,
  BusinessOperationInvokePath,
  P1StaticRuntimeSlotProjection,
} from '../business_runtime/business_operation_registry.ts';
import { INTERNAL_OPERATION_IDS, normalizeCallContext } from '../export/member/contracts.ts';
import { MEMBER_CAPABILITY_METADATA } from '../export/member/metadata.ts';
import type {
  CallContext,
  MemberRuntimeDeps,
  OperationHandler,
  OperationId,
} from '../export/member/types.ts';

import { createCreateMemberHandler } from './create_member/handler.ts';
import { createResolveMemberHandler } from './resolve_member/handler.ts';
import { createUpdateMemberProfileHandler } from './update_member_profile/handler.ts';
import { createUpdateMemberStatusHandler } from './update_member_status/handler.ts';
import { createCreateMembershipHandler } from './create_membership/handler.ts';
import { createUpdateMembershipPlanHandler } from './update_membership_plan/handler.ts';
import { createLookupMembershipHandler } from './lookup_membership/handler.ts';
import { createEvaluateMembershipEligibilityHandler } from './evaluate_membership_eligibility/handler.ts';
import { createResolveMembershipHandler } from './resolve_membership/handler.ts';

// ---------------------------------------------------------------------------
// 一、路由身份
// ---------------------------------------------------------------------------

export interface MemberBusinessRoute {
  readonly operation_id: OperationId;
  readonly operation_ref: string;
  readonly interface_ref: string;
  /** true => 仅内部，经 invoke_internal_call 调用；false => 对外 CALL */
  readonly internal: boolean;
}

function buildRouteTable(): Readonly<Record<OperationId, MemberBusinessRoute>> {
  const routes = {} as Record<OperationId, MemberBusinessRoute>;
  for (const declared of MEMBER_CAPABILITY_METADATA.operations) {
    routes[declared.operation_id] = Object.freeze({
      operation_id: declared.operation_id,
      operation_ref: declared.operation_ref,
      interface_ref: declared.interface_ref,
      internal: (INTERNAL_OPERATION_IDS as readonly string[]).includes(declared.operation_id),
    });
  }
  return Object.freeze(routes);
}

export const MEMBER_BUSINESS_ROUTES = buildRouteTable();

/** 注册表按 capability_id+operation_id 解析时使用的能力身份 */
export const MEMBER_CAPABILITY_ID = MEMBER_CAPABILITY_METADATA.capability_id;

// ---------------------------------------------------------------------------
// 二、CallContext ↔ RuntimeContext 映射
// ---------------------------------------------------------------------------

/**
 * 会员业务上下文（authorization/internal_invocation/commit_time）经
 * RuntimeContext.attributes 透传的命名空间键。P0/P1 框架不解释其内容，
 * 适配层在 Operation 边界原样还原为会员契约 CallContext。
 */
export const MEMBER_CALL_CONTEXT_ATTRIBUTE =
  'Q.MEMBERSHIP.ATTRIBUTES.CALL_CONTEXT@V0104';

interface CarriedMemberContext {
  authorization?: CallContext['authorization'];
  internal_invocation?: CallContext['internal_invocation'];
  commit_time?: string;
}

function readCarriedMemberContext(
  runtimeContext: RuntimeContext,
): CarriedMemberContext {
  const raw = runtimeContext.attributes?.[MEMBER_CALL_CONTEXT_ATTRIBUTE];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const record = raw as Record<string, unknown>;
  const carried: CarriedMemberContext = {};
  if (record.commit_time !== undefined) {
    carried.commit_time = record.commit_time as string;
  }
  if (record.authorization !== undefined) {
    carried.authorization = record.authorization as CallContext['authorization'];
  }
  if (record.internal_invocation !== undefined) {
    carried.internal_invocation =
      record.internal_invocation as CallContext['internal_invocation'];
  }
  return carried;
}

/**
 * 把会员 CallOutcome 语义适配为 BusinessOperationHandler 语义：
 *  - SUCCESS    => 返回 runtime_result（成为 P0 管线的 value）
 *  - STABLE_ERROR => throw StableRuntimeError（P0 捕获后走 on_error，
 *    稳定错误码/消息原样透传，不伪造成功结果）
 *
 * request_id/trace_id 以 P0 RuntimeContext 为权威（经注册表校验与 path 一致），
 * 会员侧附加字段（commit_time/authorization/internal_invocation）从 attributes 还原。
 */
function adaptMemberHandler(
  handler: OperationHandler<unknown, unknown>,
): BusinessOperationHandler {
  return async function memberBusinessOperation(input, runtimeContext) {
    const carried = readCarriedMemberContext(runtimeContext);
    const callContext = normalizeCallContext(
      {
        request_id: runtimeContext.request_id,
        trace_id: runtimeContext.trace_id,
        ...(carried.commit_time !== undefined
          ? { commit_time: carried.commit_time }
          : {}),
        ...(carried.authorization !== undefined
          ? { authorization: carried.authorization }
          : {}),
        ...(carried.internal_invocation !== undefined
          ? { internal_invocation: carried.internal_invocation }
          : {}),
      },
      () => new Date().toISOString(),
    );
    const outcome = await handler(input, callContext);
    if (outcome.outcome_type === 'STABLE_ERROR') {
      throw new StableRuntimeError(
        outcome.stable_error.code,
        outcome.stable_error.message,
      );
    }
    return outcome.runtime_result;
  };
}

// ---------------------------------------------------------------------------
// 三、V0186 槽位构造
// ---------------------------------------------------------------------------

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
  return `{${entries.join(',')}}`;
}

/**
 * 本地绑定一致性哈希：对代码侧固化的 V0104 Operation 清单做 canonical SHA-256。
 * 非 owner 签发的契约认证（模块头注释已声明边界）。
 */
function localContractContentHash(): string {
  const inventory = MEMBER_CAPABILITY_METADATA.operations.map((op) => ({
    operation_id: op.operation_id,
    operation_ref: op.operation_ref,
    interface_ref: op.interface_ref,
    surface: op.surface,
    kind: op.kind,
    public: op.public,
    internal: op.internal,
    stable_error_codes: [...op.stable_error_codes].sort(),
  }));
  const digest = createHash('sha256')
    .update(
      canonicalJson({
        capability_ref: MEMBER_CAPABILITY_METADATA.capability_ref,
        capability_contract_ref: MEMBER_CAPABILITY_METADATA.capability_contract_ref,
        operations: inventory,
      }),
    )
    .digest('hex');
  return `sha256:${digest}`;
}

const CAPABILITY_CONTRACT_CONTENT_HASH = localContractContentHash();

function generalSlotsFor(route: MemberBusinessRoute): P1CapabilityGeneralSlotProjection {
  // CALL/CALL_INVOKE 的框架锚点方法固定为 invoke_business_operation；
  // metadata.method_ref=operation_id 只是契约候选投影，不能作为执行绑定。
  return project_p1_capability_general_slots({
    capability_ref: MEMBER_CAPABILITY_METADATA.capability_ref,
    capability_id: MEMBER_CAPABILITY_METADATA.capability_id,
    capability_version: MEMBER_CAPABILITY_METADATA.capability_version,
    capability_contract_ref: MEMBER_CAPABILITY_METADATA.capability_contract_ref,
    capability_contract_content_hash: CAPABILITY_CONTRACT_CONTENT_HASH,
    stage_contract_ref: P1_CONTRACT_REF,
    runtime_contract_ref: P0_CONTRACT_REF,
    operation_id: route.operation_id,
    operation_ref: route.operation_ref,
    interface_ref: route.interface_ref,
    surface: 'CALL',
    kind: 'CALL_INVOKE',
    method_ref: 'invoke_business_operation',
  });
}

function staticSlotsFor(operationRef: string): P1StaticRuntimeSlotProjection {
  return Object.freeze({
    manifest: {
      slot_ref: P1_RUNTIME_SLOT_REFS.manifest,
      value: { capability_ref: MEMBER_CAPABILITY_METADATA.capability_ref },
    },
    // 本地演示用不透明 qreg/qconfig 投影：V0186 只定义槽位权威/阶段，
    // 未授权骨架发明嵌套 schema。
    qreg: {
      slot_ref: P1_RUNTIME_SLOT_REFS.qreg,
      value: { capability_contract_ref: MEMBER_CAPABILITY_METADATA.capability_contract_ref },
    },
    qconfig: { slot_ref: P1_RUNTIME_SLOT_REFS.qconfig, value: {} },
    operation_contract: {
      slot_ref: P1_RUNTIME_SLOT_REFS.operation_contract,
      value: operationRef,
    },
    policy_refs: { slot_ref: P1_RUNTIME_SLOT_REFS.policy_refs, value: [] },
    hook_binding_refs: { slot_ref: P1_RUNTIME_SLOT_REFS.hook_binding_refs, value: [] },
  });
}

/**
 * P1 框架授权闸门：会员业务授权证据作为不透明回执携带，确认
 * "authorization completed before operation attempt"（V0186）。
 * 是否允许某次调用的【业务判定】仍在会员 handler 内完成。
 */
const memberFrameworkAuthorizationGate: BusinessOperationAuthorization = async (
  _input,
  runtimeContext,
  policyRefs,
) => ({
  authorization_receipt: Object.freeze({
    gate: 'member_local_p1_authorization_gate',
    operation_ref: runtimeContext.operation_ref,
    trace_id: runtimeContext.trace_id,
    request_id: runtimeContext.request_id,
    completed_before_operation: true,
    policy_refs: [...policyRefs],
    // 调用方携带的会员授权证据（如有）；opaque owner evidence，非本闸门合成的授权规则
    member_authorization_evidence:
      readCarriedMemberContext(runtimeContext).authorization ?? null,
  }),
});

// ---------------------------------------------------------------------------
// 四、注册
// ---------------------------------------------------------------------------

/**
 * 各 Operation 的具体 Request/Response 类型不同，注册表只接受 unknown 边界；
 * 显式 any 仅存在于这个装配映射的边界处，业务 handler 内部仍保持各自精确类型。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMemberHandlerFactory = (deps: MemberRuntimeDeps) => OperationHandler<any, any>;

const HANDLER_FACTORIES: Readonly<Record<OperationId, AnyMemberHandlerFactory>> =
  Object.freeze({
    create_member: createCreateMemberHandler,
    resolve_member: createResolveMemberHandler,
    update_member_profile: createUpdateMemberProfileHandler,
    update_member_status: createUpdateMemberStatusHandler,
    create_membership: createCreateMembershipHandler,
    update_membership_plan: createUpdateMembershipPlanHandler,
    lookup_membership: createLookupMembershipHandler,
    evaluate_membership_eligibility: createEvaluateMembershipEligibilityHandler,
    resolve_membership: createResolveMembershipHandler,
  });

let registrationCompleted = false;

/**
 * 用同一组 MemberRuntimeDeps 实例化 9 个会员 handler 并注册进 P1 业务注册表。
 * 进程内幂等：重复调用直接返回同一路由表（注册表 Map 为模块级单例）。
 */
export function registerMemberBusinessOperations(
  deps: MemberRuntimeDeps,
): Readonly<Record<OperationId, MemberBusinessRoute>> {
  if (registrationCompleted) return MEMBER_BUSINESS_ROUTES;
  for (const operationId of Object.keys(MEMBER_BUSINESS_ROUTES) as OperationId[]) {
    const route = MEMBER_BUSINESS_ROUTES[operationId];
    const memberHandler = HANDLER_FACTORIES[operationId](deps);
    const adaptedHandler = adaptMemberHandler(memberHandler);
    if (route.internal) {
      // 仅内部 Operation：不发明具体 Interface 身份
      register_internal_business_operation(
        {
          capability_contract_ref: MEMBER_CAPABILITY_METADATA.capability_contract_ref,
          capability_contract_content_hash: CAPABILITY_CONTRACT_CONTENT_HASH,
          capability_id: MEMBER_CAPABILITY_METADATA.capability_id,
          operation_id: route.operation_id,
          operation_ref: route.operation_ref,
        },
        adaptedHandler,
        memberFrameworkAuthorizationGate,
      );
    } else {
      register_business_operation(
        generalSlotsFor(route),
        adaptedHandler,
        staticSlotsFor(route.operation_ref),
        memberFrameworkAuthorizationGate,
      );
    }
  }
  registrationCompleted = true;
  return MEMBER_BUSINESS_ROUTES;
}

// ---------------------------------------------------------------------------
// 五、执行侧助手（供 web/ 等调用方构造注册表调用信封）
// ---------------------------------------------------------------------------

export interface MemberCorrelationIds {
  readonly trace_id: string;
  readonly request_id: string;
  readonly invocation_id: string;
  readonly binding_set_ref: string;
}

/**
 * 构造 P0 RuntimeContext：六必填字段 + 经 attributes 透传的会员业务上下文。
 * 返回冻结对象，P0 仍会独立复核并再冻结一份调用视图。
 */
export function buildMemberRuntimeContext(
  route: MemberBusinessRoute,
  memberContext: Partial<CallContext>,
  ids: MemberCorrelationIds,
): RuntimeContext {
  const carried: Record<string, unknown> = {};
  if (memberContext.commit_time !== undefined) {
    carried.commit_time = memberContext.commit_time;
  }
  if (memberContext.authorization !== undefined) {
    carried.authorization = memberContext.authorization;
  }
  if (memberContext.internal_invocation !== undefined) {
    carried.internal_invocation = memberContext.internal_invocation;
  }
  return Object.freeze({
    stage_contract_ref: P1_CONTRACT_REF,
    operation_ref: route.operation_ref,
    trace_id: ids.trace_id,
    request_id: ids.request_id,
    invocation_id: ids.invocation_id,
    binding_set_ref: ids.binding_set_ref,
    attributes: Object.freeze({ [MEMBER_CALL_CONTEXT_ATTRIBUTE]: Object.freeze(carried) }),
  });
}

/** 构造对外 CALL 的精确路由 Path（route_key 必须字节级等于 operation_ref） */
export function memberInvokePath(
  route: MemberBusinessRoute,
  traceId: string,
  requestId: string,
): BusinessOperationInvokePath {
  return Object.freeze({
    route_key: route.operation_ref,
    capability_id: MEMBER_CAPABILITY_ID,
    operation_id: route.operation_id,
    trace_id: traceId,
    request_id: requestId,
  });
}
