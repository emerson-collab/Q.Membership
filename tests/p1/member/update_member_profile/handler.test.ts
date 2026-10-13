import { testAuthorizer } from '../test_authorizer';
import { describe, expect, it } from 'vitest';
import { createUpdateMemberProfileHandler } from '../../../../src/p1/member/update_member_profile/handler';
import { createCreateMemberHandler } from '../../../../src/p1/member/create_member/handler';
import { createUpdateMemberStatusHandler } from '../../../../src/p1/member/update_member_status/handler';
import {
  InMemoryMemberRepository } from '../../../../src/p1/export/member/entry';
import { staticMembershipPlanProvider } from '../../../../src/p1/export/member/client';
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
    commit_time: T1,
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
      member_identity: { identity_namespace: 'ns', identity_value: 'v-1' },
      registration_profile: { display_name: '原名' },
    },
    { ...ctx(), commit_time: T0 },
  );
  if (outcome.outcome_type !== 'SUCCESS') throw new Error('seed failed');
  return outcome.runtime_result.member_ref;
}

describe('update_member_profile handler', () => {
  const handlerFactory = createUpdateMemberProfileHandler;

  it('合法修改展示名称与邮箱：applied', async () => {
    const d = deps();
    const ref = await seedMember(d);
    const outcome = await handlerFactory(d)(
      {
        member_ref: ref,
        profile_changes: {
          display_name: '新名',
          contact_email: 'new@example.com',
        },
      },
      ctx(),
    );
    expect(outcome.outcome_type).toBe('SUCCESS');
    if (outcome.outcome_type !== 'SUCCESS') throw new Error('expected success');
    expect(outcome.runtime_result).toMatchObject({
      member_ref: ref,
      update_result: 'applied',
      member_profile: { display_name: '新名' },
    });
    const stored = await d.repository.getMemberByRef(ref);
    expect(stored?.contact_email).toBe('new@example.com');
  });

  it('重复提交相同内容：no_change，不产生额外版本', async () => {
    const d = deps();
    const ref = await seedMember(d);
    const first = await handlerFactory(d)(
      { member_ref: ref, profile_changes: { display_name: '名字' } },
      ctx(),
    );
    expect(first).toMatchObject({
      outcome_type: 'SUCCESS',
      runtime_result: { update_result: 'applied' },
    });
    const versionAfterFirst = (await d.repository.getMemberByRef(ref))?.version;
    const second = await handlerFactory(d)(
      { member_ref: ref, profile_changes: { display_name: '名字' } },
      ctx(),
    );
    expect(second).toMatchObject({
      outcome_type: 'SUCCESS',
      runtime_result: { update_result: 'no_change' },
    });
    expect((await d.repository.getMemberByRef(ref))?.version).toBe(
      versionAfterFirst,
    );
  });

  it('试图修改 member_ref -> MEMBER_PROFILE_FIELD_NOT_MODIFIABLE', async () => {
    const d = deps();
    const ref = await seedMember(d);
    const outcome = await handlerFactory(d)(
      {
        member_ref: ref,
        profile_changes: {
          display_name: 'x',
          // 模拟越权字段（契约 schema 禁止）
          ...({ member_ref: 'mem_hacked' } as object),
        },
      },
      ctx(),
    );
    expect(outcome).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'MEMBER_PROFILE_FIELD_NOT_MODIFIABLE' },
    });
  });

  it('未声明的扩展字段同样拒绝', async () => {
    const d = deps();
    const ref = await seedMember(d);
    const outcome = await handlerFactory(d)(
      {
        member_ref: ref,
        profile_changes: {
          ...({ is_vip: true } as object),
        },
      },
      ctx(),
    );
    expect(outcome).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'MEMBER_PROFILE_FIELD_NOT_MODIFIABLE' },
    });
  });

  it('非法邮箱 -> MEMBERSHIP_REQUIRED_INPUT_MISSING', async () => {
    const d = deps();
    const ref = await seedMember(d);
    const outcome = await handlerFactory(d)(
      { member_ref: ref, profile_changes: { contact_email: 'bad-email' } },
      ctx(),
    );
    expect(outcome).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'MEMBERSHIP_REQUIRED_INPUT_MISSING' },
    });
  });

  it('会员不存在 -> MEMBER_NOT_FOUND；未授权 -> OPERATION_NOT_AUTHORIZED', async () => {
    const d = deps();
    const notFound = await handlerFactory(d)(
      { member_ref: 'mem_x', profile_changes: { display_name: 'x' } },
      ctx(),
    );
    expect(notFound).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'MEMBER_NOT_FOUND' },
    });
    const ref = await seedMember(d);
    const denied = await handlerFactory(d)(
      { member_ref: ref, profile_changes: { display_name: 'x' } },
      ctx({ authorization: undefined }),
    );
    expect(denied).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'OPERATION_NOT_AUTHORIZED' },
    });
  });

  it('已终止会员仍允许合法档案修正（本版不增设禁止条件）', async () => {
    const d = deps();
    const ref = await seedMember(d);
    await createUpdateMemberStatusHandler(d)(
      { member_ref: ref, target_status: 'terminated' },
      ctx(),
    );
    const outcome = await handlerFactory(d)(
      { member_ref: ref, profile_changes: { display_name: '终止后修正名' } },
      ctx(),
    );
    expect(outcome).toMatchObject({
      outcome_type: 'SUCCESS',
      runtime_result: {
        update_result: 'applied',
        member_profile: { display_name: '终止后修正名' },
      },
    });
  });

  it('乐观锁冲突 -> CONCURRENT_MODIFICATION_CONFLICT', async () => {
    const d = deps();
    const ref = await seedMember(d);
    const stored = await d.repository.getMemberByRef(ref);
    expect(stored).not.toBeNull();
    const first = await d.repository.updateMemberProfileAtomic({
      member_ref: ref,
      expected_version: stored!.version,
      display_name: '第一次',
    });
    expect(first.ok).toBe(true);
    const stale = await d.repository.updateMemberProfileAtomic({
      member_ref: ref,
      expected_version: stored!.version,
      display_name: '第二次旧版本',
    });
    expect(stale).toEqual({ ok: false, reason: 'CONCURRENT' });
  });
});
