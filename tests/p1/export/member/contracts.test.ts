import { describe, expect, it } from 'vitest';
import {
  parseDateTime,
  validateOperationRequest,
  validatePlanResolution,
} from '../../../../src/p1/export/member/contracts';
import type {
  MembershipPlanResolutionBinding,
  OperationId,
} from '../../../../src/p1/export/member/types';

// ---------------------------------------------------------------------------
// B-08：parseDateTime 真实日历严格校验
// ---------------------------------------------------------------------------

describe('B-08 parseDateTime 严格真实日历解析', () => {
  it('拒绝不存在的日期（禁止 Date.parse 静默归一化）', () => {
    // 对照：JS Date.parse 会把 02-30 归一化为 03-02，严格校验必须拒绝
    expect(Number.isNaN(Date.parse('2026-02-30T00:00:00.000Z'))).toBe(false);
    expect(parseDateTime('2026-02-30T00:00:00.000Z')).toBeNull();
    expect(parseDateTime('2026-04-31T00:00:00.000Z')).toBeNull();
    expect(parseDateTime('2026-01-00T00:00:00.000Z')).toBeNull();
    expect(parseDateTime('2026-13-01T00:00:00.000Z')).toBeNull();
  });

  it('闰年规则：四年一闰、百年不闰、四百年再闰', () => {
    expect(parseDateTime('2024-02-29T00:00:00.000Z')).not.toBeNull();
    expect(parseDateTime('2025-02-29T00:00:00.000Z')).toBeNull();
    expect(parseDateTime('2000-02-29T00:00:00.000Z')).not.toBeNull();
    expect(parseDateTime('1900-02-29T00:00:00.000Z')).toBeNull();
  });

  it('拒绝越界时分秒', () => {
    expect(parseDateTime('2026-01-01T25:00:00.000Z')).toBeNull();
    expect(parseDateTime('2026-01-01T24:00:00.000Z')).toBeNull();
    expect(parseDateTime('2026-01-01T12:60:00.000Z')).toBeNull();
    expect(parseDateTime('2026-01-01T12:00:60.000Z')).toBeNull();
  });

  it('拒绝非法或越界时区偏移；合法偏移精确折算 UTC', () => {
    expect(parseDateTime('2026-01-01T00:00:00.000+24:00')).toBeNull();
    expect(parseDateTime('2026-01-01T00:00:00.000+12:60')).toBeNull();
    expect(parseDateTime('2026-01-01T00:00:00')).toBeNull();
    expect(parseDateTime('2026-01-01 00:00:00Z')).toBeNull();

    const utc = parseDateTime('2026-01-01T00:00:00.000Z');
    expect(utc?.getTime()).toBe(Date.UTC(2026, 0, 1, 0, 0, 0, 0));

    // +08:00 的 12:00 == UTC 04:00
    const plus8 = parseDateTime('2026-01-01T12:00:00.000+08:00');
    expect(plus8?.getTime()).toBe(Date.UTC(2026, 0, 1, 4, 0, 0, 0));

    // -05:30 的 12:00 == UTC 17:30
    const minus530 = parseDateTime('2026-01-01T12:00:00.000-05:30');
    expect(minus530?.getTime()).toBe(Date.UTC(2026, 0, 1, 17, 30, 0, 0));
  });

  it('小数秒截断到毫秒位；非字符串一律拒绝', () => {
    const fraction = parseDateTime('2026-01-01T00:00:00.123456Z');
    expect(fraction?.getTime()).toBe(Date.UTC(2026, 0, 1, 0, 0, 0, 123));
    expect(parseDateTime(123)).toBeNull();
    expect(parseDateTime(null)).toBeNull();
    expect(parseDateTime(undefined)).toBeNull();
    expect(parseDateTime({})).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// B-01/B-02：validatePlanResolution 五必填字段 + 身份精确核对
// ---------------------------------------------------------------------------

const VALID_BINDING: MembershipPlanResolutionBinding = {
  membership_plan_ref: 'plan-a',
  name: '方案A',
  benefit_refs: ['benefit-1', 'benefit-2'],
  commercial_terms_ref: 'terms-a',
  state: 'active',
};

describe('B-01/B-02 validatePlanResolution', () => {
  it('完整且身份精确匹配且 active -> ok', () => {
    expect(validatePlanResolution(VALID_BINDING, 'plan-a')).toEqual({ ok: true });
  });

  it('B-01：请求 plan-a 返回 plan-b（即使 active）-> PLAN_REF_MISMATCH', () => {
    const other: MembershipPlanResolutionBinding = {
      ...VALID_BINDING,
      membership_plan_ref: 'plan-b',
    };
    expect(validatePlanResolution(other, 'plan-a')).toEqual({
      ok: false,
      reason: 'PLAN_REF_MISMATCH',
    });
  });

  it('身份核对先于 state：精确匹配但 inactive -> PLAN_NOT_ACTIVE', () => {
    const inactive: MembershipPlanResolutionBinding = {
      ...VALID_BINDING,
      state: 'inactive',
    };
    expect(validatePlanResolution(inactive, 'plan-a')).toEqual({
      ok: false,
      reason: 'PLAN_NOT_ACTIVE',
    });
  });

  it('身份不匹配且非 active，仍优先报 PLAN_REF_MISMATCH', () => {
    const otherInactive: MembershipPlanResolutionBinding = {
      ...VALID_BINDING,
      membership_plan_ref: 'plan-b',
      state: 'inactive',
    };
    expect(validatePlanResolution(otherInactive, 'plan-a')).toEqual({
      ok: false,
      reason: 'PLAN_REF_MISMATCH',
    });
  });

  it('B-02：逐一删除 5 个必填字段均判 MALFORMED_BINDING', () => {
    const keys = [
      'membership_plan_ref',
      'name',
      'benefit_refs',
      'commercial_terms_ref',
      'state',
    ] as const;
    for (const key of keys) {
      const malformed = { ...VALID_BINDING } as Record<string, unknown>;
      delete malformed[key];
      expect(validatePlanResolution(malformed, 'plan-a')).toEqual({
        ok: false,
        reason: 'MALFORMED_BINDING',
      });
    }
  });

  it('B-02：多出未声明字段、字段类型错误、benefit_refs 重复 -> MALFORMED_BINDING', () => {
    const extra = { ...VALID_BINDING, unexpected: 'x' } as Record<string, unknown>;
    expect(validatePlanResolution(extra, 'plan-a')).toEqual({
      ok: false,
      reason: 'MALFORMED_BINDING',
    });

    const wrongNameType = { ...VALID_BINDING, name: 123 };
    expect(validatePlanResolution(wrongNameType, 'plan-a')).toEqual({
      ok: false,
      reason: 'MALFORMED_BINDING',
    });

    const benefitsNotArray = { ...VALID_BINDING, benefit_refs: 'benefit-1' };
    expect(validatePlanResolution(benefitsNotArray, 'plan-a')).toEqual({
      ok: false,
      reason: 'MALFORMED_BINDING',
    });

    const benefitsWrongElement = { ...VALID_BINDING, benefit_refs: ['b-1', 2] };
    expect(validatePlanResolution(benefitsWrongElement, 'plan-a')).toEqual({
      ok: false,
      reason: 'MALFORMED_BINDING',
    });

    const benefitsDuplicate = {
      ...VALID_BINDING,
      benefit_refs: ['b-1', 'b-1'],
    };
    expect(validatePlanResolution(benefitsDuplicate, 'plan-a')).toEqual({
      ok: false,
      reason: 'MALFORMED_BINDING',
    });

    const badState = { ...VALID_BINDING, state: 'draft' };
    expect(validatePlanResolution(badState, 'plan-a')).toEqual({
      ok: false,
      reason: 'MALFORMED_BINDING',
    });

    expect(validatePlanResolution(null, 'plan-a')).toEqual({
      ok: false,
      reason: 'MALFORMED_BINDING',
    });
    expect(validatePlanResolution([VALID_BINDING], 'plan-a')).toEqual({
      ok: false,
      reason: 'MALFORMED_BINDING',
    });
  });
});

// ---------------------------------------------------------------------------
// B-06/B-07：validateOperationRequest 九 Operation 请求 Schema 投影
// ---------------------------------------------------------------------------

const VALID_REQUESTS: Record<OperationId, Record<string, unknown>> = {
  create_member: {
    member_identity: { identity_namespace: 'ns', identity_value: 'v-1' },
    registration_profile: { display_name: '张三' },
  },
  resolve_member: { member_ref: 'mem_1' },
  update_member_profile: {
    member_ref: 'mem_1',
    profile_changes: { display_name: '李四' },
  },
  update_member_status: { member_ref: 'mem_1', target_status: 'terminated' },
  create_membership: { member_ref: 'mem_1', plan_ref: 'plan-a' },
  update_membership_plan: {
    member_ref: 'mem_1',
    current_membership_ref: 'msh_1',
    target_plan_ref: 'plan-b',
  },
  lookup_membership: { member_ref: 'mem_1' },
  evaluate_membership_eligibility: {
    member_ref: 'mem_1',
    check_purpose: 'membership_validity',
    decision_time: '2026-02-15T00:00:00.000Z',
  },
  resolve_membership: { membership_ref: 'msh_1' },
};

describe('B-06/B-07 validateOperationRequest', () => {
  it('9 个 Operation 的合法最小请求全部通过', () => {
    for (const operationId of Object.keys(VALID_REQUESTS) as OperationId[]) {
      expect(
        validateOperationRequest(operationId, VALID_REQUESTS[operationId]),
      ).toEqual({ ok: true });
    }
  });

  it('非对象负载 -> required', () => {
    expect(validateOperationRequest('create_member', null)).toEqual({
      ok: false,
      category: 'required',
    });
    expect(validateOperationRequest('create_member', 'x')).toEqual({
      ok: false,
      category: 'required',
    });
  });

  it('顶层未知字段一律拒绝（additionalProperties:false）', () => {
    for (const operationId of Object.keys(VALID_REQUESTS) as OperationId[]) {
      const withUnknown = { ...VALID_REQUESTS[operationId], bogus: 1 };
      const result = validateOperationRequest(operationId, withUnknown);
      expect(result.ok).toBe(false);
    }
  });

  it('create_member：嵌套未知字段与空标识按身份/必填类别拒绝', () => {
    const identityUnknown = {
      ...VALID_REQUESTS.create_member,
      member_identity: {
        identity_namespace: 'ns',
        identity_value: 'v-1',
        unexpected: 1,
      },
    };
    expect(validateOperationRequest('create_member', identityUnknown)).toEqual({
      ok: false,
      category: 'identity',
    });

    const emptyNamespace = {
      ...VALID_REQUESTS.create_member,
      member_identity: { identity_namespace: '', identity_value: 'v-1' },
    };
    expect(validateOperationRequest('create_member', emptyNamespace)).toEqual({
      ok: false,
      category: 'identity',
    });

    const profileUnknown = {
      ...VALID_REQUESTS.create_member,
      registration_profile: { display_name: '张三', role: 'admin' },
    };
    expect(validateOperationRequest('create_member', profileUnknown)).toEqual({
      ok: false,
      category: 'required',
    });

    const missingDisplayName = {
      ...VALID_REQUESTS.create_member,
      registration_profile: {},
    };
    expect(
      validateOperationRequest('create_member', missingDisplayName),
    ).toEqual({ ok: false, category: 'required' });

    const badEmail = {
      ...VALID_REQUESTS.create_member,
      registration_profile: { display_name: '张三', contact_email: 'not-an-email' },
    };
    expect(validateOperationRequest('create_member', badEmail)).toEqual({
      ok: false,
      category: 'required',
    });
  });

  it('resolve_member：空 member_ref -> identity；缺失 -> required', () => {
    expect(
      validateOperationRequest('resolve_member', { member_ref: '' }),
    ).toEqual({ ok: false, category: 'identity' });
    expect(validateOperationRequest('resolve_member', {})).toEqual({
      ok: false,
      category: 'required',
    });
  });

  it('update_member_profile：未授权字段 -> field_policy', () => {
    const protectedField = {
      member_ref: 'mem_1',
      profile_changes: { member_status: 'terminated' },
    };
    expect(
      validateOperationRequest('update_member_profile', protectedField),
    ).toEqual({ ok: false, category: 'field_policy' });

    const emptyChanges = { member_ref: 'mem_1', profile_changes: {} };
    expect(
      validateOperationRequest('update_member_profile', emptyChanges),
    ).toEqual({ ok: false, category: 'required' });
  });

  it('B-07：reason 空串/非字符串拒绝，缺省合法（minLength:1 不做 trim）', () => {
    const emptyReason = {
      member_ref: 'mem_1',
      target_status: 'terminated',
      reason: '',
    };
    expect(
      validateOperationRequest('update_member_status', emptyReason),
    ).toEqual({ ok: false, category: 'required' });

    const nonStringReason = {
      member_ref: 'mem_1',
      target_status: 'terminated',
      reason: 123,
    };
    expect(
      validateOperationRequest('update_member_status', nonStringReason),
    ).toEqual({ ok: false, category: 'required' });

    // 纯空白不是空串：minLength:1 仅按字符数判定
    const whitespaceReason = {
      member_ref: 'mem_1',
      target_status: 'terminated',
      reason: ' ',
    };
    expect(
      validateOperationRequest('update_member_status', whitespaceReason),
    ).toEqual({ ok: true });

    expect(
      validateOperationRequest('update_member_status', {
        member_ref: 'mem_1',
        target_status: 'terminated',
        reason: '用户注销',
      }),
    ).toEqual({ ok: true });
  });

  it('update_member_status：非法枚举 -> enum', () => {
    expect(
      validateOperationRequest('update_member_status', {
        member_ref: 'mem_1',
        target_status: 'paused',
      }),
    ).toEqual({ ok: false, category: 'enum' });
  });

  it('create_membership：非法时间 -> time；空 plan_ref -> required', () => {
    expect(
      validateOperationRequest('create_membership', {
        member_ref: 'mem_1',
        plan_ref: 'plan-a',
        requested_effective_time: '2026-02-30T00:00:00.000Z',
      }),
    ).toEqual({ ok: false, category: 'time' });

    expect(
      validateOperationRequest('create_membership', {
        member_ref: 'mem_1',
        plan_ref: '',
      }),
    ).toEqual({ ok: false, category: 'required' });
  });

  it('lookup_membership：非法 as_of_time -> time', () => {
    expect(
      validateOperationRequest('lookup_membership', {
        member_ref: 'mem_1',
        as_of_time: 'garbage',
      }),
    ).toEqual({ ok: false, category: 'time' });
  });

  it('evaluate：不支持的用途 -> enum；非法决策时点 -> time；缺要素 -> required', () => {
    expect(
      validateOperationRequest('evaluate_membership_eligibility', {
        member_ref: 'mem_1',
        check_purpose: 'benefit_usage',
        decision_time: '2026-02-15T00:00:00.000Z',
      }),
    ).toEqual({ ok: false, category: 'enum' });

    expect(
      validateOperationRequest('evaluate_membership_eligibility', {
        member_ref: 'mem_1',
        check_purpose: 'membership_validity',
        decision_time: '2026-02-30T00:00:00.000Z',
      }),
    ).toEqual({ ok: false, category: 'time' });

    expect(
      validateOperationRequest('evaluate_membership_eligibility', {
        member_ref: 'mem_1',
        check_purpose: 'membership_validity',
      }),
    ).toEqual({ ok: false, category: 'required' });
  });

  it('resolve_membership：空 membership_ref -> ref_required', () => {
    expect(
      validateOperationRequest('resolve_membership', { membership_ref: '' }),
    ).toEqual({ ok: false, category: 'ref_required' });
  });
});
