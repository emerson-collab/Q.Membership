import { describe, expect, it } from 'vitest';
import {
  InMemoryMemberRepository,
  MemberCapabilityClient,
  staticMembershipPlanProvider,
} from '../../../../src/p1/export/member/entry';
import type {
  CallContext,
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
  benefit_refs: ['benefit-1'],
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

function setup(now: string = T3) {
  const repository = new InMemoryMemberRepository();
  const planProvider = staticMembershipPlanProvider([PLAN_A, PLAN_B]);
  const client = new MemberCapabilityClient({
    repository,
    planProvider,
    clock: () => now,
  });
  return { client, repository };
}

function authCtx(commitTime: string): CallContext {
  return {
    request_id: `req-${commitTime}`,
    trace_id: `trc-${commitTime}`,
    commit_time: commitTime,
    authorization: {
      actor_ref: 'actor-1',
      issued_by: 'trusted-ingress',
      allowed_operations: ['*'],
    },
  };
}

describe('MemberCapabilityClient 端到端业务流', () => {
  it('会员生命周期 + 关系建立/替换/查询 + 资格判定全链路', async () => {
    const { client } = setup();

    // T0 创建会员（带邮箱）
    const created = await client.create(
      {
        member_identity: { identity_namespace: 'wechat', identity_value: 'openid-e2e' },
        registration_profile: {
          display_name: '端到端用户',
          contact_email: 'e2e@example.com',
        },
      },
      authCtx(T0),
    );
    expect(created.outcome_type).toBe('SUCCESS');
    if (created.outcome_type !== 'SUCCESS') throw new Error('create failed');
    const memberRef = created.runtime_result.member_ref;

    // 查询不披露联系方式
    const resolved = await client.resolve({ member_ref: memberRef }, authCtx(T0));
    if (resolved.outcome_type !== 'SUCCESS') throw new Error('resolve failed');
    expect(resolved.runtime_result.member.member_profile).toEqual({
      display_name: '端到端用户',
    });
    expect(JSON.stringify(resolved.runtime_result)).not.toContain('@example.com');

    // 修改档案
    const profileUpdated = await client.updateProfile(
      { member_ref: memberRef, profile_changes: { display_name: '端到端新名' } },
      authCtx(T0),
    );
    expect(profileUpdated).toMatchObject({
      outcome_type: 'SUCCESS',
      runtime_result: { update_result: 'applied' },
    });

    // 刚建会员无关系 -> 资格 false / NO_EFFECTIVE_MEMBERSHIP
    const noRelation = await client.evaluateEligible(
      {
        member_ref: memberRef,
        check_purpose: 'membership_validity',
        decision_time: T15.replace('02-15', '01-15'),
      },
      authCtx(T1),
    );
    expect(noRelation).toMatchObject({
      outcome_type: 'SUCCESS',
      runtime_result: { eligible: false, basis: { reason_code: 'NO_EFFECTIVE_MEMBERSHIP' } },
    });

    // T1 建立与方案A的关系
    const relation = await client.createRelation(
      { member_ref: memberRef, plan_ref: 'plan-a' },
      authCtx(T1),
    );
    expect(relation.outcome_type).toBe('SUCCESS');
    if (relation.outcome_type !== 'SUCCESS') throw new Error('relation failed');
    const oldRelationRef = relation.runtime_result.membership_ref;

    // T1.5 资格 true
    const eligibleAtT15 = await client.evaluateEligible(
      { member_ref: memberRef, check_purpose: 'membership_validity', decision_time: T15 },
      authCtx(T2),
    );
    expect(eligibleAtT15).toMatchObject({
      outcome_type: 'SUCCESS',
      runtime_result: { eligible: true, basis: { reason_code: 'MEMBERSHIP_VALID' } },
    });

    // T2 替换为方案B
    const replaced = await client.replacePlan(
      {
        member_ref: memberRef,
        current_membership_ref: oldRelationRef,
        target_plan_ref: 'plan-b',
      },
      authCtx(T2),
    );
    expect(replaced.outcome_type).toBe('SUCCESS');
    if (replaced.outcome_type !== 'SUCCESS') throw new Error('replace failed');
    const newRelationRef = replaced.runtime_result.membership_ref;

    // 历史查询 T1.5 仍是旧关系；T2 起是新关系
    const history = await client.lookupRelation(
      { member_ref: memberRef, as_of_time: T15 },
      authCtx(T3),
    );
    expect(history).toMatchObject({
      outcome_type: 'SUCCESS',
      runtime_result: { memberships: [{ membership_ref: oldRelationRef, plan_ref: 'plan-a' }] },
    });
    const current = await client.lookupRelation(
      { member_ref: memberRef },
      authCtx(T3),
    );
    expect(current).toMatchObject({
      outcome_type: 'SUCCESS',
      runtime_result: { memberships: [{ membership_ref: newRelationRef, plan_ref: 'plan-b' }] },
    });

    // T3 终止会员
    const terminated = await client.updateStatus(
      { member_ref: memberRef, target_status: 'terminated' },
      authCtx(T3),
    );
    expect(terminated).toMatchObject({
      outcome_type: 'SUCCESS',
      runtime_result: { member_status: 'terminated' },
    });

    // 终止后资格 false / MEMBER_TERMINATED
    const afterTermination = await client.evaluateEligible(
      { member_ref: memberRef, check_purpose: 'membership_validity', decision_time: T3 },
      authCtx(T3),
    );
    expect(afterTermination).toMatchObject({
      outcome_type: 'SUCCESS',
      runtime_result: {
        eligible: false,
        basis: { reason_code: 'MEMBER_TERMINATED', member_status_at_decision: 'terminated' },
      },
    });
  });

  it('安全默认：无授权证据的调用全部 DENY', async () => {
    const { client } = setup();
    const outcome = await client.create(
      {
        member_identity: { identity_namespace: 'ns', identity_value: 'v' },
        registration_profile: { display_name: 'x' },
      },
      { request_id: 'r', trace_id: 't' },
    );
    expect(outcome).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'OPERATION_NOT_AUTHORIZED' },
    });
  });

  it('request_id / trace_id 缺省时自动补齐', async () => {
    const { client } = setup();
    const outcome = await client.create(
      {
        member_identity: { identity_namespace: 'ns', identity_value: 'v2' },
        registration_profile: { display_name: 'x' },
      },
      {
        authorization: {
          actor_ref: 'actor-1',
          issued_by: 'trusted-ingress',
          allowed_operations: ['*'],
        },
      },
    );
    if (outcome.outcome_type !== 'SUCCESS') throw new Error('expected success');
    expect(outcome.request_id).toMatch(/^req_/);
    expect(outcome.trace_id).toMatch(/^trc_/);
  });

  it('并发注册同身份：一个成功一个重复拒绝', async () => {
    const { client } = setup();
    const request = {
      member_identity: { identity_namespace: 'ns', identity_value: 'race' },
      registration_profile: { display_name: 'x' },
    };
    const [a, b] = await Promise.all([
      client.create(request, { ...authCtx(T0), request_id: 'a' }),
      client.create(request, { ...authCtx(T0), request_id: 'b' }),
    ]);
    const results = [a, b].map((o) =>
      o.outcome_type === 'SUCCESS' ? 'SUCCESS' : o.stable_error.code,
    );
    expect(results.filter((r) => r === 'SUCCESS')).toHaveLength(1);
    expect(results).toContain('MEMBER_DUPLICATE_REGISTRATION');
  });

  it('内部精确读取：无内部证据拒绝；有证据按 ID 返回 replaced 历史关系', async () => {
    const { client } = setup();
    const created = await client.create(
      {
        member_identity: { identity_namespace: 'ns', identity_value: 'internal-1' },
        registration_profile: { display_name: 'x' },
      },
      authCtx(T0),
    );
    if (created.outcome_type !== 'SUCCESS') throw new Error('create failed');
    const relA = await client.createRelation(
      { member_ref: created.runtime_result.member_ref, plan_ref: 'plan-a' },
      authCtx(T1),
    );
    if (relA.outcome_type !== 'SUCCESS') throw new Error('relation failed');
    const relB = await client.replacePlan(
      {
        member_ref: created.runtime_result.member_ref,
        current_membership_ref: relA.runtime_result.membership_ref,
        target_plan_ref: 'plan-b',
      },
      authCtx(T2),
    );
    if (relB.outcome_type !== 'SUCCESS') throw new Error('replace failed');

    const denied = await client.resolveRelation(
      { membership_ref: relA.runtime_result.membership_ref },
      authCtx(T3),
    );
    expect(denied).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'OPERATION_NOT_AUTHORIZED' },
    });

    const internalCtx: CallContext = {
      ...authCtx(T3),
      authorization: {
        actor_ref: 'internal-actor',
        issued_by: 'trusted-ingress',
        allowed_operations: ['resolve_membership'],
      },
      internal_invocation: { purpose: 'internal_relation_reference', permitted: true },
    };
    const exact = await client.resolveRelation(
      { membership_ref: relA.runtime_result.membership_ref },
      internalCtx,
    );
    expect(exact).toMatchObject({
      outcome_type: 'SUCCESS',
      runtime_result: {
        membership: { membership_status: 'replaced', plan_ref: 'plan-a' },
      },
    });
  });

  it('B-05：身份二元键无分隔符碰撞——NUL 拼接等价的两组取值可分别注册', async () => {
    const { client } = setup();

    const first = await client.create(
      {
        member_identity: { identity_namespace: 'a\u0000b', identity_value: 'c' },
        registration_profile: { display_name: '甲' },
      },
      { ...authCtx(T0), request_id: 'nul-1' },
    );
    expect(first.outcome_type).toBe('SUCCESS');

    // 旧式 NUL 拼接会与上一个形成同键；嵌套 Map 必须区分
    const second = await client.create(
      {
        member_identity: { identity_namespace: 'a', identity_value: 'b\u0000c' },
        registration_profile: { display_name: '乙' },
      },
      { ...authCtx(T0), request_id: 'nul-2' },
    );
    expect(second.outcome_type).toBe('SUCCESS');
  });

  it('B-05：同一二元组重复注册仍判 MEMBER_DUPLICATE_REGISTRATION', async () => {
    const { client } = setup();
    const identity = {
      identity_namespace: 'dup-ns',
      identity_value: 'dup-value',
    };
    const first = await client.create(
      { member_identity: identity, registration_profile: { display_name: '甲' } },
      { ...authCtx(T0), request_id: 'dup-1' },
    );
    expect(first.outcome_type).toBe('SUCCESS');
    const second = await client.create(
      { member_identity: identity, registration_profile: { display_name: '乙' } },
      { ...authCtx(T0), request_id: 'dup-2' },
    );
    expect(second).toMatchObject({
      outcome_type: 'STABLE_ERROR',
      stable_error: { code: 'MEMBER_DUPLICATE_REGISTRATION' },
    });
  });

  it('B-05：身份取值不做大小写/空白归一化，原始值精确区分', async () => {
    const { client } = setup();

    const lower = await client.create(
      {
        member_identity: { identity_namespace: 'ns', identity_value: 'val' },
        registration_profile: { display_name: '小写' },
      },
      { ...authCtx(T0), request_id: 'case-1' },
    );
    expect(lower.outcome_type).toBe('SUCCESS');

    const upper = await client.create(
      {
        member_identity: { identity_namespace: 'NS', identity_value: 'VAL' },
        registration_profile: { display_name: '大写' },
      },
      { ...authCtx(T0), request_id: 'case-2' },
    );
    expect(upper.outcome_type).toBe('SUCCESS');

    const trailingSpace = await client.create(
      {
        member_identity: { identity_namespace: 'ns', identity_value: 'val ' },
        registration_profile: { display_name: '带空格' },
      },
      { ...authCtx(T0), request_id: 'case-3' },
    );
    expect(trailingSpace.outcome_type).toBe('SUCCESS');
  });
});
