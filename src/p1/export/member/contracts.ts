/**
 * 统一会员能力 V0103 — 契约常量、稳定错误与运行时工具
 * 来源：Q.MEMBERSHIP.CONTRACT.CAPABILITY.MEMBER@V0103#/stable_errors 及 capability_rules
 */

import type {
  CallContext,
  CallOutcome,
  OperationAuthorizer,
  OperationId,
  StableErrorPayload,
} from './types';

// ---------------------------------------------------------------------------
// 一、Operation 清单（8 对外 + 1 内部）
// ---------------------------------------------------------------------------

export const PUBLIC_OPERATION_IDS = [
  'create_member',
  'resolve_member',
  'update_member_profile',
  'update_member_status',
  'create_membership',
  'update_membership_plan',
  'lookup_membership',
  'evaluate_membership_eligibility',
] as const;

export const INTERNAL_OPERATION_IDS = ['resolve_membership'] as const;

export const ALL_OPERATION_IDS: readonly OperationId[] = [
  ...PUBLIC_OPERATION_IDS,
  ...INTERNAL_OPERATION_IDS,
];

// ---------------------------------------------------------------------------
// 二、各 Operation 封闭稳定错误码集合（unknown_error_code_forbidden: true）
// ---------------------------------------------------------------------------

export const STABLE_ERROR_CODE_SETS = {
  create_member: [
    'MEMBER_IDENTITY_MISSING',
    'MEMBER_DUPLICATE_REGISTRATION',
    'OPERATION_NOT_AUTHORIZED',
    'DEPENDENCY_INFORMATION_INCOMPLETE',
    'CONCURRENT_MODIFICATION_CONFLICT',
    'MEMBERSHIP_REQUIRED_INPUT_MISSING',
  ],
  resolve_member: [
    'MEMBER_IDENTITY_MISSING',
    'MEMBER_NOT_FOUND',
    'OPERATION_NOT_AUTHORIZED',
    'MEMBERSHIP_REQUIRED_INPUT_MISSING',
  ],
  update_member_profile: [
    'MEMBER_IDENTITY_MISSING',
    'MEMBER_NOT_FOUND',
    'MEMBER_PROFILE_FIELD_NOT_MODIFIABLE',
    'OPERATION_NOT_AUTHORIZED',
    'DEPENDENCY_INFORMATION_INCOMPLETE',
    'CONCURRENT_MODIFICATION_CONFLICT',
    'MEMBERSHIP_REQUIRED_INPUT_MISSING',
  ],
  update_member_status: [
    'MEMBER_IDENTITY_MISSING',
    'MEMBER_NOT_FOUND',
    'INVALID_STATE_TRANSITION',
    'OPERATION_NOT_AUTHORIZED',
    'CONCURRENT_MODIFICATION_CONFLICT',
    'MEMBERSHIP_REQUIRED_INPUT_MISSING',
  ],
  create_membership: [
    'MEMBER_IDENTITY_MISSING',
    'MEMBER_NOT_FOUND',
    'MEMBERSHIP_PLAN_NOT_FOUND',
    'OPERATION_NOT_AUTHORIZED',
    'DEPENDENCY_INFORMATION_INCOMPLETE',
    'CONCURRENT_MODIFICATION_CONFLICT',
    'MEMBERSHIP_REQUIRED_INPUT_MISSING',
    'INVALID_BUSINESS_TIME',
    'INVALID_STATE_TRANSITION',
    'MEMBERSHIP_RELATION_CONFLICT',
  ],
  update_membership_plan: [
    'MEMBER_IDENTITY_MISSING',
    'MEMBER_NOT_FOUND',
    'MEMBERSHIP_PLAN_NOT_FOUND',
    'INVALID_STATE_TRANSITION',
    'OPERATION_NOT_AUTHORIZED',
    'CONCURRENT_MODIFICATION_CONFLICT',
    'MEMBERSHIP_REQUIRED_INPUT_MISSING',
    'INVALID_BUSINESS_TIME',
    'MEMBERSHIP_NOT_FOUND',
    'MEMBERSHIP_RELATION_CONFLICT',
    'DEPENDENCY_INFORMATION_INCOMPLETE',
  ],
  lookup_membership: [
    'MEMBER_IDENTITY_MISSING',
    'MEMBER_NOT_FOUND',
    'OPERATION_NOT_AUTHORIZED',
    'MEMBERSHIP_REQUIRED_INPUT_MISSING',
    'INVALID_BUSINESS_TIME',
    'DEPENDENCY_INFORMATION_INCOMPLETE',
  ],
  evaluate_membership_eligibility: [
    'MEMBER_IDENTITY_MISSING',
    'MEMBER_NOT_FOUND',
    'DEPENDENCY_INFORMATION_INCOMPLETE',
    'OPERATION_NOT_AUTHORIZED',
    'MEMBERSHIP_REQUIRED_INPUT_MISSING',
    'INVALID_BUSINESS_TIME',
  ],
  resolve_membership: [
    'MEMBERSHIP_REF_REQUIRED',
    'MEMBERSHIP_NOT_FOUND',
    'OPERATION_NOT_AUTHORIZED',
    'MEMBERSHIP_REQUIRED_INPUT_MISSING',
  ],
} as const satisfies Record<OperationId, readonly string[]>;

/** 契约声明的错误码官方中文消息 */
export const STABLE_ERROR_MESSAGES: Record<string, string> = {
  MEMBER_IDENTITY_MISSING: '请求未携带已声明的会员标识，无法定位业务主体',
  MEMBER_DUPLICATE_REGISTRATION:
    '违反重复注册规则，未建立新会员身份（判定口径待 PD-1）',
  OPERATION_NOT_AUTHORIZED:
    '授权规则待业务确认（PD-6），默认拒绝；权限不满足时不返回未经授权数据',
  DEPENDENCY_INFORMATION_INCOMPLETE:
    '完成判定所需的必填依据（如资格判定五要素）不完整',
  CONCURRENT_MODIFICATION_CONFLICT:
    '同一业务对象的并发修改冲突；重试与幂等策略待 PD-8',
  MEMBERSHIP_REQUIRED_INPUT_MISSING:
    '请求违反该 Operation 已声明的必填字段要求。',
  MEMBER_NOT_FOUND: '按已声明标识未找到会员；存在性 ≠ 关系有效 ≠ 具权益',
  MEMBER_PROFILE_FIELD_NOT_MODIFIABLE:
    'OP3 确认语义——拒绝越权或非法字段修改；稳定标识不得因修改变化',
  INVALID_STATE_TRANSITION:
    '目标状态或迁移不在已定义迁移规则内；迁移表确认前一律 FAIL_CLOSED（PD-4）',
  MEMBERSHIP_PLAN_NOT_FOUND:
    '目标会员方案不存在或不可适用于该会员（方案所有权待 PD-2）',
  INVALID_BUSINESS_TIME:
    'Requested business time violates the explicitly declared effective-time boundary.',
  MEMBERSHIP_RELATION_CONFLICT:
    '拟生效时点已经存在生效关系或形成不可唯一解释的重叠区间。',
  MEMBERSHIP_NOT_FOUND:
    '给定旧关系标识不存在或无法精确解析为属于该会员的关系。',
  MEMBERSHIP_REF_REQUIRED: 'membership_ref 不能为空。',
};

// ---------------------------------------------------------------------------
// 三、StableError 运行时载体
// ---------------------------------------------------------------------------

export class StableError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? STABLE_ERROR_MESSAGES[code] ?? code);
    this.name = 'StableError';
    this.code = code;
  }

  toPayload(): StableErrorPayload {
    return { code: this.code, message: this.message };
  }
}

/** 断言错误码属于该 Operation 的封闭集合（provider PRESERVE_EXACT 透传除外） */
export function stableError<TOperation extends OperationId>(
  operationId: TOperation,
  code: (typeof STABLE_ERROR_CODE_SETS)[TOperation][number],
): StableError {
  // V0117: the selected Operation's closed stable-error set is authoritative.
  if (!(STABLE_ERROR_CODE_SETS[operationId] as readonly string[]).includes(code)) {
    throw new TypeError(
      `Undeclared stable error for exact Operation ${operationId}: ${code}`,
    );
  }
  return new StableError(code);
}

/**
 * No dependency is allowed to widen an Operation-local StableError carrier.
 * Preserve exact provider code/message only if already admitted by the
 * receiving Operation's declared closed set. Unknown codes cannot be
 * fabricated as Member business facts: reject before returning an outcome.
 * This verifies the output carrier, not unresolved Provider authority proof.
 */
export function preserveExactProviderStableError(
  operationId: OperationId,
  payload: StableErrorPayload,
): StableError {
  if (
    payload === null ||
    typeof payload !== 'object' ||
    typeof payload.code !== 'string' ||
    typeof payload.message !== 'string' ||
    payload.message.length === 0 ||
    !(STABLE_ERROR_CODE_SETS[operationId] as readonly string[]).includes(payload.code)
  ) {
    throw new TypeError(
      `Provider stable error is outside exact Member Operation ${operationId} closure`,
    );
  }
  return new StableError(payload.code, payload.message);
}

// ---------------------------------------------------------------------------
// 四、Outcome 构造
// ---------------------------------------------------------------------------

export function succeed<T>(
  context: CallContext,
  runtimeResult: T,
): CallOutcome<T> {
  return {
    request_id: context.request_id,
    trace_id: context.trace_id,
    outcome_type: 'SUCCESS',
    runtime_result: runtimeResult,
  };
}

export function fail<T = never>(
  context: CallContext,
  error: StableError,
): CallOutcome<T> {
  return {
    request_id: context.request_id,
    trace_id: context.trace_id,
    outcome_type: 'STABLE_ERROR',
    stable_error: error.toPayload(),
  };
}

// ---------------------------------------------------------------------------
// 五、默认授权器：可信入口证据校验（PD-6 候选；默认 DENY，绝不臆造允许规则）
// ---------------------------------------------------------------------------

export const trustedEntryAuthorizer: OperationAuthorizer = {
  // V0117: caller-attested actor/issuer/operations are not an exact
  // actor-class, authorization-rule and permission authority binding.
  // Without an owner-authorized verifier the only valid outcome is DENY.
  authorize() {
    return false;
  },
};

/** 内部 Operation 额外要求：明确、被允许的内部业务用途 */
export function hasInternalPurpose(context: CallContext): boolean {
  const internal = context.internal_invocation;
  return (
    !!internal &&
    internal.permitted === true &&
    typeof internal.purpose === 'string' &&
    internal.purpose.trim().length > 0
  );
}

// ---------------------------------------------------------------------------
// 六、纯工具：字段、时间、标识
// ---------------------------------------------------------------------------

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** 长度在闭区间内的非空字符串（min 固定 1，与契约 minLength 一致） */
export function isBoundedString(
  value: unknown,
  maxLength: number,
): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= maxLength
  );
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 3 &&
    value.length <= 320 &&
    EMAIL_PATTERN.test(value)
  );
}

// 仅用于词法快速过滤；真实日历有效性必须由 parseDateTime 手工核验，
// 禁止依赖 Date.parse 对 2026-02-30 这类非法日期做静默归一化（B-08）。
const ISO_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month1Based: number): number {
  const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;
  if (month1Based === 2) return isLeapYear(year) ? 29 : 28;
  return DAYS[month1Based - 1]!;
}

/**
 * 严格解析 JSON Schema date-time（RFC 3339 子集）：
 * 逐分量核验年/月/闰年/日界/时分秒与时区偏移，非法日期（如 2026-02-30、
 * 2025-02-29、25:00:00）一律返回 null，绝不做 JS Date 静默归一化。
 * 支持 Z 及 ±HH:MM 合法偏移并精确折算为 UTC 时点。
 */
export function parseDateTime(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const match = ISO_DATE_TIME_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const fraction = match[7] as string | undefined;
  const zone = match[8] as string;

  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;

  let offsetMs = 0;
  if (zone !== 'Z') {
    const sign = zone[0] === '+' ? 1 : -1;
    const offsetHour = Number(zone.slice(1, 3));
    const offsetMinute = Number(zone.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) return null;
    offsetMs = sign * (offsetHour * 60 + offsetMinute) * 60_000;
  }

  let fractionMs = 0;
  if (fraction !== undefined) {
    // 截断到毫秒位；不足三位右侧补零
    fractionMs = Number((fraction + '000').slice(0, 3));
  }

  const utcMs =
    Date.UTC(year, month - 1, day, hour, minute, second, fractionMs) -
    offsetMs;
  if (Number.isNaN(utcMs)) return null;
  return new Date(utcMs);
}

export function toEpoch(value: string): number {
  const parsed = parseDateTime(value);
  if (parsed === null) {
    throw new Error(`invalid date-time value: ${value}`);
  }
  return parsed.getTime();
}

export function defaultClock(): string {
  return new Date().toISOString();
}

/** 生成不可变会员稳定标识 */
export function generateMemberRef(): string {
  return `mem_${randomUuid()}`;
}

/** 生成不可变会员关系稳定标识 */
export function generateMembershipRef(): string {
  return `msh_${randomUuid()}`;
}

export function generateEventRef(prefix: string): string {
  return `${prefix}_${randomUuid()}`;
}

function randomUuid(): string {
  const cryptoObj = (
    globalThis as { crypto?: { randomUUID?: () => string } }
  ).crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  // 无 Web Crypto 环境下的 RFC 4122 v4 回退
  const bytes = new Array<number>(16);
  for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x4f) | 0x40;
  bytes[8] = (bytes[8]! & 0xbf) | 0x80;
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex
    .slice(6, 8)
    .join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

/** 补齐调用信封中缺省的 request_id / trace_id / 时钟 */
export function normalizeCallContext(
  context: Partial<CallContext> | undefined,
  clock: () => string,
): CallContext {
  const resolved: Partial<CallContext> = context ?? {};
  const result: CallContext = {
    request_id: isNonEmptyString(resolved.request_id)
      ? resolved.request_id
      : `req_${randomUuid()}`,
    trace_id: isNonEmptyString(resolved.trace_id)
      ? resolved.trace_id
      : `trc_${randomUuid()}`,
    commit_time: isNonEmptyString(resolved.commit_time)
      ? resolved.commit_time
      : clock(),
  };
  if (resolved.authorization) result.authorization = resolved.authorization;
  if (resolved.internal_invocation) {
    result.internal_invocation = resolved.internal_invocation;
  }
  return result;
}

/** 半开区间判定：[effective_time, termination_time)；null 结束时点表示未结束 */
export function isEffectiveAt(
  effectiveTime: string,
  terminationTime: string | null,
  asOfEpochMs: number,
): boolean {
  if (toEpoch(effectiveTime) > asOfEpochMs) return false;
  if (terminationTime !== null && toEpoch(terminationTime) <= asOfEpochMs) {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// 七、外部方案解析结果校验（R-PLAN-EXISTENCE；B-01/B-02）
// ---------------------------------------------------------------------------

export type PlanBindingIssue =
  | { ok: true }
  /** 结构不完整/字段类型违反 type_closure.schemas.membership_plan_resolution_binding */
  | { ok: false; reason: 'MALFORMED_BINDING' }
  /** 响应方案身份与请求的目标 plan_ref 不精确相同（B-01） */
  | { ok: false; reason: 'PLAN_REF_MISMATCH' }
  /** 精确匹配但 state!=active */
  | { ok: false; reason: 'PLAN_NOT_ACTIVE' };

const PLAN_BINDING_KEYS = [
  'membership_plan_ref',
  'name',
  'benefit_refs',
  'commercial_terms_ref',
  'state',
] as const;

/**
 * 校验 Membership Plan Provider 的精确解析结果：
 *  1) 五个必填属性齐全且符合各自 Schema（additionalProperties:false、
 *     benefit_refs 为去重字符串数组、state 枚举）；
 *  2) 响应 membership_plan_ref 与请求目标 plan_ref 原始值精确相同；
 *  3) state=active。
 * create_membership 与 update_membership_plan 共用同一判定，不各自发明规则。
 */
export function validatePlanResolution(
  binding: unknown,
  requestedPlanRef: string,
): PlanBindingIssue {
  if (
    binding === null ||
    typeof binding !== 'object' ||
    Array.isArray(binding)
  ) {
    return { ok: false, reason: 'MALFORMED_BINDING' };
  }
  const record = binding as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== PLAN_BINDING_KEYS.length) {
    return { ok: false, reason: 'MALFORMED_BINDING' };
  }
  for (const declared of PLAN_BINDING_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(record, declared)) {
      return { ok: false, reason: 'MALFORMED_BINDING' };
    }
  }
  for (const key of keys) {
    if (!(PLAN_BINDING_KEYS as readonly string[]).includes(key)) {
      return { ok: false, reason: 'MALFORMED_BINDING' };
    }
  }
  const {
    membership_plan_ref: ref,
    name,
    benefit_refs: benefits,
    commercial_terms_ref: termsRef,
    state,
  } = record;

  if (!isNonEmptyString(ref)) {
    return { ok: false, reason: 'MALFORMED_BINDING' };
  }
  if (!isNonEmptyString(name)) {
    return { ok: false, reason: 'MALFORMED_BINDING' };
  }
  if (
    !Array.isArray(benefits) ||
    benefits.some((b) => typeof b !== 'string') ||
    new Set(benefits).size !== benefits.length
  ) {
    return { ok: false, reason: 'MALFORMED_BINDING' };
  }
  if (!isNonEmptyString(termsRef)) {
    return { ok: false, reason: 'MALFORMED_BINDING' };
  }
  if (state !== 'active' && state !== 'inactive') {
    return { ok: false, reason: 'MALFORMED_BINDING' };
  }
  // B-01：身份精确核对先于 state 判断；禁止“某方案 active”冒充目标方案
  if (ref !== requestedPlanRef) {
    return { ok: false, reason: 'PLAN_REF_MISMATCH' };
  }
  if (state !== 'active') {
    return { ok: false, reason: 'PLAN_NOT_ACTIVE' };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// 八、Operation Request JSON Schema 校验（B-06/B-07）
// 依据：各 contracts.*_request_contract.schema（JSON_SCHEMA_DRAFT_2020_12）。
// 仅物化契约已声明的 required/type/additionalProperties/minLength/maxLength/
// enum/format；业务枚举的失败错误码由各 handler 按封闭集合映射。
// ---------------------------------------------------------------------------

export type RequestIssueCategory =
  | 'identity'
  | 'required'
  | 'field_policy'
  | 'time'
  | 'enum'
  | 'ref_required';

export type RequestValidationResult =
  | { ok: true }
  | { ok: false; category: RequestIssueCategory };

interface FieldSchema {
  type?: 'string' | 'object' | 'boolean';
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  format?: 'date-time' | 'email';
  enumValues?: readonly string[];
  properties?: Record<string, FieldSchema>;
  additionalProperties?: false;
  minProperties?: number;
  /** 字段缺失时的错误类别 */
  missingCategory?: RequestIssueCategory;
  /** 字段存在但违反约束时的错误类别 */
  invalidCategory?: RequestIssueCategory;
  /** 嵌套对象出现未声明键时的错误类别 */
  unknownCategory?: RequestIssueCategory;
}

const str = (
  opts: Omit<FieldSchema, 'type'> = {},
): FieldSchema => ({ type: 'string', ...opts });

const dateTime = (
  opts: Omit<FieldSchema, 'type' | 'format' | 'minLength'> = {},
): FieldSchema => ({
  type: 'string',
  format: 'date-time',
  minLength: 1,
  ...opts,
});

const email = (): FieldSchema => ({
  type: 'string',
  format: 'email',
  minLength: 3,
  maxLength: 320,
});

/** 9 个 Operation 的请求 Schema（逐字投影契约 contracts 节） */
export const OPERATION_REQUEST_SCHEMAS = {
  create_member: {
    type: 'object',
    additionalProperties: false,
    properties: {
      member_identity: {
        type: 'object',
        required: true,
        additionalProperties: false,
        missingCategory: 'identity',
        invalidCategory: 'identity',
        unknownCategory: 'identity',
        properties: {
          identity_namespace: str({
            required: true,
            minLength: 1,
            maxLength: 128,
            missingCategory: 'identity',
            invalidCategory: 'identity',
          }),
          identity_value: str({
            required: true,
            minLength: 1,
            maxLength: 256,
            missingCategory: 'identity',
            invalidCategory: 'identity',
          }),
        },
      },
      registration_profile: {
        type: 'object',
        required: true,
        additionalProperties: false,
        minProperties: 1,
        missingCategory: 'required',
        invalidCategory: 'required',
        unknownCategory: 'required',
        properties: {
          display_name: str({
            required: true,
            minLength: 1,
            maxLength: 256,
            missingCategory: 'required',
            invalidCategory: 'required',
          }),
          contact_email: { ...email(), invalidCategory: 'required' },
        },
      },
    },
  } satisfies FieldSchema,

  resolve_member: {
    type: 'object',
    additionalProperties: false,
    properties: {
      member_ref: str({
        required: true,
        minLength: 1,
        missingCategory: 'required',
        invalidCategory: 'identity',
      }),
    },
  } satisfies FieldSchema,

  update_member_profile: {
    type: 'object',
    additionalProperties: false,
    properties: {
      member_ref: str({
        required: true,
        minLength: 1,
        missingCategory: 'required',
        invalidCategory: 'identity',
      }),
      profile_changes: {
        type: 'object',
        required: true,
        additionalProperties: false,
        minProperties: 1,
        missingCategory: 'required',
        invalidCategory: 'required',
        unknownCategory: 'field_policy',
        properties: {
          display_name: str({ minLength: 1, maxLength: 256 }),
          contact_email: email(),
        },
      },
    },
  } satisfies FieldSchema,

  update_member_status: {
    type: 'object',
    additionalProperties: false,
    properties: {
      member_ref: str({
        required: true,
        minLength: 1,
        missingCategory: 'required',
        invalidCategory: 'identity',
      }),
      target_status: str({
        required: true,
        enumValues: ['terminated'],
        missingCategory: 'required',
        invalidCategory: 'enum',
      }),
      reason: str({ minLength: 1, invalidCategory: 'required' }),
    },
  } satisfies FieldSchema,

  create_membership: {
    type: 'object',
    additionalProperties: false,
    properties: {
      member_ref: str({
        required: true,
        minLength: 1,
        missingCategory: 'required',
        invalidCategory: 'identity',
      }),
      plan_ref: str({
        required: true,
        minLength: 1,
        missingCategory: 'required',
        invalidCategory: 'required',
      }),
      requested_effective_time: dateTime({
        invalidCategory: 'time',
      }),
    },
  } satisfies FieldSchema,

  update_membership_plan: {
    type: 'object',
    additionalProperties: false,
    properties: {
      member_ref: str({
        required: true,
        minLength: 1,
        missingCategory: 'required',
        invalidCategory: 'identity',
      }),
      current_membership_ref: str({
        required: true,
        minLength: 1,
        missingCategory: 'required',
        invalidCategory: 'required',
      }),
      target_plan_ref: str({
        required: true,
        minLength: 1,
        missingCategory: 'required',
        invalidCategory: 'required',
      }),
      requested_effective_time: dateTime({ invalidCategory: 'time' }),
    },
  } satisfies FieldSchema,

  lookup_membership: {
    type: 'object',
    additionalProperties: false,
    properties: {
      member_ref: str({
        required: true,
        minLength: 1,
        missingCategory: 'required',
        invalidCategory: 'identity',
      }),
      as_of_time: dateTime({ invalidCategory: 'time' }),
    },
  } satisfies FieldSchema,

  evaluate_membership_eligibility: {
    type: 'object',
    additionalProperties: false,
    properties: {
      member_ref: str({
        required: true,
        minLength: 1,
        missingCategory: 'required',
        invalidCategory: 'identity',
      }),
      check_purpose: str({
        required: true,
        enumValues: ['membership_validity'],
        minLength: 1,
        missingCategory: 'required',
        invalidCategory: 'enum',
      }),
      decision_time: dateTime({
        required: true,
        missingCategory: 'required',
        invalidCategory: 'time',
      }),
    },
  } satisfies FieldSchema,

  resolve_membership: {
    type: 'object',
    additionalProperties: false,
    properties: {
      membership_ref: str({
        required: true,
        minLength: 1,
        missingCategory: 'required',
        invalidCategory: 'ref_required',
      }),
    },
  } satisfies FieldSchema,
} as const satisfies Record<OperationId, FieldSchema>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 字段是否随请求实际提供。显式 undefined（JS 调用产物，JSON 线上不存在该键）
 * 与“键不存在”同义，按缺失处理，避免误入枚举/类型分支。
 */
function fieldPresent(container: Record<string, unknown>, key: string): boolean {
  return (
    Object.prototype.hasOwnProperty.call(container, key) &&
    container[key] !== undefined
  );
}

function validateField(
  schema: FieldSchema,
  value: unknown,
  present: boolean,
): RequestValidationResult {
  if (!present) {
    if (schema.required) {
      return { ok: false, category: schema.missingCategory ?? 'required' };
    }
    return { ok: true };
  }

  if (schema.type === 'string') {
    if (typeof value !== 'string') {
      return { ok: false, category: schema.invalidCategory ?? 'required' };
    }
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      return { ok: false, category: schema.invalidCategory ?? 'required' };
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      return { ok: false, category: schema.invalidCategory ?? 'required' };
    }
    if (schema.format === 'date-time' && parseDateTime(value) === null) {
      return { ok: false, category: schema.invalidCategory ?? 'time' };
    }
    if (schema.format === 'email' && !isValidEmail(value)) {
      return { ok: false, category: schema.invalidCategory ?? 'required' };
    }
    if (schema.enumValues && !schema.enumValues.includes(value)) {
      return { ok: false, category: schema.invalidCategory ?? 'enum' };
    }
    return { ok: true };
  }

  if (schema.type === 'object') {
    if (!isPlainObject(value)) {
      return { ok: false, category: schema.invalidCategory ?? 'required' };
    }
    if (schema.additionalProperties === false) {
      const declared = Object.keys(schema.properties ?? {});
      for (const key of Object.keys(value)) {
        if (!fieldPresent(value, key)) continue;
        if (!declared.includes(key)) {
          return { ok: false, category: schema.unknownCategory ?? 'required' };
        }
      }
    }
    if (
      schema.minProperties !== undefined &&
      Object.keys(value).filter((key) => fieldPresent(value, key)).length <
        schema.minProperties
    ) {
      return { ok: false, category: schema.invalidCategory ?? 'required' };
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      const childResult = validateField(
        child,
        value[key],
        fieldPresent(value, key),
      );
      if (!childResult.ok) return childResult;
    }
    return { ok: true };
  }

  if (schema.type === 'boolean') {
    return typeof value === 'boolean'
      ? { ok: true }
      : { ok: false, category: schema.invalidCategory ?? 'required' };
  }

  return { ok: true };
}

/** 按已声明 Request Schema 完整校验直接调用路径上的请求对象（B-06） */
export function validateOperationRequest(
  operationId: OperationId,
  payload: unknown,
): RequestValidationResult {
  if (!isPlainObject(payload)) {
    return { ok: false, category: 'required' };
  }
  const root = OPERATION_REQUEST_SCHEMAS[operationId] as FieldSchema;
  for (const [key, child] of Object.entries(root.properties ?? {})) {
    const result = validateField(
      child,
      payload[key],
      fieldPresent(payload, key),
    );
    if (!result.ok) return result;
  }
  if (root.additionalProperties === false) {
    const declared = Object.keys(root.properties ?? {});
    for (const key of Object.keys(payload)) {
      if (!fieldPresent(payload, key)) continue;
      if (!declared.includes(key)) {
        return { ok: false, category: 'required' };
      }
    }
  }
  return { ok: true };
}
