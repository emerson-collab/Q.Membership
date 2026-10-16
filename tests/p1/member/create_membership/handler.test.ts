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
  MembershipPlanProvider,
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
const PLAN_INACTIVE: MembershipPlanResolutionBinding = {
  ...PLAN_A,
  membership_plan_ref: 'plan-inactive',
  state: 'inactive',
};

function deps(
  plans: MembershipPlanResolutionBinding[] = [PLAN_A, PLAN_INACTIVE],
  planProvider?: MembershipPlanProvider,
) {
  return {
    repository: new InMemoryMemberRepository(),
    planProvider: planProvider ?? staticMembershipPlanProvider(plans),
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

async function seedMember(): Promise<string> {
  const outcome = await invokeMemberOperation('create_member', {
    member_identity: { identity_namespace: 'ns', identity_value: 'v-1' },
    registration_profile: { display_name: '张三' },
  }, { ...ctx(), commit_time: T0 });
  if (outcome.outcome_type !== 'SUCCESS') throw new Error('seed failed');
  return outcome.runtime_result.member_ref;
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

describe('create_membership handler', () => {
  it('成功建立关系：独立标识、active、半开区间开始，不要求支付凭据', async () => {
    const d = bindDeps(deps());
    const ref = await seedMember();
    const outcome = await invokeMemberOperation('create_membership', {
      member_ref: ref,
      plan_ref: 'plan-a',
    }, ctx());
    expect(outcome.outcome_type).toBe('SUCCESS');
    if (outcome.outcome_type !== 'SUCCESS') throw new Error('expected success');
    expect(outcome.runtime_result.membership_ref).toMatch(/^msh_/);
    expect(outcome.runtime_result).toMatchObject({
      membership_status: 'active',
      effective_time: T1,
    });
    const relations = d.repository.listRelationEvents(ref);
    expect(relations).toHaveLength(1);
    expect(relations[0]?.event_kind).toBe('created');
  });

  it('可在合法历史时点建立关系（不早于会员创建、不晚于提交）', async () => {
    bindDeps(deps());
    const ref = await seedMember();
    const outcome = await invokeMemberOperation('create_membership', {
      member_ref: ref,
      plan_ref: 'plan-a',
      requested_effective_time: '2026-01-15T00:00:00.000Z',
    }, ctx());
    expect(outcome).toMatchObject({
      outcome_type: 'SUCCESS',
      runtime_result: { effective_time: '2026-01-15T00:00:00.000Z' },
    });
  });

  it('未授权 -> OPERATION_NOT_AUTHORIZED', async () => {
    bindDeps(deps());
    const ref = await seedMember();
    const outcome = await invokeMemberOperation('create_membership', {
      member_ref: ref,
      plan_ref: 'plan-a',
    }, ctx({ authorization: undefined }));
    expect(outcome).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'OPERATION_NOT_AUTHORIZED' },
    });
  });

  it('会员不存在 -> MEMBER_NOT_FOUND', async () => {
    bindDeps(deps());
    const outcome = await invokeMemberOperation('create_membership', {
      member_ref: 'mem_none',
      plan_ref: 'plan-a',
    }, ctx());
    expect(outcome).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'MEMBER_NOT_FOUND' },
    });
  });

  it('目标方案无法精确解析 -> PRESERVE_EXACT 透传对端稳定错误', async () => {
    bindDeps(deps());
    const ref = await seedMember();
    const outcome = await invokeMemberOperation('create_membership', {
      member_ref: ref,
      plan_ref: 'plan-unknown',
    }, ctx());
    expect(outcome).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'MEMBERSHIP_PLAN_NOT_FOUND' },
    });
  });

  it('方案存在但 state!=active -> MEMBERSHIP_PLAN_NOT_FOUND', async () => {
    bindDeps(deps());
    const ref = await seedMember();
    const outcome = await invokeMemberOperation('create_membership', {
      member_ref: ref,
      plan_ref: 'plan-inactive',
    }, ctx());
    expect(outcome).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'MEMBERSHIP_PLAN_NOT_FOUND' },
    });
  });

  it('Provider 故障 -> DEPENDENCY_INFORMATION_INCOMPLETE', async () => {
    const throwingProvider: MembershipPlanProvider = {
      async resolveMembershipPlan() {
        throw new Error('provider unavailable');
      },
    };
    bindDeps(deps([], throwingProvider));
    const ref = await seedMember();
    const outcome = await invokeMemberOperation('create_membership', {
      member_ref: ref,
      plan_ref: 'plan-a',
    }, ctx());
    expect(outcome).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'DEPENDENCY_INFORMATION_INCOMPLETE' },
    });
  });

  it('未来生效时点 -> INVALID_BUSINESS_TIME', async () => {
    bindDeps(deps());
    const ref = await seedMember();
    const outcome = await invokeMemberOperation('create_membership', {
      member_ref: ref,
      plan_ref: 'plan-a',
      requested_effective_time: T2,
    }, ctx({ commit_time: T1 }));
    expect(outcome).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'INVALID_BUSINESS_TIME' },
    });
  });

  it('早于会员建立时点 -> INVALID_BUSINESS_TIME', async () => {
    bindDeps(deps());
    const ref = await seedMember();
    const outcome = await invokeMemberOperation('create_membership', {
      member_ref: ref,
      plan_ref: 'plan-a',
      requested_effective_time: '2025-12-31T00:00:00.000Z',
    }, ctx());
    expect(outcome).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'INVALID_BUSINESS_TIME' },
    });
  });

  it('拟生效时点会员已终止 -> INVALID_STATE_TRANSITION', async () => {
    bindDeps(deps());
    const ref = await seedMember();
    await invokeMemberOperation('update_member_status', {
      member_ref: ref,
      target_status: 'terminated',
    }, ctx({ commit_time: T1 }));
    const outcome = await invokeMemberOperation('create_membership', {
      member_ref: ref,
      plan_ref: 'plan-a',
    }, ctx({ commit_time: T2 }));
    expect(outcome).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'INVALID_STATE_TRANSITION' },
    });
  });

  it('该时点已存在生效关系 -> MEMBERSHIP_RELATION_CONFLICT，不建立新关系', async () => {
    const d = bindDeps(deps());
    const ref = await seedMember();
    const first = await invokeMemberOperation('create_membership', {
      member_ref: ref,
      plan_ref: 'plan-a',
    }, ctx({ commit_time: T1 }));
    expect(first.outcome_type).toBe('SUCCESS');
    const second = await invokeMemberOperation('create_membership', {
      member_ref: ref,
      plan_ref: 'plan-a',
    }, ctx({ commit_time: T2 }));
    expect(second).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'MEMBERSHIP_RELATION_CONFLICT' },
    });
    const memberships = await d.repository.listMembershipsByMember(ref);
    expect(memberships).toHaveLength(1);
  });

  it('非法时间格式 -> INVALID_BUSINESS_TIME；plan_ref 为空 -> 必填错误', async () => {
    bindDeps(deps());
    const ref = await seedMember();
    const badTime = await invokeMemberOperation('create_membership', {
      member_ref: ref,
      plan_ref: 'plan-a',
      requested_effective_time: 'not-a-time',
    }, ctx());
    expect(badTime).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'INVALID_BUSINESS_TIME' },
    });
    const missingPlan = await invokeMemberOperation('create_membership', {
      member_ref: ref,
      plan_ref: '',
    }, ctx());
    expect(missingPlan).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'MEMBERSHIP_REQUIRED_INPUT_MISSING' },
    });
  });

  // -- B-01：方案精确引用核对 ------------------------------------------------

  it('B-01：请求 plan-a 但 Provider 返回 plan-b（active）-> MEMBERSHIP_PLAN_NOT_FOUND，零关系事件', async () => {
    const mismatchProvider: MembershipPlanProvider = {
      async resolveMembershipPlan() {
        return {
          outcome_type: 'SUCCESS' as const,
          membership_plan: {
            membership_plan_ref: 'plan-b',
            name: '方案B',
            benefit_refs: [],
            commercial_terms_ref: 'terms-b',
            state: 'active',
          },
        };
      },
    };
    const d = bindDeps(deps([], mismatchProvider));
    const ref = await seedMember();
    const outcome = await invokeMemberOperation('create_membership', {
      member_ref: ref,
      plan_ref: 'plan-a',
    }, ctx());
    expect(outcome).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'MEMBERSHIP_PLAN_NOT_FOUND' },
    });
    expect(d.repository.listRelationEvents(ref)).toHaveLength(0);
    expect(await d.repository.listMembershipsByMember(ref)).toHaveLength(0);
  });

  // -- B-02：Provider 结果五必填字段完整性 ----------------------------------

  function bindingProvider(membershipPlan: unknown): MembershipPlanProvider {
    return {
      async resolveMembershipPlan() {
        return {
          outcome_type: 'SUCCESS' as const,
          membership_plan: membershipPlan as MembershipPlanResolutionBinding,
        };
      },
    };
  }

  it('B-02：绑定缺任一必填字段/benefit_refs 重复 -> DEPENDENCY_INFORMATION_INCOMPLETE，零写入', async () => {
    const brokenBindings: Array<[string, Record<string, unknown>]> = [
      ['缺 membership_plan_ref', (() => {
        const b = { ...PLAN_A };
        delete (b as Record<string, unknown>).membership_plan_ref;
        return b as Record<string, unknown>;
      })()],
      ['缺 name', (() => {
        const b: Record<string, unknown> = { ...PLAN_A };
        delete b.name;
        return b;
      })()],
      ['缺 benefit_refs', (() => {
        const b: Record<string, unknown> = { ...PLAN_A };
        delete b.benefit_refs;
        return b;
      })()],
      ['缺 commercial_terms_ref', (() => {
        const b: Record<string, unknown> = { ...PLAN_A };
        delete b.commercial_terms_ref;
        return b;
      })()],
      ['缺 state', (() => {
        const b: Record<string, unknown> = { ...PLAN_A };
        delete b.state;
        return b;
      })()],
      ['benefit_refs 重复', { ...PLAN_A, benefit_refs: ['b-1', 'b-1'] }],
      ['benefit_refs 含非字符串', { ...PLAN_A, benefit_refs: ['b-1', 2] }],
      ['多出未声明字段', { ...PLAN_A, extra: 'x' }],
    ];

    for (const [label, binding] of brokenBindings) {
      const d = bindDeps(deps([], bindingProvider(binding)));
      const ref = await seedMember();
      const outcome = await invokeMemberOperation('create_membership', {
        member_ref: ref,
        plan_ref: 'plan-a',
      }, ctx({ request_id: `req-${label}` }));
      expect(outcome, label).toMatchObject({
        outcome_type: 'STABLE_ERROR',
        stable_error: { code: 'DEPENDENCY_INFORMATION_INCOMPLETE' },
      });
      expect(d.repository.listRelationEvents(ref), label).toHaveLength(0);
      expect(await d.repository.listMembershipsByMember(ref), label).toHaveLength(0);
    }
  });

  // -- B-03：提交时原子一致性 ------------------------------------------------

  it('B-03：Provider 等待期间会员被终止，提交边界原子拒绝（INVALID_STATE_TRANSITION）', async () => {
    const d = bindDeps(deps());
    const ref = await seedMember();

    const successResult = {
      outcome_type: 'SUCCESS' as const,
      membership_plan: PLAN_A,
    };
    let releaseGate: () => void = () => undefined;
    const pending = new Promise<typeof successResult>((resolve) => {
      releaseGate = () => resolve(successResult);
    });
    const gatedProvider: MembershipPlanProvider = {
      async resolveMembershipPlan() {
        return pending;
      },
    };
    d.planProvider = gatedProvider;

    const invocation = invokeMemberOperation('create_membership', {
      member_ref: ref,
      plan_ref: 'plan-a',
    }, ctx({ commit_time: T2, request_id: 'req-create' }));
    // 确保处理已进入 Provider 等待（连续微任务冲刷，不依赖计时器类型）
    for (let i = 0; i < 10; i += 1) {
      await Promise.resolve();
    }

    const termination = await invokeMemberOperation('update_member_status', {
      member_ref: ref,
      target_status: 'terminated',
      reason: '等待期间注销',
    }, ctx({ commit_time: T2, request_id: 'req-terminate' }));
    expect(termination.outcome_type).toBe('SUCCESS');

    releaseGate();
    const outcome = await invocation;
    expect(outcome).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'INVALID_STATE_TRANSITION' },
    });
    // 拒绝时无任何关系写入（无部分提交）
    expect(d.repository.listRelationEvents(ref)).toHaveLength(0);
    expect(await d.repository.listMembershipsByMember(ref)).toHaveLength(0);
  });

  it('B-03：历史时点（终止之前）建立关系不因当前 terminated 被误拒', async () => {
    bindDeps(deps());
    const ref = await seedMember();
    const termination = await invokeMemberOperation('update_member_status', {
      member_ref: ref,
      target_status: 'terminated',
    }, ctx({ commit_time: T1, request_id: 'req-terminate' }));
    expect(termination.outcome_type).toBe('SUCCESS');

    const outcome = await invokeMemberOperation('create_membership', {
      member_ref: ref,
      plan_ref: 'plan-a',
      requested_effective_time: '2026-01-15T00:00:00.000Z',
    }, ctx({ commit_time: T2, request_id: 'req-history' }));
    expect(outcome).toMatchObject({
      outcome_type: 'SUCCESS',
      runtime_result: { effective_time: '2026-01-15T00:00:00.000Z' },
    });
  });

  // -- B-06：请求 Schema（handler 映射） ------------------------------------

  it('B-06：顶层未知字段 -> MEMBERSHIP_REQUIRED_INPUT_MISSING', async () => {
    const d = bindDeps(deps());
    const ref = await seedMember();
    const outcome = await invokeMemberOperation('create_membership', {
      member_ref: ref,
      plan_ref: 'plan-a',
      unexpected_field: 1,
    } as object as never, ctx());
    expect(outcome).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'MEMBERSHIP_REQUIRED_INPUT_MISSING' },
    });
    expect(d.repository.listRelationEvents(ref)).toHaveLength(0);
  });

  // -- B-08：真实日历严格校验（handler 映射） -------------------------------

  it('B-08：2026-02-30 等不存在日期 -> INVALID_BUSINESS_TIME', async () => {
    bindDeps(deps());
    const ref = await seedMember();
    for (const impossible of [
      '2026-02-30T00:00:00.000Z',
      '2025-02-29T00:00:00.000Z',
      '2026-01-01T25:00:00.000Z',
    ]) {
      const outcome = await invokeMemberOperation('create_membership', {
        member_ref: ref,
        plan_ref: 'plan-a',
        requested_effective_time: impossible,
      }, ctx({ request_id: `req-${impossible}` }));
      expect(outcome, impossible).toMatchObject({
        outcome_type: 'STABLE_ERROR',
        stable_error: { code: 'INVALID_BUSINESS_TIME' },
      });
    }
  });
});
