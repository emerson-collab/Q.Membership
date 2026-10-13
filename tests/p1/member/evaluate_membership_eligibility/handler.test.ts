import { testAuthorizer } from '../test_authorizer';
import { describe, expect, it } from 'vitest';
import { createEvaluateMembershipEligibilityHandler } from '../../../../src/p1/member/evaluate_membership_eligibility/handler';
import { createCreateMemberHandler } from '../../../../src/p1/member/create_member/handler';
import { createCreateMembershipHandler } from '../../../../src/p1/member/create_membership/handler';
import { createUpdateMemberStatusHandler } from '../../../../src/p1/member/update_member_status/handler';
import {
  InMemoryMemberRepository } from '../../../../src/p1/export/member/entry';
import { staticMembershipPlanProvider } from '../../../../src/p1/export/member/client';
import type {
  CallContext,
  EvaluateMembershipEligibilityRequest,
  MemberRuntimeDeps,
  MembershipPlanResolutionBinding,
} from '../../../../src/p1/export/member/entry';

const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-02-01T00:00:00.000Z';
const T15 = '2026-02-15T00:00:00.000Z';
const T2 = '2026-03-01T00:00:00.000Z';
const T3 = '2026-04-01T00:00:00.000Z';

const PLAN_A: MembershipPlanResolutionBinding = {
  membership_plan_ref: 'plan-a',
  name: '方案A',
  benefit_refs: [],
  commercial_terms_ref: 'terms-a',
  state: 'active',
};

function deps() {
  return {
    repository: new InMemoryMemberRepository(),
    planProvider: staticMembershipPlanProvider([PLAN_A]),
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

async function seedRelation(
  d: MemberRuntimeDeps,
  memberRef: string,
  time = T1,
): Promise<string> {
  const outcome = await createCreateMembershipHandler(d)(
    { member_ref: memberRef, plan_ref: 'plan-a', requested_effective_time: time },
    ctx({ commit_time: time }),
  );
  if (outcome.outcome_type !== 'SUCCESS') throw new Error('relation seed failed');
  return outcome.runtime_result.membership_ref;
}

function request(
  memberRef: string,
  decisionTime: string,
): EvaluateMembershipEligibilityRequest {
  return {
    member_ref: memberRef,
    check_purpose: 'membership_validity',
    decision_time: decisionTime,
  };
}

describe('evaluate_membership_eligibility handler', () => {
  const handlerFactory = createEvaluateMembershipEligibilityHandler;

  it('B：active 且恰有一条生效关系 -> eligible=true / MEMBERSHIP_VALID', async () => {
    const d = deps();
    const memberRef = await seedMember(d);
    const relationRef = await seedRelation(d, memberRef, T1);
    const outcome = await handlerFactory(d)(request(memberRef, T15), ctx());
    expect(outcome.outcome_type).toBe('SUCCESS');
    if (outcome.outcome_type !== 'SUCCESS') throw new Error('expected success');
    expect(outcome.runtime_result).toEqual({
      eligible: true,
      basis: {
        reason_code: 'MEMBERSHIP_VALID',
        check_purpose: 'membership_validity',
        decision_time: T15,
        member_status_at_decision: 'active',
        membership_refs_considered: [relationRef],
      },
    });
  });

  it('C：active 但权威历史无生效关系 -> eligible=false / NO_EFFECTIVE_MEMBERSHIP', async () => {
    const d = deps();
    const memberRef = await seedMember(d);
    const outcome = await handlerFactory(d)(request(memberRef, T15), ctx());
    expect(outcome).toMatchObject({
      outcome_type: 'SUCCESS',
      runtime_result: {
        eligible: false,
        basis: {
          reason_code: 'NO_EFFECTIVE_MEMBERSHIP',
          member_status_at_decision: 'active',
          membership_refs_considered: [],
        },
      },
    });
  });

  it('A：会员已终止 -> eligible=false / MEMBER_TERMINATED（原因优先于无关系）', async () => {
    const d = deps();
    const memberRef = await seedMember(d);
    await seedRelation(d, memberRef, T1);
    await createUpdateMemberStatusHandler(d)(
      { member_ref: memberRef, target_status: 'terminated' },
      ctx({ commit_time: T2 }),
    );
    const outcome = await handlerFactory(d)(request(memberRef, T3), ctx());
    expect(outcome).toMatchObject({
      outcome_type: 'SUCCESS',
      runtime_result: {
        eligible: false,
        basis: {
          reason_code: 'MEMBER_TERMINATED',
          member_status_at_decision: 'terminated',
        },
      },
    });
  });

  it('终止不重写历史：终止时点之前仍按 active + 生效关系判定 true', async () => {
    const d = deps();
    const memberRef = await seedMember(d);
    await seedRelation(d, memberRef, T1);
    await createUpdateMemberStatusHandler(d)(
      { member_ref: memberRef, target_status: 'terminated' },
      ctx({ commit_time: T2 }),
    );
    const outcome = await handlerFactory(d)(request(memberRef, T15), ctx());
    expect(outcome).toMatchObject({
      outcome_type: 'SUCCESS',
      runtime_result: {
        eligible: true,
        basis: {
          reason_code: 'MEMBERSHIP_VALID',
          member_status_at_decision: 'active',
        },
      },
    });
  });

  it('D：decision_time 早于会员建立 -> DEPENDENCY_INFORMATION_INCOMPLETE，不伪装 false', async () => {
    const d = deps();
    const memberRef = await seedMember(d);
    const outcome = await handlerFactory(d)(
      request(memberRef, '2025-12-15T00:00:00.000Z'),
      ctx(),
    );
    expect(outcome).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'DEPENDENCY_INFORMATION_INCOMPLETE' },
    });
  });

  it('未来 decision_time -> INVALID_BUSINESS_TIME', async () => {
    const d = deps();
    const memberRef = await seedMember(d);
    const outcome = await handlerFactory(d)(request(memberRef, T3), ctx({ commit_time: T2 }));
    expect(outcome).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'INVALID_BUSINESS_TIME' },
    });
  });

  it('不支持的 check_purpose -> DEPENDENCY_INFORMATION_INCOMPLETE', async () => {
    const d = deps();
    const memberRef = await seedMember(d);
    const outcome = await handlerFactory(d)(
      {
        member_ref: memberRef,
        ...({ check_purpose: 'benefit_grant' } as object),
        decision_time: T15,
      } as EvaluateMembershipEligibilityRequest,
      ctx(),
    );
    expect(outcome).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'DEPENDENCY_INFORMATION_INCOMPLETE' },
    });
  });

  it('会员不存在 -> MEMBER_NOT_FOUND；member_ref 为空 -> MEMBER_IDENTITY_MISSING', async () => {
    const d = deps();
    const notFound = await handlerFactory(d)(request('mem_none', T15), ctx());
    expect(notFound).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'MEMBER_NOT_FOUND' },
    });
    const missing = await handlerFactory(d)(request('', T15), ctx());
    expect(missing).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'MEMBER_IDENTITY_MISSING' },
    });
  });

  it('未授权 -> OPERATION_NOT_AUTHORIZED', async () => {
    const d = deps();
    const memberRef = await seedMember(d);
    const outcome = await handlerFactory(d)(
      request(memberRef, T15),
      ctx({ authorization: undefined }),
    );
    expect(outcome).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'OPERATION_NOT_AUTHORIZED' },
    });
  });

  it('相同事实多次判定结果一致（幂等只读）', async () => {
    const d = deps();
    const memberRef = await seedMember(d);
    await seedRelation(d, memberRef, T1);
    const a = await handlerFactory(d)(request(memberRef, T15), ctx({ request_id: 'ra' }));
    const b = await handlerFactory(d)(request(memberRef, T15), ctx({ request_id: 'rb' }));
    // 幂等只读：业务判定结果与依据一致（信封 request_id 允许随调用不同）
    expect(a.outcome_type).toBe('SUCCESS');
    expect(b.outcome_type).toBe('SUCCESS');
    if (a.outcome_type === 'SUCCESS' && b.outcome_type === 'SUCCESS') {
      expect(a.runtime_result).toEqual(b.runtime_result);
    }
  });
});
