import { testAuthorizer } from '../test_authorizer';
import { describe, expect, it } from 'vitest';
import { createResolveMemberHandler } from '../../../../src/p1/member/resolve_member/handler';
import { createCreateMemberHandler } from '../../../../src/p1/member/create_member/handler';
import { createUpdateMemberStatusHandler } from '../../../../src/p1/member/update_member_status/handler';
import {
  InMemoryMemberRepository,
  staticMembershipPlanProvider,
} from '../../../../src/p1/export/member/entry';
import type {
  CallContext,
  MemberRuntimeDeps,
} from '../../../../src/p1/export/member/entry';

const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-03-01T00:00:00.000Z';

function deps(): MemberRuntimeDeps {
  return {
    repository: new InMemoryMemberRepository(),
    planProvider: staticMembershipPlanProvider([]),
    authorizer: testAuthorizer,
    clock: () => T1,
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

async function seedMember(d: MemberRuntimeDeps): Promise<string> {
  const outcome = await createCreateMemberHandler(d)(
    {
      member_identity: { identity_namespace: 'wechat', identity_value: 'openid-1' },
      registration_profile: {
        display_name: '张三',
        contact_email: 'zhangsan@example.com',
      },
    },
    ctx(),
  );
  if (outcome.outcome_type !== 'SUCCESS') throw new Error('seed failed');
  return outcome.runtime_result.member_ref;
}

describe('resolve_member handler', () => {
  it('返回会员真实身份与状态，默认不披露 contact_email', async () => {
    const d = deps();
    const ref = await seedMember(d);
    const outcome = await createResolveMemberHandler(d)({ member_ref: ref }, ctx());
    expect(outcome.outcome_type).toBe('SUCCESS');
    if (outcome.outcome_type !== 'SUCCESS') throw new Error('expected success');
    expect(outcome.runtime_result.member).toEqual({
      member_ref: ref,
      member_status: 'active',
      member_profile: { display_name: '张三' },
    });
    expect(JSON.stringify(outcome.runtime_result)).not.toContain('contact_email');
  });

  it('会员终止后仍按真实状态返回', async () => {
    const d = deps();
    const ref = await seedMember(d);
    const terminate = await createUpdateMemberStatusHandler(d)(
      { member_ref: ref, target_status: 'terminated' },
      ctx({ commit_time: T1 }),
    );
    expect(terminate.outcome_type).toBe('SUCCESS');
    const outcome = await createResolveMemberHandler(d)({ member_ref: ref }, ctx());
    expect(outcome).toMatchObject({
      outcome_type: 'SUCCESS',
      runtime_result: {
        member: { member_ref: ref, member_status: 'terminated' },
      },
    });
  });

  it('未授权 -> OPERATION_NOT_AUTHORIZED', async () => {
    const d = deps();
    const ref = await seedMember(d);
    const outcome = await createResolveMemberHandler(d)(
      { member_ref: ref },
      ctx({ authorization: undefined }),
    );
    expect(outcome).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'OPERATION_NOT_AUTHORIZED' },
    });
  });

  it('member_ref 为空 -> MEMBER_IDENTITY_MISSING', async () => {
    const outcome = await createResolveMemberHandler(deps())(
      { member_ref: '' },
      ctx(),
    );
    expect(outcome).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'MEMBER_IDENTITY_MISSING' },
    });
  });

  it('会员不存在 -> MEMBER_NOT_FOUND', async () => {
    const outcome = await createResolveMemberHandler(deps())(
      { member_ref: 'mem_unknown' },
      ctx(),
    );
    expect(outcome).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'MEMBER_NOT_FOUND' },
    });
  });

  it('只读：查询不改变任何会员事实', async () => {
    const d = deps();
    const ref = await seedMember(d);
    const before = await d.repository.getMemberByRef(ref);
    await createResolveMemberHandler(d)({ member_ref: ref }, ctx());
    await createResolveMemberHandler(d)({ member_ref: ref }, ctx());
    const after = await d.repository.getMemberByRef(ref);
    expect(after).toEqual(before);
  });
});
