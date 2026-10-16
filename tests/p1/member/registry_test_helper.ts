/**
 * 会员业务测试统一走 P1 业务注册表：注册 → 调用 → 反注册。
 *
 * 所有 handler/端到端测试不再直接调用 handler 工厂或 MemberCapabilityClient，
 * 而是通过 registerMemberBusinessOperations 注册 + invoke_business_operation /
 * invoke_internal_call 调用，与生产 web/server.ts 的执行路径一致。
 */
import { randomUUID } from 'node:crypto';
import {
  registerMemberBusinessOperations,
  unregisterMemberBusinessOperations,
  MEMBER_BUSINESS_ROUTES,
  buildMemberRuntimeContext,
  memberInvokePath,
} from '../../../src/p1/member/business_registration.ts';
import {
  invoke_business_operation,
  invoke_internal_call,
} from '../../../src/p1/business_runtime/business_operation_registry.ts';
import type {
  BusinessInternalCallOutcome,
  BusinessOperationOutcome,
} from '../../../src/p1/business_runtime/business_operation_registry.ts';
import type {
  CallContext,
  CallOutcome,
  MemberRuntimeDeps,
  OperationId,
} from '../../../src/p1/export/member/types.ts';

/**
 * 用指定 deps 注册全部 9 个会员 Operation。
 * 返回一个可调用的 invoke 与反注册方法。
 */
export function registerMemberForTest(deps: MemberRuntimeDeps): MemberTestRunner {
  registerMemberBusinessOperations(deps);
  return {
    invoke: invokeMemberOperation,
    unregister: unregisterMemberBusinessOperations,
  };
}

export interface MemberTestRunner {
  invoke: <T = unknown>(
    operationId: OperationId,
    request: unknown,
    memberContext?: Partial<CallContext>,
  ) => Promise<CallOutcome<T>>;
  unregister: () => void;
}

/**
 * 经 P1 业务注册表执行一次会员 Operation，返回 CallOutcome 信封（与原 handler
 * 直接调用的返回结构完全一致，便于复用既有断言）。
 *
 * - 对外 8 op：invoke_business_operation
 * - 内部 op09 resolve_membership：invoke_internal_call（call_path 起点，
 *   internal_invocation 用途证据经 RuntimeContext.attributes 透传）
 * - request_id / trace_id 优先取调用方在 CallContext 中传入的值，否则自动生成，
 *   这样既保留 P0 权威关联 ID，又能让测试对 request_id 的断言继续成立。
 */
export async function invokeMemberOperation<T = any>(
  operationId: OperationId,
  request: unknown,
  memberContext: Partial<CallContext> = {},
): Promise<CallOutcome<T>> {
  const route = MEMBER_BUSINESS_ROUTES[operationId];
  const trace_id =
    typeof memberContext.trace_id === 'string' && memberContext.trace_id.length > 0
      ? memberContext.trace_id
      : `trc_test_${randomUUID()}`;
  const request_id =
    typeof memberContext.request_id === 'string' && memberContext.request_id.length > 0
      ? memberContext.request_id
      : `req_test_${randomUUID()}`;
  const ids = {
    trace_id,
    request_id,
    invocation_id: `inv_${randomUUID()}`,
    binding_set_ref: `bs_test_${trace_id}`,
  };
  const runtimeContext = buildMemberRuntimeContext(route, memberContext, ids);

  if (route.internal) {
    const outcome: BusinessInternalCallOutcome = await invoke_internal_call({
      local_route_key: route.operation_ref,
      input: request,
      runtime_context: runtimeContext,
      call_path: [],
      call_depth: 0,
      trace_id,
      parent_request_id: request_id,
    });
    if (outcome.outcome_type === 'response') {
      return {
        outcome_type: 'SUCCESS',
        runtime_result: outcome.runtime_result as T,
        trace_id,
        request_id: outcome.child_request_id,
      } as CallOutcome<T>;
    }
    return {
      outcome_type: 'STABLE_ERROR',
      stable_error: outcome.stable_error,
      trace_id,
      request_id: outcome.child_request_id,
    } as CallOutcome<T>;
  }

  const outcome: BusinessOperationOutcome = await invoke_business_operation(
    memberInvokePath(route, trace_id, request_id),
    request,
    runtimeContext,
  );
  if (outcome.outcome_type === 'response') {
    return {
      outcome_type: 'SUCCESS',
      runtime_result: outcome.runtime_result as T,
      trace_id,
      request_id,
    } as CallOutcome<T>;
  }
  return {
    outcome_type: 'STABLE_ERROR',
    stable_error: outcome.stable_error,
    trace_id,
    request_id,
  } as CallOutcome<T>;
}
