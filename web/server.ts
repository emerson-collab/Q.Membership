/**
 * Member 能力 Web 演示层 — HTTP 服务入口
 *
 * 边界声明（务必阅读）：
 *  - 本文件是【本地演示】用的网页适配层，不是生产执行入口、不是已批准的
 *    external_provider_surface。它不新增任何会员业务语义。
 *  - 后台业务逻辑 100% 复用 src/p1/member/**（经 src/p1/export/member/client.ts 的
 *    MemberCapabilityClient 装配），本文件只做：HTTP 编解码、上下文信封组装、
 *    演示授权注入、静态资源与只读巡检视图。
 *  - 契约默认授权为 DENY（trustedEntryAuthorizer 恒 false，PD-6 未确认）。因此这里
 *    显式注入 webEntryAuthorizer 以允许 9 个已声明 operation；它【不代表】生产授权，
 *    也未改动 src/p1 的任何授权语义。Operation 09 仍受 hasInternalPurpose 守卫：
 *    只有显式提供 internal purpose 才会被放行，否则如实返回 OPERATION_NOT_AUTHORIZED。
 *  - 零第三方依赖：HTTP 用 node:http；前端 TS 用 node:module.stripTypeScriptTypes 剥离后下发。
 */

import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { randomUUID } from 'node:crypto';

import {
  InMemoryMemberRepository,
  staticMembershipPlanProvider,
} from '../src/p1/export/member/client.ts';
import { JsonFileMemberRepository } from './json_file_repository.ts';
import {
  ALL_OPERATION_IDS,
  INTERNAL_OPERATION_IDS,
  PUBLIC_OPERATION_IDS,
  STABLE_ERROR_CODE_SETS,
  STABLE_ERROR_MESSAGES,
} from '../src/p1/export/member/contracts.ts';
import type {
  CallContext,
  CallOutcome,
  MemberStatusEvent,
  MembershipPlanResolutionBinding,
  MembershipRelationEvent,
  OperationAuthorizer,
  OperationId,
  StoredMember,
  StoredMembership,
} from '../src/p1/export/member/types.ts';
import {
  invoke_business_operation,
  invoke_internal_call,
} from '../src/p1/business_runtime/business_operation_registry.ts';
import type {
  BusinessInternalCallOutcome,
  BusinessOperationOutcome,
} from '../src/p1/business_runtime/business_operation_registry.ts';
import {
  MEMBER_BUSINESS_ROUTES,
  buildMemberRuntimeContext,
  memberInvokePath,
  registerMemberBusinessOperations,
} from '../src/p1/member/business_registration.ts';

// ---------------------------------------------------------------------------
// 一、演示授权器（仅本地演示；非生产授权，不修改 src/p1）
// ---------------------------------------------------------------------------

/** 仅放行契约已声明的 9 个 operation；其余一律拒绝（保持 fail-closed 形状） */
const webEntryAuthorizer: OperationAuthorizer = {
  authorize(input) {
    return (ALL_OPERATION_IDS as readonly string[]).includes(input.operation_id);
  },
};

// ---------------------------------------------------------------------------
// 二、演示方案表（供 MembershipPlanProvider 精确解析）
// ---------------------------------------------------------------------------

const DEMO_PLANS: readonly MembershipPlanResolutionBinding[] = [
  {
    membership_plan_ref: 'plan-basic',
    name: '基础会员方案',
    benefit_refs: ['benefit-basic'],
    commercial_terms_ref: 'terms-basic',
    state: 'active',
  },
  {
    membership_plan_ref: 'plan-premium',
    name: '高级会员方案',
    benefit_refs: ['benefit-premium', 'benefit-priority-support'],
    commercial_terms_ref: 'terms-premium',
    state: 'active',
  },
  {
    membership_plan_ref: 'plan-legacy',
    name: '历史下线方案（state=inactive，用于演示被拒绝）',
    benefit_refs: ['benefit-legacy'],
    commercial_terms_ref: 'terms-legacy',
    state: 'inactive',
  },
];

// ---------------------------------------------------------------------------
// 三、装配（复用 src/p1 既有实现）
// ---------------------------------------------------------------------------

// 仓储选择：默认 JSON 文件持久化（重启不丢数据）；
// MEMBER_DATA_FILE=memory 退回纯内存；MEMBER_DATA_FILE=<路径> 自定义落盘位置。
const dataFileEnv = process.env.MEMBER_DATA_FILE;
const repository =
  dataFileEnv === 'memory'
    ? new InMemoryMemberRepository()
    : new JsonFileMemberRepository(
        resolve(
          dataFileEnv ??
            join(dirname(fileURLToPath(import.meta.url)), 'data', 'member-store.json'),
        ),
      );
const planProvider = staticMembershipPlanProvider(DEMO_PLANS);

// 启动装配：用同一组 deps 实例化 9 个会员 handler，并把它们注册进
// P1 业务运行时注册表（8 个对外 CALL + 1 个仅内部 resolve_membership）。
// 此后网页发起的每个业务都经 invoke_business_operation / invoke_internal_call
// 唯一管线执行，不再直接调用会员能力客户端。
registerMemberBusinessOperations({
  repository,
  planProvider,
  authorizer: webEntryAuthorizer,
});

// 仅用于 /api/inspect 的只读枚举：源码仓储未提供"列出全部"端口，
// 因此在服务端按成功响应的运行结果登记已出现的稳定标识。
const knownMemberRefs = new Set<string>();
const knownMembershipRefs = new Set<string>();

// ---------------------------------------------------------------------------
// 四、分发（operation_id -> P1 业务注册表调用）
// ---------------------------------------------------------------------------

/** 进程内演示绑定集身份（非空 exact ref 即可，P0 只校验存在性） */
const WEB_BINDING_SET_REF = 'Q.MEMBERSHIP.BINDING_SET.WEB_LOCAL@V0104';

/** 注册表 BusinessOperationOutcome => 前端既有的会员 CallOutcome 信封 */
function toWebCallOutcome(outcome: BusinessOperationOutcome): CallOutcome<unknown> {
  if (outcome.outcome_type === 'response') {
    return {
      request_id: outcome.request_id,
      trace_id: outcome.trace_id,
      outcome_type: 'SUCCESS',
      runtime_result: outcome.runtime_result,
    };
  }
  return {
    request_id: outcome.request_id,
    trace_id: outcome.trace_id,
    outcome_type: 'STABLE_ERROR',
    stable_error: outcome.stable_error,
  };
}

/** 内部调用 Outcome（child_request_id）=> 前端既有的会员 CallOutcome 信封 */
function toWebInternalCallOutcome(
  outcome: BusinessInternalCallOutcome,
): CallOutcome<unknown> {
  if (outcome.outcome_type === 'response') {
    return {
      request_id: outcome.child_request_id,
      trace_id: outcome.trace_id,
      outcome_type: 'SUCCESS',
      runtime_result: outcome.runtime_result,
    };
  }
  return {
    request_id: outcome.child_request_id,
    trace_id: outcome.trace_id,
    outcome_type: 'STABLE_ERROR',
    stable_error: outcome.stable_error,
  };
}

/**
 * 经 P1 业务注册表执行一次会员 Operation：
 *  - 对外 8 op：invoke_business_operation（CALL/CALL_INVOKE 精确路由）
 *  - 内部 op09：invoke_internal_call（call_path 起点 + 内部用途证据由
 *    RuntimeContext.attributes 透传，会员 handler 的 hasInternalPurpose 守卫原样生效）
 */
async function dispatchViaRegistry(
  operationId: OperationId,
  request: Record<string, unknown>,
  context: Partial<CallContext>,
): Promise<CallOutcome<unknown>> {
  const route = MEMBER_BUSINESS_ROUTES[operationId];
  const traceId =
    typeof context.trace_id === 'string' && context.trace_id.length > 0
      ? context.trace_id
      : `trc_web_${randomUUID()}`;
  const requestId =
    typeof context.request_id === 'string' && context.request_id.length > 0
      ? context.request_id
      : `req_web_${randomUUID()}`;
  const runtimeContext = buildMemberRuntimeContext(
    route,
    context,
    {
      trace_id: traceId,
      request_id: requestId,
      invocation_id: `inv_${randomUUID()}`,
      binding_set_ref: WEB_BINDING_SET_REF,
    },
  );
  if (route.internal) {
    const outcome = await invoke_internal_call({
      local_route_key: route.operation_ref,
      input: request,
      runtime_context: runtimeContext,
      call_path: [],
      call_depth: 0,
      trace_id: traceId,
      parent_request_id: requestId,
    });
    return toWebInternalCallOutcome(outcome);
  }
  const outcome = await invoke_business_operation(
    memberInvokePath(route, traceId, requestId),
    request,
    runtimeContext,
  );
  return toWebCallOutcome(outcome);
}

// ---------------------------------------------------------------------------
// 五、静态资源（前端 TS 在服务端剥离类型后下发，零构建依赖）
// ---------------------------------------------------------------------------

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), 'public');

let appJsCache: string | null = null;

function appJs(): string {
  if (appJsCache === null) {
    appJsCache = stripTypeScriptTypes(
      readFileSync(join(PUBLIC_DIR, 'app.ts'), 'utf8'),
      { mode: 'strip' },
    );
  }
  return appJsCache;
}

// ---------------------------------------------------------------------------
// 六、只读巡检视图
// ---------------------------------------------------------------------------

interface InspectView {
  members: Array<{
    member_ref: string;
    display_name: string;
    member_status: StoredMember['member_status'];
    created_at: string;
    terminated_at: string | null;
    version: number;
  }>;
  memberships: StoredMembership[];
  member_status_events: MemberStatusEvent[];
  relation_events: MembershipRelationEvent[];
}

async function inspect(): Promise<InspectView> {
  const members: InspectView['members'] = [];
  const memberships: StoredMembership[] = [];
  if (repository instanceof JsonFileMemberRepository) {
    // 持久化仓储：重启后巡检面板依然可见历史数据
    const snap = repository.snapshot();
    for (const stored of snap.members) {
      members.push({
        member_ref: stored.member_ref,
        display_name: stored.display_name,
        member_status: stored.member_status,
        created_at: stored.created_at,
        terminated_at: stored.terminated_at,
        version: stored.version,
      });
    }
    memberships.push(...snap.memberships);
  } else {
    // 内存仓储：仅能枚举本次运行中成功响应里出现过的稳定标识
    for (const ref of knownMemberRefs) {
      const stored = await repository.getMemberByRef(ref);
      if (stored === null) continue;
      members.push({
        member_ref: stored.member_ref,
        display_name: stored.display_name,
        member_status: stored.member_status,
        created_at: stored.created_at,
        terminated_at: stored.terminated_at,
        version: stored.version,
      });
    }
    for (const ref of knownMembershipRefs) {
      const stored = await repository.getMembershipByRef(ref);
      if (stored !== null) memberships.push(stored);
    }
  }
  return {
    members,
    memberships,
    member_status_events: repository.listMemberStatusEvents(),
    relation_events: repository.listRelationEvents(),
  };
}

/** 从成功运行结果中登记稳定标识（仅用于巡检视图，不构成任何业务事实） */
function trackRefs(result: unknown): void {
  if (result === null || typeof result !== 'object') return;
  const record = result as Record<string, unknown>;
  if (typeof record.member_ref === 'string') knownMemberRefs.add(record.member_ref);
  for (const key of ['membership_ref', 'previous_membership_ref']) {
    const value = record[key];
    if (typeof value === 'string') knownMembershipRefs.add(value);
  }
  const single = record.membership;
  if (single !== null && typeof single === 'object') trackRelationView(single);
  const list = record.memberships;
  if (Array.isArray(list)) for (const item of list) trackRelationView(item);
  const member = record.member;
  if (member !== null && typeof member === 'object') {
    const ref = (member as Record<string, unknown>).member_ref;
    if (typeof ref === 'string') knownMemberRefs.add(ref);
  }
}

function trackRelationView(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  if (typeof record.membership_ref === 'string') {
    knownMembershipRefs.add(record.membership_ref);
  }
  if (typeof record.member_ref === 'string') knownMemberRefs.add(record.member_ref);
}

// ---------------------------------------------------------------------------
// 七、HTTP 辅助
// ---------------------------------------------------------------------------

const MAX_BODY_BYTES = 1024 * 1024;

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendText(
  res: ServerResponse,
  status: number,
  contentType: string,
  body: string,
): void {
  res.writeHead(status, {
    'content-type': `${contentType}; charset=utf-8`,
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, rejectBody) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        rejectBody(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', rejectBody);
  });
}

/** 从 UI 请求体中提取信封字段；purpose 仅用于 Operation 09 的内部用途证据 */
function toEnvelopeContext(raw: unknown): Partial<CallContext> {
  const context: Partial<CallContext> = {};
  if (raw === null || typeof raw !== 'object') return context;
  const record = raw as Record<string, unknown>;
  if (typeof record.request_id === 'string' && record.request_id.length > 0) {
    context.request_id = record.request_id;
  }
  if (typeof record.trace_id === 'string' && record.trace_id.length > 0) {
    context.trace_id = record.trace_id;
  }
  if (typeof record.commit_time === 'string' && record.commit_time.length > 0) {
    context.commit_time = record.commit_time;
  }
  if (
    typeof record.purpose === 'string' &&
    record.purpose.trim().length > 0
  ) {
    context.internal_invocation = {
      purpose: record.purpose,
      permitted: true,
    };
  }
  return context;
}

// ---------------------------------------------------------------------------
// 八、路由
// ---------------------------------------------------------------------------

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;

  if (req.method === 'GET' && path === '/') {
    sendText(res, 200, 'text/html', readFileSync(join(PUBLIC_DIR, 'index.html'), 'utf8'));
    return;
  }
  if (req.method === 'GET' && path === '/app.js') {
    sendText(res, 200, 'application/javascript', appJs());
    return;
  }
  if (req.method === 'GET' && path === '/api/meta') {
    sendJson(res, 200, {
      contract_ref: 'Q.MEMBERSHIP.CONTRACT.CAPABILITY.MEMBER@V0104',
      public_operation_ids: PUBLIC_OPERATION_IDS,
      internal_operation_ids: INTERNAL_OPERATION_IDS,
      stable_error_code_sets: STABLE_ERROR_CODE_SETS,
      stable_error_messages: STABLE_ERROR_MESSAGES,
      demo_plans: DEMO_PLANS,
      authorization_note:
        '本地演示授权器仅放行已声明 operation；生产授权规则待 PD-6 确认，默认 DENY。',
    });
    return;
  }
  if (req.method === 'GET' && path === '/api/inspect') {
    sendJson(res, 200, await inspect());
    return;
  }

  if (req.method === 'POST' && path.startsWith('/api/')) {
    const operationId = path.slice('/api/'.length);
    if (!(ALL_OPERATION_IDS as readonly string[]).includes(operationId)) {
      sendJson(res, 400, {
        error: 'UNKNOWN_OPERATION_ID',
        detail: `未声明的 operation_id: ${operationId}`,
      });
      return;
    }
    let body: unknown;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      sendJson(res, 400, { error: 'INVALID_JSON_BODY' });
      return;
    }
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      sendJson(res, 400, { error: 'INVALID_REQUEST_ENVELOPE' });
      return;
    }
    const envelope = body as Record<string, unknown>;
    const request =
      envelope.request !== undefined &&
      envelope.request !== null &&
      typeof envelope.request === 'object' &&
      !Array.isArray(envelope.request)
        ? (envelope.request as Record<string, unknown>)
        : {};
    const context = toEnvelopeContext(envelope.context);
    const outcome = await dispatchViaRegistry(operationId as OperationId, request, context);
    if (outcome.outcome_type === 'SUCCESS') {
      trackRefs(outcome.runtime_result);
    }
    sendJson(res, 200, outcome);
    return;
  }

  sendJson(res, 404, { error: 'NOT_FOUND', path });
}

// ---------------------------------------------------------------------------
// 九、启动
// ---------------------------------------------------------------------------

export function createMemberWebServer(): Server {
  return createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      if (!res.headersSent) {
        sendJson(res, 500, {
          error: 'WEB_ADAPTER_FAILURE',
          detail: error instanceof Error ? error.message : String(error),
        });
      } else {
        res.end();
      }
    });
  });
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return resolve(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  const port = Number(process.env.PORT ?? 8787);
  createMemberWebServer().listen(port, '127.0.0.1', () => {
    console.log(`Member 能力 Web 演示层: http://127.0.0.1:${port}/`);
    if (repository instanceof JsonFileMemberRepository) {
      console.log(`数据持久化: JSON 文件仓储（重启不丢数据）`);
    } else {
      console.log('提示：数据仅存于进程内存，重启即清空。');
    }
  });
}
