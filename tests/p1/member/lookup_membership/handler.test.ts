import { testAuthorizer } from '../test_authorizer';
import { describe, expect, it } from 'vitest';
import { createLookupMembershipHandler } from '../../../../src/p1/member/lookup_membership/handler';
import { createCreateMemberHandler } from '../../../../src/p1/member/create_member/handler';
import { createCreateMembershipHandler } from '../../../../src/p1/member/create_membership/handler';
import { createUpdateMembershipPlanHandler } from '../../../../src/p1/member/update_membership_plan/handler';
import {
  InMemoryMemberRepository } from '../../../../src/p1/export/member/entry';
import { staticMembershipPlanProvider } from '../../../../src/p1/export/member/client';
import type {
  CallContext,
  MemberRuntimeDeps,
  MembershipPlanResolutionBinding,
} from '../../../../src/p1/export/member/entry';

const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-02-01T00:00:00.000Z';
const T2 = '2026-03-01T00:00:00.000Z';
const T3 = '2026-04-01T00:00:00.000Z';

const PLAN_A: MembershipPlanResolutionBinding = {
  membership_plan_ref: 'plan-a',
  name: '方案A',
  benefit_refs: [],
  commercial_terms_ref: 'terms-a',
  state: 'active',
};
const PLAN_B: MembershipPlanResolutionBinding = {
  membership_plan_ref: 'plan-b',
  name: '方案B',
  benefit_refs: [],
  commercial_terms_ref: 'terms-b',
  state: 'active',
};

function deps() {
  return {
    repository: new InMemoryMemberRepository(),
    planProvider: staticMembershipPlanProvider([PLAN_A, PLAN_B]),
    authorizer: testAuthorizer,
    clock: () => T3,
  };
}

type CtxOverrides = { [K in keyof CallContext]?: CallContext[K] | undefined };
function ctx(overrides: CtxOverrides = {}): CallContext {
  return {
    request_id: 'req-1',
    trace_id: 'trc-1',
    commit_time: T3,
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

async function buildChain(d: MemberRuntimeDeps): Promise<{ memberRef: string; oldRef: string; newRef: string }> {
  const memberRef = await seedMember(d);
  const created = await createCreateMembershipHandler(d)(
    { member_ref: memberRef, plan_ref: 'plan-a' },
    ctx({ commit_time: T1 }),
  );
  if (created.outcome_type !== 'SUCCESS') throw new Error('relation seed failed');
  const oldRef = created.runtime_result.membership_ref;
  const replaced = await createUpdateMembershipPlanHandler(d)(
    {
      member_ref: memberRef,
      current_membership_ref: oldRef,
      target_plan_ref: 'plan-b',
    },
    ctx({ commit_time: T2 }),
  );
  if (replaced.outcome_type !== 'SUCCESS') throw new Error('replace failed');
  return { memberRef, oldRef, newRef: replaced.runtime_result.membership_ref };
}

describe('lookup_membership handler', () => {
  const handlerFactory = createLookupMembershipHandler;

  it('当前时点返回唯一生效关系（替换后为新关系，区间右开）', async () => {
    const d = deps();
    const { memberRef, newRef } = await buildChain(d);
    const outcome = await handlerFactory(d)(
      { member_ref: memberRef },
      ctx({ commit_time: T3 }),
    );
    expect(outcome.outcome_type).toBe('SUCCESS');
    if (outcome.outcome_type !== 'SUCCESS') throw new Error('expected success');
    expect(outcome.runtime_result.memberships).toHaveLength(1);
    expect(outcome.runtime_result.memberships[0]?.membership_ref).toBe(newRef);
    expect(outcome.runtime_result.memberships[0]?.termination_time).toBeNull();
  });

  it('替换时点 T2：旧关系 [T1,T2) 已失效，新关系 [T2,..) 生效', async () => {
    const d = deps();
    const { memberRef, newRef } = await buildChain(d);
    const atT2 = await handlerFactory(d)(
      { member_ref: memberRef, as_of_time: T2 },
      ctx(),
    );
    if (atT2.outcome_type !== 'SUCCESS') throw new Error('expected success');
    expect(atT2.runtime_result.memberships[0]?.membership_ref).toBe(newRef);
  });

  it('历史时点 T1~T2 之间精确返回旧关系，不用当前关系替代', async () => {
    const d = deps();
    const { memberRef, oldRef } = await buildChain(d);
    const outcome = await handlerFactory(d)(
      { member_ref: memberRef, as_of_time: '2026-02-15T00:00:00.000Z' },
      ctx(),
    );
    if (outcome.outcome_type !== 'SUCCESS') throw new Error('expected success');
    expect(outcome.runtime_result.memberships).toHaveLength(1);
    expect(outcome.runtime_result.memberships[0]?.membership_ref).toBe(oldRef);
    expect(outcome.runtime_result.memberships[0]?.membership_status).toBe('replaced');
  });

  it('关系开始前的历史时点：权威空集合', async () => {
    const d = deps();
    const { memberRef } = await buildChain(d);
    const outcome = await handlerFactory(d)(
      { member_ref: memberRef, as_of_time: '2026-01-15T00:00:00.000Z' },
      ctx(),
    );
    expect(outcome).toMatchObject({
      outcome_type: 'SUCCESS',
      runtime_result: { memberships: [] },
    });
  });

  it('未来 as_of_time -> INVALID_BUSINESS_TIME；非法格式同样拒绝', async () => {
    const d = deps();
    const memberRef = await seedMember(d);
    const future = await handlerFactory(d)(
      { member_ref: memberRef, as_of_time: T3 },
      ctx({ commit_time: T2 }),
    );
    expect(future).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'INVALID_BUSINESS_TIME' },
    });
    const bad = await handlerFactory(d)(
      { member_ref: memberRef, as_of_time: 'nope' },
      ctx(),
    );
    expect(bad).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'INVALID_BUSINESS_TIME' },
    });
  });

  it('会员不存在 -> MEMBER_NOT_FOUND；未授权 -> OPERATION_NOT_AUTHORIZED', async () => {
    const d = deps();
    const notFound = await handlerFactory(d)(
      { member_ref: 'mem_none' },
      ctx(),
    );
    expect(notFound).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'MEMBER_NOT_FOUND' },
    });
    const memberRef = await seedMember(d);
    const denied = await handlerFactory(d)(
      { member_ref: memberRef },
      ctx({ authorization: undefined }),
    );
    expect(denied).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'OPERATION_NOT_AUTHORIZED' },
    });
  });
});
