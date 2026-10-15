import { testAuthorizer } from '../test_authorizer';
import { describe, expect, it } from 'vitest';
import { createCreateMemberHandler, registerCreateMemberWithP1 } from '../../../../src/p1/member/create_member/handler';
import { StableRuntimeError, P0_CONTRACT_REF } from '#q/p0/runtime_contract';
import type { RuntimeContext } from '#q/p0/runtime_contract';
import { invoke_business_operation } from '../../../../src/p1/business_runtime/business_operation_registry.ts';
import type { BusinessOperationAuthorization, P1StaticRuntimeSlotProjection } from '../../../../src/p1/business_runtime/business_operation_registry.ts';
import { P1_CONTRACT_REF, P1_RUNTIME_SLOT_REFS, project_p1_capability_general_slots } from '../../../../src/p1/business_runtime/stage_extension_contract.ts';
import {
  InMemoryMemberRepository } from '../../../../src/p1/export/member/client';
import { staticMembershipPlanProvider } from '../../../../src/p1/export/member/client';
import type {
  CallContext,
  CreateMemberRequest,
  MemberRuntimeDeps,
} from '../../../../src/p1/export/member/entry';

const T0 = '2026-01-01T00:00:00.000Z';

function deps(): MemberRuntimeDeps {
  return {
    repository: new InMemoryMemberRepository(),
    planProvider: staticMembershipPlanProvider([]),
    authorizer: testAuthorizer,
    clock: () => T0,
  };
}

type CtxOverrides = { [K in keyof CallContext]?: CallContext[K] | undefined };
function ctx(overrides: CtxOverrides = {}): CallContext {
  return {
    request_id: 'req-1',
    trace_id: 'trc-1',
    commit_time: T0,
    authorization: {
      actor_ref: 'actor-1',
      issued_by: 'trusted-ingress',
      allowed_operations: ['*'],
    },
    ...overrides,
  } as CallContext;
}

const validRequest: CreateMemberRequest = {
  member_identity: { identity_namespace: 'wechat', identity_value: 'openid-001' },
  registration_profile: { display_name: '张三' },
};

describe('create_member handler', () => {
  it('成功创建会员：生成稳定标识，初始 active', async () => {
    const outcome = await createCreateMemberHandler(deps())(validRequest, ctx());
    expect(outcome.outcome_type).toBe('SUCCESS');
    if (outcome.outcome_type !== 'SUCCESS') throw new Error('expected success');
    expect(outcome.runtime_result.member_ref).toMatch(/^mem_/);
    expect(outcome.runtime_result.member_status).toBe('active');
    expect(outcome.request_id).toBe('req-1');
    expect(outcome.trace_id).toBe('trc-1');
  });

  it('无授权证据默认拒绝，且不留下会员事实', async () => {
    const d = deps();
    const outcome = await createCreateMemberHandler(d)(
      validRequest,
      ctx({ authorization: undefined }),
    );
    expect(outcome.outcome_type).toBe('STABLE_ERROR');
    if (outcome.outcome_type !== 'STABLE_ERROR') throw new Error('expected error');
    expect(outcome.stable_error.code).toBe('OPERATION_NOT_AUTHORIZED');
    await expect(
      d.repository.getMemberByIdentity('wechat', 'openid-001'),
    ).resolves.toBeNull();
  });

  it('可信入口授权未包含本操作时拒绝', async () => {
    const outcome = await createCreateMemberHandler(deps())(
      validRequest,
      ctx({
        authorization: {
          actor_ref: 'actor-1',
          issued_by: 'trusted-ingress',
          allowed_operations: ['resolve_member'],
        },
      }),
    );
    expect(outcome).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'OPERATION_NOT_AUTHORIZED' },
    });
  });

  it('身份命名空间或取值为空 -> MEMBER_IDENTITY_MISSING', async () => {
    const handler = createCreateMemberHandler(deps());
    const o1 = await handler(
      {
        member_identity: { identity_namespace: '', identity_value: 'x' },
        registration_profile: { display_name: 'x' },
      },
      ctx(),
    );
    expect(o1).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'MEMBER_IDENTITY_MISSING' },
    });
    const o2 = await handler(
      {
        member_identity: { identity_namespace: 'ns', identity_value: '' },
        registration_profile: { display_name: 'x' },
      },
      ctx(),
    );
    expect(o2).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'MEMBER_IDENTITY_MISSING' },
    });
  });

  it('display_name 缺失/为空 -> MEMBERSHIP_REQUIRED_INPUT_MISSING', async () => {
    const outcome = await createCreateMemberHandler(deps())(
      {
        member_identity: { identity_namespace: 'ns', identity_value: 'v' },
        registration_profile: { display_name: '' },
      },
      ctx(),
    );
    expect(outcome).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'MEMBERSHIP_REQUIRED_INPUT_MISSING' },
    });
  });

  it('非法邮箱格式 -> MEMBERSHIP_REQUIRED_INPUT_MISSING', async () => {
    const outcome = await createCreateMemberHandler(deps())(
      {
        member_identity: { identity_namespace: 'ns', identity_value: 'v' },
        registration_profile: { display_name: '张三', contact_email: 'not-an-email' },
      },
      ctx(),
    );
    expect(outcome).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'MEMBERSHIP_REQUIRED_INPUT_MISSING' },
    });
  });

  it('精确键判重：相同原始字节组合重复注册被拒绝', async () => {
    const d = deps();
    const handler = createCreateMemberHandler(d);
    const first = await handler(validRequest, ctx());
    expect(first.outcome_type).toBe('SUCCESS');
    const second = await handler(validRequest, ctx({ request_id: 'req-2' }));
    expect(second).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'MEMBER_DUPLICATE_REGISTRATION' },
    });
  });

  it('不做大小写/空白归一化：差异即不同会员', async () => {
    const d = deps();
    const handler = createCreateMemberHandler(d);
    await handler(
      {
        member_identity: { identity_namespace: 'ns', identity_value: 'User01' },
        registration_profile: { display_name: 'a' },
      },
      ctx(),
    );
    const different = await handler(
      {
        member_identity: { identity_namespace: 'ns', identity_value: 'user01' },
        registration_profile: { display_name: 'b' },
      },
      ctx(),
    );
    expect(different.outcome_type).toBe('SUCCESS');
  });

  it('并发提交同一身份：恰好一个成功，另一个冲突拒绝', async () => {
    const d = deps();
    const handler = createCreateMemberHandler(d);
    const [a, b] = await Promise.all([
      handler(validRequest, ctx({ request_id: 'ra' })),
      handler(validRequest, ctx({ request_id: 'rb' })),
    ]);
    const codes = [a, b].map((o) =>
      o.outcome_type === 'SUCCESS' ? 'SUCCESS' : o.stable_error.code,
    );
    expect(codes.filter((c) => c === 'SUCCESS')).toHaveLength(1);
    expect(codes).toContain('MEMBER_DUPLICATE_REGISTRATION');
  });
});

/**
 * Real P1 Registry + P0 Runtime source, not a simulated registry.
 * All GENERAL hash/QReg/QConfig/authorization values below are TEST-ONLY.
 */
describe('create_member actual P1 -> P0 registration', () => {
  const contractRef = 'Q.MEMBERSHIP.CONTRACT.CAPABILITY.MEMBER@V0104';
  const operationRef = `${contractRef}#/operations/create_member`;
  const general = project_p1_capability_general_slots({
    capability_ref: 'Q.MEMBERSHIP.CAPABILITY.MEMBER@V0104',
    capability_id: 'member',
    capability_version: 'V0104',
    capability_contract_ref: contractRef,
    capability_contract_content_hash: `sha256:${'a'.repeat(64)}`, // test fixture, never production
    stage_contract_ref: P1_CONTRACT_REF,
    runtime_contract_ref: P0_CONTRACT_REF,
    operation_id: 'create_member',
    operation_ref: operationRef,
    interface_ref: `${contractRef}#/interfaces/member_creation_invoke`,
    surface: 'CALL',
    kind: 'CALL_INVOKE',
    method_ref: 'create_member',
  });
  const staticSlots: P1StaticRuntimeSlotProjection = {
    manifest: { slot_ref: P1_RUNTIME_SLOT_REFS.manifest, value: { test_only: true } },
    qreg: { slot_ref: P1_RUNTIME_SLOT_REFS.qreg, value: { test_only: true } },
    qconfig: { slot_ref: P1_RUNTIME_SLOT_REFS.qconfig, value: { test_only: true } },
    operation_contract: { slot_ref: P1_RUNTIME_SLOT_REFS.operation_contract, value: operationRef },
    policy_refs: { slot_ref: P1_RUNTIME_SLOT_REFS.policy_refs, value: [] },
    hook_binding_refs: { slot_ref: P1_RUNTIME_SLOT_REFS.hook_binding_refs, value: [] },
  };
  function callContext(label: string) {
    const trace_id = `trace:${label}`, request_id = `request:${label}`;
    const runtimeContext: RuntimeContext = {
      stage_contract_ref: P1_CONTRACT_REF, operation_ref: operationRef, trace_id, request_id,
      invocation_id: `invocation:${label}`, binding_set_ref: `binding:${label}`,
    };
    const path = {
      route_key: operationRef, capability_id: 'member',
      operation_id: 'create_member', trace_id, request_id,
    };
    return { runtimeContext, path };
  }
  it('registers handler reference and executes real P1/P0 success, stable errors and deny', async () => {
    const repository = new InMemoryMemberRepository();
    let authorizationCount = 0;
    const authorization: BusinessOperationAuthorization = async (_input, context) => {
      authorizationCount++;
      if (context.request_id === 'request:deny') {
        throw new StableRuntimeError('OPERATION_NOT_AUTHORIZED', 'Test-only deny');
      }
      return { authorization_receipt: {
        test_only: true, operation_ref: context.operation_ref, request_id: context.request_id,
      }};
    };
    const route = registerCreateMemberWithP1({
      general_slots: general, static_runtime_slots: staticSlots,
      repository, authorization, clock: () => T0,
    });
    expect(route.route_key).toBe(operationRef);

    const successPath = callContext('ok');
    const success = await invoke_business_operation(successPath.path, validRequest, successPath.runtimeContext);
    expect(success.outcome_type).toBe('response');
    if (success.outcome_type !== 'response') throw new Error(JSON.stringify(success));
    expect(success.runtime_result).toMatchObject({ member_status: 'active' });
    expect((success.runtime_result as { member_ref: string }).member_ref).toMatch(/^mem_/);
    expect(success.execution_receipt.operation_attempts).toBe(1);
    expect(success.execution_receipt.operation_ref).toBe(operationRef);
    expect(await repository.getMemberByIdentity('wechat', 'openid-001'))
      .toMatchObject({ created_at: T0, member_status: 'active' });

    const duplicatePath = callContext('duplicate');
    const duplicate = await invoke_business_operation(duplicatePath.path, validRequest, duplicatePath.runtimeContext);
    expect(duplicate.outcome_type).toBe('stable_error');
    if (duplicate.outcome_type !== 'stable_error') throw new Error('expected stable error');
    expect(duplicate.stable_error.code).toBe('MEMBER_DUPLICATE_REGISTRATION');
    expect(duplicate.execution_receipt?.operation_attempts).toBe(1);

    const invalidPath = callContext('invalid');
    const invalid = await invoke_business_operation(invalidPath.path, {
      member_identity: { identity_namespace: '', identity_value: 'value' },
      registration_profile: { display_name: 'test' },
    }, invalidPath.runtimeContext);
    expect(invalid.outcome_type).toBe('stable_error');
    if (invalid.outcome_type !== 'stable_error') throw new Error('expected invalid stable error');
    expect(invalid.stable_error.code).toBe('MEMBER_IDENTITY_MISSING');

    const deniedPath = callContext('deny');
    const denied = await invoke_business_operation(deniedPath.path, {
      member_identity: { identity_namespace: 'wechat', identity_value: 'denied-ref' },
      registration_profile: { display_name: 'denied' },
    }, deniedPath.runtimeContext);
    expect(denied.outcome_type).toBe('stable_error');
    if (denied.outcome_type !== 'stable_error') throw new Error('expected denial stable error');
    expect(denied.stable_error.code).toBe('OPERATION_NOT_AUTHORIZED');
    expect(denied.execution_receipt?.operation_attempts).toBe(0);
    expect(await repository.getMemberByIdentity('wechat', 'denied-ref')).toBeNull();

    const wrongPath = callContext('mismatch');
    const previousChecks = authorizationCount;
    const mismatch = await invoke_business_operation({
      ...wrongPath.path, route_key: `${operationRef}:invalid`,
    }, validRequest, wrongPath.runtimeContext);
    expect(mismatch.outcome_type).toBe('stable_error');
    if (mismatch.outcome_type !== 'stable_error') throw new Error('expected mismatch stable error');
    expect(mismatch.stable_error.code).toBe('P1_OPERATION_ROUTE_MISMATCH');
    expect(authorizationCount).toBe(previousChecks);
  });
  it('does not register a different member Interface under create_member', () => {
    expect(() => registerCreateMemberWithP1({
      general_slots: { ...general,
        interface_ref: { ...general.interface_ref,
          value: `${contractRef}#/interfaces/wrong_invoke` },
      },
      static_runtime_slots: staticSlots,
      repository: new InMemoryMemberRepository(),
      authorization: async () => ({ authorization_receipt: { test_only: true } }),
      clock: () => T0,
    })).toThrow('create_member must bind its exact declared Member Operation and Interface');
  });
});
