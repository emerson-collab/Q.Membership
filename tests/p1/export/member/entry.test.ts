import { describe, expect, it } from 'vitest';
import {
  InMemoryMemberRepository,
  MEMBER_CAPABILITY_METADATA,
  MemberCapabilityClient,
  STABLE_ERROR_CODE_SETS,
  staticMembershipPlanProvider,
  trustedEntryAuthorizer,
  stableError,
} from '../../../../src/p1/export/member/entry';

describe('member capability entry 公共出口', () => {
  it('导出装配所需的全部公共构件', () => {
    expect(typeof MemberCapabilityClient).toBe('function');
    expect(typeof InMemoryMemberRepository).toBe('function');
    expect(typeof staticMembershipPlanProvider).toBe('function');
    expect(typeof trustedEntryAuthorizer.authorize).toBe('function');
    expect(MEMBER_CAPABILITY_METADATA).toBeDefined();
  });

  it('元数据与契约一致：9 个 Operation = 8 对外 + 1 内部', () => {
    expect(MEMBER_CAPABILITY_METADATA.operation_count).toBe(9);
    expect(MEMBER_CAPABILITY_METADATA.public_operation_count).toBe(8);
    expect(MEMBER_CAPABILITY_METADATA.internal_operation_count).toBe(1);
    expect(MEMBER_CAPABILITY_METADATA.operations).toHaveLength(9);
    expect(
      MEMBER_CAPABILITY_METADATA.operations.filter((o) => o.public),
    ).toHaveLength(8);
    expect(
      MEMBER_CAPABILITY_METADATA.operations.filter((o) => o.internal),
    ).toHaveLength(1);
    expect(MEMBER_CAPABILITY_METADATA.capability_id).toBe('member');
    expect(MEMBER_CAPABILITY_METADATA.stable_code).toBe('MEMBER');
    expect(MEMBER_CAPABILITY_METADATA.q_version).toBe('V0103');
    expect(MEMBER_CAPABILITY_METADATA.gate_pass_implied).toBe(false);
    expect(MEMBER_CAPABILITY_METADATA.activation_implied).toBe(false);
  });

  it('候选状态机仅含声明过的迁移', () => {
    expect(MEMBER_CAPABILITY_METADATA.state_machines.member.transitions).toEqual([
      { from: 'active', to: 'terminated', via: 'update_member_status' },
    ]);
    expect(MEMBER_CAPABILITY_METADATA.state_machines.membership.transitions).toEqual([
      { from: 'active', to: 'replaced', via: 'update_membership_plan' },
    ]);
  });

  it('各 Operation 稳定错误码集合封闭且包含契约声明的代码', () => {
    expect(STABLE_ERROR_CODE_SETS.create_member).toContain(
      'MEMBER_DUPLICATE_REGISTRATION',
    );
    expect(STABLE_ERROR_CODE_SETS.create_membership).toEqual(
      expect.arrayContaining([
        'MEMBERSHIP_PLAN_NOT_FOUND',
        'INVALID_BUSINESS_TIME',
        'INVALID_STATE_TRANSITION',
        'MEMBERSHIP_RELATION_CONFLICT',
      ]),
    );
    expect(STABLE_ERROR_CODE_SETS.update_membership_plan).toContain(
      'MEMBERSHIP_NOT_FOUND',
    );
    expect(STABLE_ERROR_CODE_SETS.evaluate_membership_eligibility).not.toContain(
      'MEMBERSHIP_RELATION_CONFLICT',
    );
    expect(STABLE_ERROR_CODE_SETS.resolve_membership).toEqual([
      'MEMBERSHIP_REF_REQUIRED',
      'MEMBERSHIP_NOT_FOUND',
      'OPERATION_NOT_AUTHORIZED',
      'MEMBERSHIP_REQUIRED_INPUT_MISSING',
    ]);
  });

  it('V0117 默认授权必须拒绝调用方自称已获授权', () => {
    const base = {
      operation_id: 'create_member' as const,
      request: {},
      context: { request_id: 'r', trace_id: 't' },
    };
    expect(
      trustedEntryAuthorizer.authorize({ ...base, context: { ...base.context } }),
    ).toBe(false);
    expect(
      trustedEntryAuthorizer.authorize({
        ...base,
        context: {
          ...base.context,
          authorization: { actor_ref: '', issued_by: 'ingress', allowed_operations: ['*'] },
        },
      }),
    ).toBe(false);
    expect(
      trustedEntryAuthorizer.authorize({
        ...base,
        context: {
          ...base.context,
          authorization: {
            actor_ref: 'actor-1',
            issued_by: 'ingress',
            allowed_operations: ['resolve_member'],
          },
        },
      }),
    ).toBe(false);
    expect(
      trustedEntryAuthorizer.authorize({
        ...base,
        context: {
          ...base.context,
          authorization: {
            actor_ref: 'actor-1',
            issued_by: 'ingress',
            allowed_operations: ['create_member'],
          },
        },
      }),
    ).toBe(false);
  });

  it('V0117 StableError 不能跨 Operation 使用其他声明的错误码', () => {
    expect(stableError('create_member', 'MEMBER_DUPLICATE_REGISTRATION').code)
      .toBe('MEMBER_DUPLICATE_REGISTRATION');
    expect(() => stableError('create_member', 'MEMBERSHIP_NOT_FOUND' as never))
      .toThrow(/Undeclared stable error for exact Operation create_member/);
  });

  it('静态 Plan Provider：精确解析存在的方案，不存在返回稳定错误', async () => {
    const provider = staticMembershipPlanProvider([
      {
        membership_plan_ref: 'plan-a',
        name: 'A',
        benefit_refs: [],
        commercial_terms_ref: 'terms',
        state: 'active',
      },
    ]);
    const ok = await provider.resolveMembershipPlan(
      { membership_plan_ref: 'plan-a' },
      { request_id: 'r', trace_id: 't' },
    );
    expect(ok.outcome_type).toBe('SUCCESS');
    const missing = await provider.resolveMembershipPlan(
      { membership_plan_ref: 'plan-x' },
      { request_id: 'r', trace_id: 't' },
    );
    expect(missing).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'MEMBERSHIP_PLAN_NOT_FOUND' },
    });
  });
});
