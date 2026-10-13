import { testAuthorizer } from '../test_authorizer';
import { describe, expect, it } from 'vitest';
import { createUpdateMemberStatusHandler } from '../../../../src/p1/member/update_member_status/handler';
import { createCreateMemberHandler } from '../../../../src/p1/member/create_member/handler';
import {
  InMemoryMemberRepository } from '../../../../src/p1/export/member/entry';
import { staticMembershipPlanProvider } from '../../../../src/p1/export/member/client';
import type {
  CallContext,
  MemberRuntimeDeps,
  UpdateMemberStatusRequest,
} from '../../../../src/p1/export/member/entry';

const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-03-01T00:00:00.000Z';

function deps() {
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
      registration_profile: { display_name: '张三' },
    },
    { ...ctx(), commit_time: T0 },
  );
  if (outcome.outcome_type !== 'SUCCESS') throw new Error('seed failed');
  return outcome.runtime_result.member_ref;
}

describe('update_member_status handler', () => {
  const handlerFactory = createUpdateMemberStatusHandler;

  it('唯一允许迁移 active -> terminated 成功，记录真实时点', async () => {
    const d = deps();
    const ref = await seedMember(d);
    const outcome = await handlerFactory(d)(
      { member_ref: ref, target_status: 'terminated', reason: '用户注销' },
      ctx(),
    );
    expect(outcome).toMatchObject({
      outcome_type: 'SUCCESS',
      runtime_result: { member_ref: ref, member_status: 'terminated' },
    });
    const stored = await d.repository.getMemberByRef(ref);
    expect(stored?.terminated_at).toBe(T1);
    const events = d.repository.listMemberStatusEvents(ref);
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      from_status: 'active',
      to_status: 'terminated',
      occurred_at: T1,
      reason: '用户注销',
    });
  });

  it('重复终止 -> INVALID_STATE_TRANSITION，不产生第二次迁移事件', async () => {
    const d = deps();
    const ref = await seedMember(d);
    await handlerFactory(d)(
      { member_ref: ref, target_status: 'terminated' },
      ctx(),
    );
    const repeated = await handlerFactory(d)(
      { member_ref: ref, target_status: 'terminated' },
      ctx({ commit_time: '2026-04-01T00:00:00.000Z' }),
    );
    expect(repeated).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'INVALID_STATE_TRANSITION' },
    });
    const events = d.repository.listMemberStatusEvents(ref);
    expect(events.filter((e) => e.to_status === 'terminated')).toHaveLength(1);
  });

  it('未定义目标状态 -> INVALID_STATE_TRANSITION（FAIL_CLOSED）', async () => {
    const d = deps();
    const ref = await seedMember(d);
    const outcome = await handlerFactory(d)(
      { member_ref: ref, ...({ target_status: 'paused' } as object) } as UpdateMemberStatusRequest,
      ctx(),
    );
    expect(outcome).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'INVALID_STATE_TRANSITION' },
    });
  });

  it('会员不存在 -> MEMBER_NOT_FOUND', async () => {
    const outcome = await handlerFactory(deps())(
      { member_ref: 'mem_none', target_status: 'terminated' },
      ctx(),
    );
    expect(outcome).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'MEMBER_NOT_FOUND' },
    });
  });

  it('member_ref 为空 -> MEMBER_IDENTITY_MISSING；target_status 缺失 -> 必填错误', async () => {
    const d = deps();
    const ref = await seedMember(d);
    const missingIdentity = await handlerFactory(d)(
      { member_ref: '', target_status: 'terminated' },
      ctx(),
    );
    expect(missingIdentity).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'MEMBER_IDENTITY_MISSING' },
    });
    const missingTarget = await handlerFactory(d)(
      { member_ref: ref, ...({ target_status: undefined } as object) } as UpdateMemberStatusRequest,
      ctx(),
    );
    expect(missingTarget).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'MEMBERSHIP_REQUIRED_INPUT_MISSING' },
    });
  });

  it('未授权 -> OPERATION_NOT_AUTHORIZED，状态不变', async () => {
    const d = deps();
    const ref = await seedMember(d);
    const outcome = await handlerFactory(d)(
      { member_ref: ref, target_status: 'terminated' },
      ctx({ authorization: undefined }),
    );
    expect(outcome).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'OPERATION_NOT_AUTHORIZED' },
    });
    expect((await d.repository.getMemberByRef(ref))?.member_status).toBe('active');
  });

  it('B-07：reason 空串/非字符串拒绝且不终止；缺省与非空字符串成功', async () => {
    // reason: '' -> MEMBERSHIP_REQUIRED_INPUT_MISSING（minLength:1）
    let d = deps();
    let ref = await seedMember(d);
    const emptyReason = await handlerFactory(d)(
      { member_ref: ref, target_status: 'terminated', reason: '' },
      ctx({ request_id: 'req-empty' }),
    );
    expect(emptyReason).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'MEMBERSHIP_REQUIRED_INPUT_MISSING' },
    });
    expect((await d.repository.getMemberByRef(ref))?.member_status).toBe('active');

    // reason 非字符串 -> 同码拒绝
    const nonStringReason = await handlerFactory(d)(
      { member_ref: ref, target_status: 'terminated', reason: 123 } as object as UpdateMemberStatusRequest,
      ctx({ request_id: 'req-number' }),
    );
    expect(nonStringReason).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'MEMBERSHIP_REQUIRED_INPUT_MISSING' },
    });
    expect((await d.repository.getMemberByRef(ref))?.member_status).toBe('active');

    // reason 缺省 -> 成功，事件 reason=null
    const withoutReason = await handlerFactory(d)(
      { member_ref: ref, target_status: 'terminated' },
      ctx({ request_id: 'req-omit' }),
    );
    expect(withoutReason).toMatchObject({
      outcome_type: 'SUCCESS',
      runtime_result: { member_status: 'terminated' },
    });

    // reason 非空字符串 -> 成功并落事件
    d = deps();
    ref = await seedMember(d);
    const withReason = await handlerFactory(d)(
      { member_ref: ref, target_status: 'terminated', reason: 'x' },
      ctx({ request_id: 'req-x' }),
    );
    expect(withReason).toMatchObject({
      outcome_type: 'SUCCESS',
      runtime_result: { member_status: 'terminated' },
    });
    expect(
      d.repository.listMemberStatusEvents(ref).find((e) => e.to_status === 'terminated'),
    ).toMatchObject({ reason: 'x' });
  });

  it('B-06：顶层未知字段拒绝且无副作用', async () => {
    const d = deps();
    const ref = await seedMember(d);
    const outcome = await handlerFactory(d)(
      { member_ref: ref, target_status: 'terminated', unexpected: 1 } as object as UpdateMemberStatusRequest,
      ctx(),
    );
    expect(outcome).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'MEMBERSHIP_REQUIRED_INPUT_MISSING' },
    });
    expect((await d.repository.getMemberByRef(ref))?.member_status).toBe('active');
  });

  it('终止会员不删除身份与历史，仍可按 ref 读取', async () => {
    const d = deps();
    const ref = await seedMember(d);
    await handlerFactory(d)(
      { member_ref: ref, target_status: 'terminated' },
      ctx(),
    );
    const stored = await d.repository.getMemberByRef(ref);
    expect(stored).not.toBeNull();
    expect(stored?.member_ref).toBe(ref);
  });
});
