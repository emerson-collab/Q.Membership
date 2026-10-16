import { testAuthorizer } from '../test_authorizer.ts';
import { describe, expect, it, afterEach } from 'vitest';
import {
  invokeMemberOperation,
  registerMemberForTest,
} from '../registry_test_helper.ts';
import {
  InMemoryMemberRepository } from '../../../../src/p1/export/member/client.ts';
import { staticMembershipPlanProvider } from '../../../../src/p1/export/member/client.ts';
import type {
  CallContext,
  MemberRuntimeDeps,
  MembershipPlanResolutionBinding,
} from '../../../../src/p1/export/member/entry.ts';

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

function deps(): MemberRuntimeDeps {
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

async function seedMember(): Promise<string> {
  const outcome = await invokeMemberOperation('create_member', {
    member_identity: { identity_namespace: 'ns', identity_value: 'v-1' },
    registration_profile: { display_name: '张三' },
  }, { ...ctx(), commit_time: T0 });
  if (outcome.outcome_type !== 'SUCCESS') throw new Error('seed failed');
  return outcome.runtime_result.member_ref;
}

async function buildChain(): Promise<{ memberRef: string; oldRef: string; newRef: string }> {
  const memberRef = await seedMember();
  const created = await invokeMemberOperation('create_membership', {
    member_ref: memberRef,
    plan_ref: 'plan-a',
  }, ctx({ commit_time: T1 }));
  if (created.outcome_type !== 'SUCCESS') throw new Error('relation seed failed');
  const oldRef = created.runtime_result.membership_ref;
  const replaced = await invokeMemberOperation('update_membership_plan', {
    member_ref: memberRef,
    current_membership_ref: oldRef,
    target_plan_ref: 'plan-b',
  }, ctx({ commit_time: T2 }));
  if (replaced.outcome_type !== 'SUCCESS') throw new Error('replace failed');
  return { memberRef, oldRef, newRef: replaced.runtime_result.membership_ref };
}

let activeUnregister: (() => void) | undefined;
afterEach(() => {
  activeUnregister?.();
  activeUnregister = undefined;
});
function bindDeps<T extends MemberRuntimeDeps>(d: T): T {
  activeUnregister?.();
  activeUnregister = registerMemberForTest(d).unregister;
  return d;
}

describe('lookup_membership handler', () => {
  it('当前时点返回唯一生效关系（替换后为新关系，区间右开）', async () => {
    bindDeps(deps());
    const { memberRef, newRef } = await buildChain();
    const outcome = await invokeMemberOperation('lookup_membership', {
      member_ref: memberRef,
    }, ctx({ commit_time: T3 }));
    expect(outcome.outcome_type).toBe('SUCCESS');
    if (outcome.outcome_type !== 'SUCCESS') throw new Error('expected success');
    expect(outcome.runtime_result.memberships).toHaveLength(1);
    expect(outcome.runtime_result.memberships[0]?.membership_ref).toBe(newRef);
    expect(outcome.runtime_result.memberships[0]?.termination_time).toBeNull();
  });

  it('替换时点 T2：旧关系 [T1,T2) 已失效，新关系 [T2,..) 生效', async () => {
    bindDeps(deps());
    const { memberRef, newRef } = await buildChain();
    const atT2 = await invokeMemberOperation('lookup_membership', {
      member_ref: memberRef,
      as_of_time: T2,
    }, ctx());
    if (atT2.outcome_type !== 'SUCCESS') throw new Error('expected success');
    expect(atT2.runtime_result.memberships[0]?.membership_ref).toBe(newRef);
  });

  it('历史时点 T1~T2 之间精确返回旧关系，不用当前关系替代', async () => {
    bindDeps(deps());
    const { memberRef, oldRef } = await buildChain();
    const outcome = await invokeMemberOperation('lookup_membership', {
      member_ref: memberRef,
      as_of_time: '2026-02-15T00:00:00.000Z',
    }, ctx());
    if (outcome.outcome_type !== 'SUCCESS') throw new Error('expected success');
    expect(outcome.runtime_result.memberships).toHaveLength(1);
    expect(outcome.runtime_result.memberships[0]?.membership_ref).toBe(oldRef);
    expect(outcome.runtime_result.memberships[0]?.membership_status).toBe('replaced');
  });

  it('关系开始前的历史时点：权威空集合', async () => {
    bindDeps(deps());
    const { memberRef } = await buildChain();
    const outcome = await invokeMemberOperation('lookup_membership', {
      member_ref: memberRef,
      as_of_time: '2026-01-15T00:00:00.000Z',
    }, ctx());
    expect(outcome).toMatchObject({
      outcome_type: 'SUCCESS',
      runtime_result: { memberships: [] },
    });
  });

  it('未来 as_of_time -> INVALID_BUSINESS_TIME；非法格式同样拒绝', async () => {
    bindDeps(deps());
    const memberRef = await seedMember();
    const future = await invokeMemberOperation('lookup_membership', {
      member_ref: memberRef,
      as_of_time: T3,
    }, ctx({ commit_time: T2 }));
    expect(future).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'INVALID_BUSINESS_TIME' },
    });
    const bad = await invokeMemberOperation('lookup_membership', {
      member_ref: memberRef,
      as_of_time: 'nope',
    }, ctx());
    expect(bad).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'INVALID_BUSINESS_TIME' },
    });
  });

  it('会员不存在 -> MEMBER_NOT_FOUND；未授权 -> OPERATION_NOT_AUTHORIZED', async () => {
    bindDeps(deps());
    const notFound = await invokeMemberOperation('lookup_membership', {
      member_ref: 'mem_none',
    }, ctx());
    expect(notFound).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'MEMBER_NOT_FOUND' },
    });
    const memberRef = await seedMember();
    const denied = await invokeMemberOperation('lookup_membership', {
      member_ref: memberRef,
    }, ctx({ authorization: undefined }));
    expect(denied).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'OPERATION_NOT_AUTHORIZED' },
    });
  });
});
