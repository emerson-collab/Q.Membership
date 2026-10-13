import { testAuthorizer } from '../test_authorizer';
import { describe, expect, it } from 'vitest';
import { createResolveMembershipHandler } from '../../../../src/p1/member/resolve_membership/handler';
import { createCreateMemberHandler } from '../../../../src/p1/member/create_member/handler';
import { createCreateMembershipHandler } from '../../../../src/p1/member/create_membership/handler';
import { createUpdateMembershipPlanHandler } from '../../../../src/p1/member/update_membership_plan/handler';
import {
  InMemoryMemberRepository,
  staticMembershipPlanProvider,
} from '../../../../src/p1/export/member/entry';
import type {
  CallContext,
  MemberRuntimeDeps,
  MembershipPlanResolutionBinding,
} from '../../../../src/p1/export/member/entry';

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

function deps() {
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

async function seedChain(d: MemberRuntimeDeps): Promise<{ memberRef: string; oldRef: string; newRef: string }> {
  const member = await createCreateMemberHandler(d)(
    {
      member_identity: { identity_namespace: 'ns', identity_value: 'v-1' },
      registration_profile: { display_name: '张三' },
    },
    { ...ctx(), commit_time: T0, authorization: { actor_ref: 'a', issued_by: 't', allowed_operations: ['*'] } },
  );
  if (member.outcome_type !== 'SUCCESS') throw new Error('seed member failed');
  const memberRef = member.runtime_result.member_ref;
  const created = await createCreateMembershipHandler(d)(
    { member_ref: memberRef, plan_ref: 'plan-a' },
    { ...ctx(), commit_time: T1, authorization: { actor_ref: 'a', issued_by: 't', allowed_operations: ['*'] } },
  );
  if (created.outcome_type !== 'SUCCESS') throw new Error('seed relation failed');
  const oldRef = created.runtime_result.membership_ref;
  const replaced = await createUpdateMembershipPlanHandler(d)(
    {
      member_ref: memberRef,
      current_membership_ref: oldRef,
      target_plan_ref: 'plan-b',
    },
    { ...ctx(), commit_time: T2, authorization: { actor_ref: 'a', issued_by: 't', allowed_operations: ['*'] } },
  );
  if (replaced.outcome_type !== 'SUCCESS') throw new Error('replace failed');
  return { memberRef, oldRef, newRef: replaced.runtime_result.membership_ref };
}

describe('resolve_membership handler（内部）', () => {
  const handlerFactory = createResolveMembershipHandler;

  it('按精确 ID 返回 active 关系，不重新选择', async () => {
    const d = deps();
    const { newRef } = await seedChain(d);
    const outcome = await handlerFactory(d)({ membership_ref: newRef }, ctx());
    expect(outcome.outcome_type).toBe('SUCCESS');
    if (outcome.outcome_type !== 'SUCCESS') throw new Error('expected success');
    expect(outcome.runtime_result.membership.membership_ref).toBe(newRef);
    expect(outcome.runtime_result.membership.plan_ref).toBe('plan-b');
  });

  it('已 replaced 的历史关系仍可按精确 ID 读取', async () => {
    const d = deps();
    const { oldRef } = await seedChain(d);
    const outcome = await handlerFactory(d)({ membership_ref: oldRef }, ctx());
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
    const d = deps();
    const { newRef } = await seedChain(d);
    const outcome = await handlerFactory(d)(
      { membership_ref: newRef },
      ctx({ internal_invocation: undefined }),
    );
    expect(outcome).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'OPERATION_NOT_AUTHORIZED' },
    });
  });

  it('内部用途证据明确不允许 -> OPERATION_NOT_AUTHORIZED', async () => {
    const d = deps();
    const { newRef } = await seedChain(d);
    const outcome = await handlerFactory(d)(
      { membership_ref: newRef },
      ctx({ internal_invocation: { purpose: 'wrong-purpose', permitted: false } }),
    );
    expect(outcome).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'OPERATION_NOT_AUTHORIZED' },
    });
  });

  it('空 membership_ref -> MEMBERSHIP_REF_REQUIRED', async () => {
    const outcome = await handlerFactory(deps())({ membership_ref: '' }, ctx());
    expect(outcome).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'MEMBERSHIP_REF_REQUIRED' },
    });
  });

  it('标识不存在 -> MEMBERSHIP_NOT_FOUND，不返回另一条关系', async () => {
    const d = deps();
    await seedChain(d);
    const outcome = await handlerFactory(d)(
      { membership_ref: 'msh_unknown' },
      ctx(),
    );
    expect(outcome).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'MEMBERSHIP_NOT_FOUND' },
    });
  });
});
