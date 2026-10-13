import { testAuthorizer } from '../test_authorizer';
import { describe, expect, it } from 'vitest';
import { createCreateMemberHandler } from '../../../../src/p1/member/create_member/handler';
import {
  InMemoryMemberRepository,
  staticMembershipPlanProvider,
} from '../../../../src/p1/export/member/entry';
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
