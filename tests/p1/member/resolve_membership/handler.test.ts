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
    clock: () => T2,
  };
}

type CtxOverrides = { [K in keyof CallContext]?: CallContext[K] | undefined };
function ctx(overrides: CtxOverrides = {}): CallContext {
  return {
    request_id: 'req-1',
    trace_id: 'trc-1',
    commit_time: T2,
    authorization: {
      actor_ref: 'internal-actor',
      issued_by: 'trusted-ingress',
      allowed_operations: ['resolve_membership'],
    },
    internal_invocation: { purpose: 'internal_relation_reference', permitted: true },
    ...overrides,
  } as CallContext;
}

async function seedChain(): Promise<{ memberRef: string; oldRef: string; newRef: string }> {
  const externalAuth = { actor_ref: 'a', issued_by: 't', allowed_operations: ['*'] as const };
  const member = await invokeMemberOperation('create_member', {
    member_identity: { identity_namespace: 'ns', identity_value: 'v-1' },
    registration_profile: { display_name: '张三' },
  }, { ...ctx(), commit_time: T0, authorization: externalAuth });
  if (member.outcome_type !== 'SUCCESS') throw new Error('seed member failed');
  const memberRef = member.runtime_result.member_ref;
  const created = await invokeMemberOperation('create_membership', {
    member_ref: memberRef,
    plan_ref: 'plan-a',
  }, { ...ctx(), commit_time: T1, authorization: externalAuth });
  if (created.outcome_type !== 'SUCCESS') throw new Error('seed relation failed');
  const oldRef = created.runtime_result.membership_ref;
  const replaced = await invokeMemberOperation('update_membership_plan', {
    member_ref: memberRef,
    current_membership_ref: oldRef,
    target_plan_ref: 'plan-b',
  }, { ...ctx(), commit_time: T2, authorization: externalAuth });
  if (replaced.outcome_type !== 'SUCCESS') throw new Error('replace failed');
  return { memberRef, oldRef, newRef: replaced.runtime_result.membership_ref };
}

let activeUnregister: (() => void) | undefined;
afterEach(() => {
  activeUnregister?.();
  activeUnregister = undefined;
});
function bindDeps(d: MemberRuntimeDeps): MemberRuntimeDeps {
  activeUnregister?.();
  activeUnregister = registerMemberForTest(d).unregister;
  return d;
}

describe('resolve_membership handler（内部）', () => {
  it('按精确 ID 返回 active 关系，不重新选择', async () => {
    bindDeps(deps());
    const { newRef } = await seedChain();
    const outcome = await invokeMemberOperation('resolve_membership', {
      membership_ref: newRef,
    }, ctx());
    expect(outcome.outcome_type).toBe('SUCCESS');
    if (outcome.outcome_type !== 'SUCCESS') throw new Error('expected success');
    expect(outcome.runtime_result.membership.membership_ref).toBe(newRef);
    expect(outcome.runtime_result.membership.plan_ref).toBe('plan-b');
  });

  it('已 replaced 的历史关系仍可按精确 ID 读取', async () => {
    bindDeps(deps());
    const { oldRef } = await seedChain();
    const outcome = await invokeMemberOperation('resolve_membership', {
      membership_ref: oldRef,
    }, ctx());
    expect(outcome).toMatchObject({
      outcome_type: 'SUCCESS',
      runtime_result: {
        membership: {
          membership_ref: oldRef,
          membership_status: 'replaced',
          termination_time: T2,
        },
      },
    });
  });

  it('仅有操作授权、缺少内部用途证据 -> OPERATION_NOT_AUTHORIZED', async () => {
    bindDeps(deps());
    const { newRef } = await seedChain();
    const outcome = await invokeMemberOperation('resolve_membership', {
      membership_ref: newRef,
    }, ctx({ internal_invocation: undefined }));
    expect(outcome).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'OPERATION_NOT_AUTHORIZED' },
    });
  });

  it('内部用途证据明确不允许 -> OPERATION_NOT_AUTHORIZED', async () => {
    bindDeps(deps());
    const { newRef } = await seedChain();
    const outcome = await invokeMemberOperation('resolve_membership', {
      membership_ref: newRef,
    }, ctx({ internal_invocation: { purpose: 'wrong-purpose', permitted: false } }));
    expect(outcome).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'OPERATION_NOT_AUTHORIZED' },
    });
  });

  it('空 membership_ref -> MEMBERSHIP_REF_REQUIRED', async () => {
    bindDeps(deps());
    const outcome = await invokeMemberOperation('resolve_membership', {
      membership_ref: '',
    }, ctx());
    expect(outcome).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'MEMBERSHIP_REF_REQUIRED' },
    });
  });

  it('标识不存在 -> MEMBERSHIP_NOT_FOUND，不返回另一条关系', async () => {
    bindDeps(deps());
    await seedChain();
    const outcome = await invokeMemberOperation('resolve_membership', {
      membership_ref: 'msh_unknown',
    }, ctx());
    expect(outcome).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'MEMBERSHIP_NOT_FOUND' },
    });
  });
});
