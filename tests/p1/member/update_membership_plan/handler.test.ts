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
  MembershipPlanProvider,
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
const PLAN_INACTIVE: MembershipPlanResolutionBinding = {
  ...PLAN_B,
  membership_plan_ref: 'plan-inactive',
  state: 'inactive',
};

function deps(): MemberRuntimeDeps {
  return {
    repository: new InMemoryMemberRepository(),
    planProvider: staticMembershipPlanProvider([PLAN_A, PLAN_B, PLAN_INACTIVE]),
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

async function seedRelation(
  memberRef: string,
  planRef = 'plan-a',
  time = T1,
): Promise<string> {
  const outcome = await invokeMemberOperation('create_membership', {
    member_ref: memberRef,
    plan_ref: planRef,
    requested_effective_time: time,
  }, ctx({ commit_time: time }));
  if (outcome.outcome_type !== 'SUCCESS') throw new Error('seed relation failed');
  return outcome.runtime_result.membership_ref;
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

describe('update_membership_plan handler', () => {
  it('原子替换：同一时点旧关系 replaced、新关系 active，区间无缝衔接', async () => {
    const d = bindDeps(deps());
    const memberRef = await seedMember();
    const oldRef = await seedRelation(memberRef, 'plan-a', T1);

    const outcome = await invokeMemberOperation('update_membership_plan', {
      member_ref: memberRef,
      current_membership_ref: oldRef,
      target_plan_ref: 'plan-b',
    }, ctx({ commit_time: T2 }));
    expect(outcome.outcome_type).toBe('SUCCESS');
    if (outcome.outcome_type !== 'SUCCESS') throw new Error('expected success');
    expect(outcome.runtime_result).toMatchObject({
      previous_membership_ref: oldRef,
      membership_status: 'active',
      effective_time: T2,
    });
    const newRef = outcome.runtime_result.membership_ref;
    expect(newRef).not.toBe(oldRef);

    const previous = await d.repository.getMembershipByRef(oldRef);
    expect(previous).toMatchObject({
      membership_status: 'replaced',
      termination_time: T2,
    });
    const current = await d.repository.getMembershipByRef(newRef);
    expect(current).toMatchObject({
      membership_status: 'active',
      plan_ref: 'plan-b',
      effective_time: T2,
      termination_time: null,
    });
  });

  it('旧关系不存在 -> MEMBERSHIP_NOT_FOUND', async () => {
    bindDeps(deps());
    const memberRef = await seedMember();
    const outcome = await invokeMemberOperation('update_membership_plan', {
      member_ref: memberRef,
      current_membership_ref: 'msh_none',
      target_plan_ref: 'plan-b',
    }, ctx());
    expect(outcome).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'MEMBERSHIP_NOT_FOUND' },
    });
  });

  it('旧关系不属于该会员 -> MEMBERSHIP_NOT_FOUND', async () => {
    bindDeps(deps());
    const memberA = await seedMember();
    const otherSeed = await invokeMemberOperation('create_member', {
      member_identity: { identity_namespace: 'ns', identity_value: 'v-2' },
      registration_profile: { display_name: '李四' },
    }, { ...ctx(), commit_time: T0, request_id: 'req-2' });
    if (otherSeed.outcome_type !== 'SUCCESS') throw new Error('seed failed');
    const otherRelation = await seedRelation(otherSeed.runtime_result.member_ref);

    const outcome = await invokeMemberOperation('update_membership_plan', {
      member_ref: memberA,
      current_membership_ref: otherRelation,
      target_plan_ref: 'plan-b',
    }, ctx());
    expect(outcome).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'MEMBERSHIP_NOT_FOUND' },
    });
  });

  it('已 replaced 的旧关系重复提交 -> INVALID_STATE_TRANSITION，不产生第二个后继', async () => {
    const d = bindDeps(deps());
    const memberRef = await seedMember();
    const oldRef = await seedRelation(memberRef, 'plan-a', T1);
    const first = await invokeMemberOperation('update_membership_plan', {
      member_ref: memberRef,
      current_membership_ref: oldRef,
      target_plan_ref: 'plan-b',
    }, ctx({ commit_time: T2 }));
    expect(first.outcome_type).toBe('SUCCESS');
    const retry = await invokeMemberOperation('update_membership_plan', {
      member_ref: memberRef,
      current_membership_ref: oldRef,
      target_plan_ref: 'plan-b',
    }, ctx({ commit_time: T3 }));
    expect(retry).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'INVALID_STATE_TRANSITION' },
    });
    const all = await d.repository.listMembershipsByMember(memberRef);
    expect(all).toHaveLength(2);
  });

  it('新旧方案相同 -> INVALID_STATE_TRANSITION', async () => {
    bindDeps(deps());
    const memberRef = await seedMember();
    const oldRef = await seedRelation(memberRef, 'plan-a', T1);
    const outcome = await invokeMemberOperation('update_membership_plan', {
      member_ref: memberRef,
      current_membership_ref: oldRef,
      target_plan_ref: 'plan-a',
    }, ctx());
    expect(outcome).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'INVALID_STATE_TRANSITION' },
    });
  });

  it('目标方案不可用 -> MEMBERSHIP_PLAN_NOT_FOUND；依赖故障 -> DEPENDENCY_INFORMATION_INCOMPLETE', async () => {
    bindDeps(deps());
    const memberRef = await seedMember();
    const oldRef = await seedRelation(memberRef, 'plan-a', T1);
    const inactive = await invokeMemberOperation('update_membership_plan', {
      member_ref: memberRef,
      current_membership_ref: oldRef,
      target_plan_ref: 'plan-inactive',
    }, ctx());
    expect(inactive).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'MEMBERSHIP_PLAN_NOT_FOUND' },
    });
    const unknown = await invokeMemberOperation('update_membership_plan', {
      member_ref: memberRef,
      current_membership_ref: oldRef,
      target_plan_ref: 'plan-x',
    }, ctx());
    expect(unknown).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'MEMBERSHIP_PLAN_NOT_FOUND' },
    });
  });

  it('生效时点早于旧关系开始或晚于提交 -> INVALID_BUSINESS_TIME', async () => {
    bindDeps(deps());
    const memberRef = await seedMember();
    const oldRef = await seedRelation(memberRef, 'plan-a', T1);
    const beforeStart = await invokeMemberOperation('update_membership_plan', {
      member_ref: memberRef,
      current_membership_ref: oldRef,
      target_plan_ref: 'plan-b',
      requested_effective_time: '2026-01-15T00:00:00.000Z',
    }, ctx({ commit_time: T2 }));
    expect(beforeStart).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'INVALID_BUSINESS_TIME' },
    });
    const future = await invokeMemberOperation('update_membership_plan', {
      member_ref: memberRef,
      current_membership_ref: oldRef,
      target_plan_ref: 'plan-b',
      requested_effective_time: T3,
    }, ctx({ commit_time: T2 }));
    expect(future).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'INVALID_BUSINESS_TIME' },
    });
  });

  it('失败不留半成品：旧关系保持 active，新关系不存在', async () => {
    const d = bindDeps(deps());
    const memberRef = await seedMember();
    const oldRef = await seedRelation(memberRef, 'plan-a', T1);
    await invokeMemberOperation('update_membership_plan', {
      member_ref: memberRef,
      current_membership_ref: oldRef,
      target_plan_ref: 'plan-inactive',
    }, ctx());
    const previous = await d.repository.getMembershipByRef(oldRef);
    expect(previous?.membership_status).toBe('active');
    expect((await d.repository.listMembershipsByMember(memberRef))).toHaveLength(1);
  });

  it('B-04：新生效时点等于旧关系开始 -> INVALID_BUSINESS_TIME，旧关系保持 active 且无后继', async () => {
    const d = bindDeps(deps());
    const memberRef = await seedMember();
    const oldRef = await seedRelation(memberRef, 'plan-a', T1);

    const outcome = await invokeMemberOperation('update_membership_plan', {
      member_ref: memberRef,
      current_membership_ref: oldRef,
      target_plan_ref: 'plan-b',
      requested_effective_time: T1,
    }, ctx({ commit_time: T2 }));
    expect(outcome).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'INVALID_BUSINESS_TIME' },
    });
    // 旧区间必须严格非零：termination_time 仍为 null、状态仍 active
    const previous = await d.repository.getMembershipByRef(oldRef);
    expect(previous).toMatchObject({
      membership_status: 'active',
      termination_time: null,
    });
    expect(await d.repository.listMembershipsByMember(memberRef)).toHaveLength(1);
  });

  it('B-01：请求 plan-b 但 Provider 返回别的方案 -> MEMBERSHIP_PLAN_NOT_FOUND，无替换事件', async () => {
    // plan-a 精确可解析（供 seed）；请求 plan-b 时返回 plan-other（即使 active）
    const bindings = new Map<string, MembershipPlanResolutionBinding>([
      ['plan-a', PLAN_A],
      [
        'plan-b',
        {
          membership_plan_ref: 'plan-other',
          name: '别的方案',
          benefit_refs: [],
          commercial_terms_ref: 'terms-other',
          state: 'active',
        },
      ],
    ]);
    const mismatchProvider: MembershipPlanProvider = {
      async resolveMembershipPlan(request) {
        return {
          outcome_type: 'SUCCESS' as const,
          membership_plan: bindings.get(request.membership_plan_ref)!,
        };
      },
    };
    const d = bindDeps({
      repository: new InMemoryMemberRepository(),
      planProvider: mismatchProvider,
      authorizer: testAuthorizer,
      clock: () => T2,
    });
    const memberRef = await seedMember();
    const oldRef = await seedRelation(memberRef, 'plan-a', T1);

    const outcome = await invokeMemberOperation('update_membership_plan', {
      member_ref: memberRef,
      current_membership_ref: oldRef,
      target_plan_ref: 'plan-b',
    }, ctx());
    expect(outcome).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'MEMBERSHIP_PLAN_NOT_FOUND' },
    });
    const previous = await d.repository.getMembershipByRef(oldRef);
    expect(previous?.membership_status).toBe('active');
    expect(await d.repository.listMembershipsByMember(memberRef)).toHaveLength(1);
  });

  it('B-02：Provider 绑定结构不完整 -> DEPENDENCY_INFORMATION_INCOMPLETE', async () => {
    const malformed: Record<string, unknown> = {
      membership_plan_ref: 'plan-b',
      name: '方案B',
      // benefit_refs 缺失
      commercial_terms_ref: 'terms-b',
      state: 'active',
    };
    const malformedProvider: MembershipPlanProvider = {
      async resolveMembershipPlan(request) {
        const binding =
          request.membership_plan_ref === 'plan-a'
            ? PLAN_A
            : (malformed as unknown as MembershipPlanResolutionBinding);
        return {
          outcome_type: 'SUCCESS' as const,
          membership_plan: binding,
        };
      },
    };
    const d = bindDeps({
      repository: new InMemoryMemberRepository(),
      planProvider: malformedProvider,
      authorizer: testAuthorizer,
      clock: () => T2,
    });
    const memberRef = await seedMember();
    const oldRef = await seedRelation(memberRef, 'plan-a', T1);

    const outcome = await invokeMemberOperation('update_membership_plan', {
      member_ref: memberRef,
      current_membership_ref: oldRef,
      target_plan_ref: 'plan-b',
    }, ctx());
    expect(outcome).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'DEPENDENCY_INFORMATION_INCOMPLETE' },
    });
    const previous = await d.repository.getMembershipByRef(oldRef);
    expect(previous?.membership_status).toBe('active');
  });

  it('未授权 -> OPERATION_NOT_AUTHORIZED', async () => {
    bindDeps(deps());
    const memberRef = await seedMember();
    const oldRef = await seedRelation(memberRef, 'plan-a', T1);
    const outcome = await invokeMemberOperation('update_membership_plan', {
      member_ref: memberRef,
      current_membership_ref: oldRef,
      target_plan_ref: 'plan-b',
    }, ctx({ authorization: undefined }));
    expect(outcome).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'OPERATION_NOT_AUTHORIZED' },
    });
  });
});
