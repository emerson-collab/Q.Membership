/**
 * Member 能力 Web 演示层 — 浏览器侧脚本
 *
 * 说明：本文件是 TypeScript 源码，由 web/server.ts 在同源 /app.js 上
 * 使用 node:module.stripTypeScriptTypes 剥离类型后下发，因此：
 *  - 只使用"可被剥离"的语法（不使用 enum / namespace / 参数属性 / 装饰器）；
 *  - 不引入任何第三方库，全部为原生 DOM + fetch。
 * 本层不新增业务语义：请求体直接对应契约 *_request，响应体直接是契约 CallOutcome。
 */

// ---------------------------------------------------------------------------
// 规格描述
// ---------------------------------------------------------------------------

interface FieldSpec {
  /** 点号路径，与契约请求对象结构一一对应 */
  key: string;
  label: string;
  placeholder?: string;
  /** 预置且只读的固定取值（枚举/本稿固定项） */
  value?: string;
  datalist?: string[];
}

interface OpSpec {
  id: string;
  index: string;
  title: string;
  publicity: 'public' | 'internal';
  note?: string;
  fields: FieldSpec[];
}

interface PlanSummary {
  membership_plan_ref: string;
  name: string;
  state: string;
}

interface MetaPayload {
  public_operation_ids: string[];
  internal_operation_ids: string[];
  stable_error_code_sets: Record<string, string[]>;
  stable_error_messages: Record<string, string>;
  demo_plans: PlanSummary[];
}

interface StableErrorPayload {
  code: string;
  message: string;
}

interface CallOutcomeLike {
  request_id: string;
  trace_id: string;
  outcome_type: 'SUCCESS' | 'STABLE_ERROR';
  runtime_result?: unknown;
  stable_error?: StableErrorPayload;
}

interface Card {
  spec: OpSpec;
  root: HTMLElement;
  inputs: Map<string, HTMLInputElement>;
  commitTime: HTMLInputElement;
  internalCheck: HTMLInputElement | null;
  purpose: HTMLInputElement | null;
  button: HTMLButtonElement;
  result: HTMLElement;
}

// ---------------------------------------------------------------------------
// 9 个 Operation 的表单描述（对齐 contracts.*_request_contract）
// ---------------------------------------------------------------------------

const MEMBER_REF_FIELD = (): FieldSpec => ({
  key: 'member_ref',
  label: 'member_ref',
  placeholder: '成员稳定标识，如 mem_xxx',
});

const OPERATIONS: OpSpec[] = [
  {
    id: 'create_member',
    index: '01',
    title: '创建会员',
    publicity: 'public',
    fields: [
      {
        key: 'member_identity.identity_namespace',
        label: 'member_identity.identity_namespace',
        placeholder: '如 email / phone',
      },
      {
        key: 'member_identity.identity_value',
        label: 'member_identity.identity_value',
        placeholder: '身份原始取值（原样精确区分）',
      },
      {
        key: 'registration_profile.display_name',
        label: 'registration_profile.display_name',
        placeholder: '展示名',
      },
      {
        key: 'registration_profile.contact_email',
        label: 'registration_profile.contact_email（可选）',
        placeholder: '可用于演示非法邮箱被拒',
      },
    ],
  },
  {
    id: 'resolve_member',
    index: '02',
    title: '查询会员',
    publicity: 'public',
    note: 'ANY_STATE 读取；响应只披露 display_name，不含 contact_email。',
    fields: [MEMBER_REF_FIELD()],
  },
  {
    id: 'update_member_profile',
    index: '03',
    title: '修改会员资料',
    publicity: 'public',
    note: '仅允许 display_name / contact_email；空改动返回 no_change。',
    fields: [
      MEMBER_REF_FIELD(),
      {
        key: 'profile_changes.display_name',
        label: 'profile_changes.display_name（可选）',
        placeholder: '新展示名',
      },
      {
        key: 'profile_changes.contact_email',
        label: 'profile_changes.contact_email（可选）',
        placeholder: '新邮箱',
      },
    ],
  },
  {
    id: 'update_member_status',
    index: '04',
    title: '变更会员生命周期状态',
    publicity: 'public',
    note: '本版唯一迁移 active→terminated；重复终止返回 INVALID_STATE_TRANSITION。',
    fields: [
      MEMBER_REF_FIELD(),
      { key: 'target_status', label: 'target_status', value: 'terminated' },
      { key: 'reason', label: 'reason（可选）', placeholder: '终止原因' },
    ],
  },
  {
    id: 'create_membership',
    index: '05',
    title: '建立会员与方案的有效关系',
    publicity: 'public',
    note: '半开区间 [effective_time, termination_time)；同一时点最多一条生效关系。',
    fields: [
      MEMBER_REF_FIELD(),
      { key: 'plan_ref', label: 'plan_ref', placeholder: '如 plan-basic', datalist: [] },
      {
        key: 'requested_effective_time',
        label: 'requested_effective_time（可选，date-time）',
        placeholder: '2026-01-01T00:00:00.000Z',
      },
    ],
  },
  {
    id: 'update_membership_plan',
    index: '06',
    title: '以另一方案替换已有会员关系',
    publicity: 'public',
    note: '本稿不含续期；必须严格晚于旧关系开始，旧关系原子置为 replaced。',
    fields: [
      MEMBER_REF_FIELD(),
      {
        key: 'current_membership_ref',
        label: 'current_membership_ref',
        placeholder: '被替换的旧关系标识',
      },
      { key: 'target_plan_ref', label: 'target_plan_ref', placeholder: '如 plan-premium', datalist: [] },
      {
        key: 'requested_effective_time',
        label: 'requested_effective_time（可选，date-time）',
        placeholder: '留空=以提交时点替换',
      },
    ],
  },
  {
    id: 'lookup_membership',
    index: '07',
    title: '按会员与时点查询有效关系',
    publicity: 'public',
    note: 'as_of_time 缺省=查询时点；不得为未来；0 条是权威空结果而非错误。',
    fields: [
      MEMBER_REF_FIELD(),
      {
        key: 'as_of_time',
        label: 'as_of_time（可选，date-time）',
        placeholder: '留空=当前时点',
      },
    ],
  },
  {
    id: 'evaluate_membership_eligibility',
    index: '08',
    title: '按用途及时点判断会员资格',
    publicity: 'public',
    note: '原因优先级：MEMBER_TERMINATED → MEMBERSHIP_VALID → NO_EFFECTIVE_MEMBERSHIP。',
    fields: [
      MEMBER_REF_FIELD(),
      { key: 'check_purpose', label: 'check_purpose', value: 'membership_validity' },
      {
        key: 'decision_time',
        label: 'decision_time（必填，date-time）',
        placeholder: '2026-01-01T00:00:00.000Z',
      },
    ],
  },
  {
    id: 'resolve_membership',
    index: '09',
    title: '按稳定身份精确读取关系',
    publicity: 'internal',
    note: '仅内部：需同时具备操作授权与内部用途证据；未勾选用途将返回 OPERATION_NOT_AUTHORIZED。',
    fields: [
      {
        key: 'membership_ref',
        label: 'membership_ref',
        placeholder: '被精确读取的关系标识',
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// DOM 小工具
// ---------------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let cursor: Record<string, unknown> = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i] as string;
    const next = cursor[key];
    if (next === null || typeof next !== 'object') cursor[key] = {};
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1] as string] = value;
}

// ---------------------------------------------------------------------------
// 状态
// ---------------------------------------------------------------------------

let meta: MetaPayload | null = null;
let activeCard: Card | null = null;
const cards: Card[] = [];
const memberRefChips = new Set<string>();
const membershipRefChips = new Set<string>();

// ---------------------------------------------------------------------------
// 卡片构建
// ---------------------------------------------------------------------------

function buildCard(spec: OpSpec): Card {
  const root = el('section', spec.publicity === 'internal' ? 'card internal' : 'card');
  root.setAttribute('data-op', spec.id);

  const head = el('div', 'card-head');
  head.append(
    el('span', 'idx', spec.index),
    el('span', 'title', spec.title),
    el('span', 'opid', spec.id),
    el(
      'span',
      spec.publicity === 'internal' ? 'tag internal' : 'tag',
      spec.publicity === 'internal' ? '仅内部' : '对外',
    ),
  );
  root.append(head);

  if (spec.note !== undefined) root.append(el('div', 'hint', spec.note));

  const fields = el('div', 'fields');
  const inputs = new Map<string, HTMLInputElement>();
  for (const field of spec.fields) {
    const wrap = el('div');
    wrap.append(el('label', undefined, field.label));
    const input = el('input');
    input.type = 'text';
    input.name = field.key;
    input.autocomplete = 'off';
    if (field.placeholder !== undefined) input.placeholder = field.placeholder;
    if (field.value !== undefined) {
      input.value = field.value;
      input.readOnly = true;
    }
    if (field.datalist !== undefined) {
      const listId = `dl-${spec.id}-${field.key.replace(/\./g, '-')}`;
      input.setAttribute('list', listId);
      const list = el('datalist');
      list.id = listId;
      for (const option of field.datalist) {
        const opt = el('option');
        opt.value = option;
        list.append(opt);
      }
      wrap.append(list);
    }
    wrap.append(input);
    fields.append(wrap);
    inputs.set(field.key, input);
  }

  // 通用：业务提交时点覆盖（对应 CallContext.commit_time）
  const commitWrap = el('div');
  commitWrap.append(el('label', undefined, 'context.commit_time（可选，覆盖业务提交时点）'));
  const commitTime = el('input');
  commitTime.type = 'text';
  commitTime.placeholder = '留空=系统时钟（UTC date-time）';
  commitWrap.append(commitTime);
  fields.append(commitWrap);
  root.append(fields);

  const row = el('div', 'row');
  let internalCheck: HTMLInputElement | null = null;
  let purpose: HTMLInputElement | null = null;
  if (spec.publicity === 'internal') {
    const label = el('label');
    label.style.margin = '0';
    internalCheck = el('input');
    internalCheck.type = 'checkbox';
    label.append(internalCheck, document.createTextNode(' 提供内部用途证据'));
    row.append(label);

    const purposeLabel = el('label');
    purposeLabel.style.margin = '0';
    purpose = el('input');
    purpose.type = 'text';
    purpose.placeholder = 'internal purpose，如 membership_admin_audit';
    purpose.style.width = '240px';
    purposeLabel.append(document.createTextNode('purpose '), purpose);
    row.append(purposeLabel);
  }

  const button = el('button', undefined, '发送');
  row.append(button);
  root.append(row);

  const result = el('div', 'result');
  root.append(result);

  const card: Card = {
    spec,
    root,
    inputs,
    commitTime,
    internalCheck,
    purpose,
    button,
    result,
  };

  button.addEventListener('click', () => {
    void send(card);
  });
  root.addEventListener('focusin', () => {
    activeCard = card;
  });

  return card;
}

// ---------------------------------------------------------------------------
// 请求组装
// ---------------------------------------------------------------------------

function collectRequest(card: Card): Record<string, unknown> {
  const request: Record<string, unknown> = {};
  for (const field of card.spec.fields) {
    if (field.value !== undefined) {
      setPath(request, field.key, field.value);
      continue;
    }
    const input = card.inputs.get(field.key);
    if (input === undefined) continue;
    const raw = input.value.trim();
    if (raw === '') continue; // 可选字段留空即不发送，交由契约校验如实反馈
    setPath(request, field.key, raw);
  }
  return request;
}

function collectContext(card: Card): Record<string, unknown> {
  const context: Record<string, unknown> = {};
  const commitTime = card.commitTime.value.trim();
  if (commitTime !== '') context.commit_time = commitTime;
  if (card.internalCheck !== null && card.internalCheck.checked) {
    const purpose = card.purpose === null ? '' : card.purpose.value.trim();
    if (purpose !== '') context.purpose = purpose;
  }
  return context;
}

// ---------------------------------------------------------------------------
// 调用与渲染
// ---------------------------------------------------------------------------

function renderOutcome(card: Card, outcome: CallOutcomeLike): void {
  const box = card.result;
  box.replaceChildren();
  box.classList.add('show');

  const head = el('div', 'row');
  const ok = outcome.outcome_type === 'SUCCESS';
  head.append(el('span', ok ? 'badge ok' : 'badge err', ok ? 'SUCCESS' : 'STABLE_ERROR'));
  head.append(el('span', 'envelope', `request_id=${outcome.request_id} · trace_id=${outcome.trace_id}`));
  box.append(head);

  if (ok) {
    box.append(el('pre', undefined, JSON.stringify(outcome.runtime_result, null, 2)));
    return;
  }

  const error = outcome.stable_error ?? { code: 'UNKNOWN', message: '' };
  const official = meta === null ? undefined : meta.stable_error_messages[error.code];
  box.append(
    el('div', 'msg', `code=${error.code}${official !== undefined ? ' · 契约官方消息' : ''}`),
  );
  box.append(el('pre', undefined, JSON.stringify(error, null, 2)));
}

function renderFailure(card: Card, code: string, detail: string): void {
  const box = card.result;
  box.replaceChildren();
  box.classList.add('show');
  const head = el('div', 'row');
  head.append(el('span', 'badge err', code));
  box.append(head);
  box.append(el('pre', undefined, detail));
}

async function send(card: Card): Promise<void> {
  card.button.disabled = true;
  try {
    const response = await fetch(`/api/${card.spec.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        request: collectRequest(card),
        context: collectContext(card),
      }),
    });
    const payload = (await response.json()) as
      | CallOutcomeLike
      | { error: string; detail?: string };

    if (!response.ok) {
      const failure = payload as { error: string; detail?: string };
      renderFailure(card, failure.error, failure.detail ?? 'HTTP ' + String(response.status));
      return;
    }
    const outcome = payload as CallOutcomeLike;
    renderOutcome(card, outcome);
    if (outcome.outcome_type === 'SUCCESS') collectRefs(outcome.runtime_result);
    void refreshInspect();
  } catch (error) {
    renderFailure(card, 'NETWORK_FAILURE', error instanceof Error ? error.message : String(error));
  } finally {
    card.button.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// 上下文登记
// ---------------------------------------------------------------------------

function collectRefs(result: unknown): void {
  if (result === null || typeof result !== 'object') return;
  const record = result as Record<string, unknown>;
  if (typeof record.member_ref === 'string') memberRefChips.add(record.member_ref);
  if (typeof record.membership_ref === 'string') membershipRefChips.add(record.membership_ref);
  if (typeof record.previous_membership_ref === 'string') {
    membershipRefChips.add(record.previous_membership_ref);
  }
  const member = record.member;
  if (member !== null && typeof member === 'object') {
    const ref = (member as Record<string, unknown>).member_ref;
    if (typeof ref === 'string') memberRefChips.add(ref);
  }
  for (const key of ['membership', 'memberships']) {
    const value = record[key];
    const list = Array.isArray(value) ? value : [value];
    for (const item of list) {
      if (item === null || typeof item !== 'object') continue;
      const one = item as Record<string, unknown>;
      if (typeof one.membership_ref === 'string') membershipRefChips.add(one.membership_ref);
      if (typeof one.member_ref === 'string') memberRefChips.add(one.member_ref);
    }
  }
  renderChips();
}

function renderChips(): void {
  const container = document.getElementById('chips');
  if (container === null) return;
  container.replaceChildren();
  if (memberRefChips.size === 0 && membershipRefChips.size === 0) {
    container.append(el('span', 'empty', '暂无稳定标识；先执行 01 创建会员。'));
    return;
  }
  for (const ref of memberRefChips) container.append(makeChip(ref, 'member_ref'));
  for (const ref of membershipRefChips) container.append(makeChip(ref, 'membership_ref'));
}

function makeChip(ref: string, kind: string): HTMLElement {
  const chip = el('span', 'chip', ref);
  chip.title = `点击填入最近聚焦卡片的 ${kind} 字段`;
  chip.addEventListener('click', () => {
    const target = activeCard ?? cards[0] ?? null;
    if (target === null) return;
    const input = target.inputs.get(kind);
    if (input === undefined || input.readOnly) {
      showChipNote(`卡片 ${target.spec.index}（${target.spec.id}）没有可填写的 ${kind} 字段，请先点击目标卡片内的输入框。`);
      return;
    }
    input.value = ref;
    showChipNote(`已填入 ${kind} → 卡片 ${target.spec.index}`);
  });
  return chip;
}

let chipNote: HTMLElement | null = null;

function showChipNote(text: string): void {
  if (chipNote === null) {
    chipNote = el('div', 'msg');
    document.getElementById('chips')?.after(chipNote);
  }
  chipNote.textContent = text;
}

// ---------------------------------------------------------------------------
// 只读巡检
// ---------------------------------------------------------------------------

interface InspectView {
  members: Array<{ member_ref: string; display_name: string; member_status: string }>;
  memberships: Array<{
    membership_ref: string;
    plan_ref: string;
    membership_status: string;
    effective_time: string;
    termination_time: string | null;
  }>;
  member_status_events: unknown[];
  relation_events: unknown[];
}

async function refreshInspect(): Promise<void> {
  const container = document.getElementById('inspect');
  if (container === null) return;
  try {
    const view = (await (await fetch('/api/inspect')).json()) as InspectView;
    container.replaceChildren();
    container.append(el('h3', undefined, `成员（${view.members.length}）`));
    if (view.members.length === 0) {
      container.append(el('span', 'empty', '无'));
    } else {
      const list = el('ul');
      for (const m of view.members) {
        list.append(el('li', undefined, `${m.member_ref} · ${m.display_name} · ${m.member_status}`));
      }
      container.append(list);
    }
    container.append(el('h3', undefined, `会员关系（${view.memberships.length}）`));
    if (view.memberships.length === 0) {
      container.append(el('span', 'empty', '无'));
    } else {
      const list = el('ul');
      for (const m of view.memberships) {
        list.append(
          el(
            'li',
            undefined,
            `${m.membership_ref} · ${m.plan_ref} · ${m.membership_status} · [${m.effective_time} → ${m.termination_time ?? '∞'})`,
          ),
        );
      }
      container.append(list);
    }
    container.append(
      el(
        'h3',
        undefined,
        `append-only 事件（状态 ${view.member_status_events.length} / 关系 ${view.relation_events.length}）`,
      ),
    );
  } catch {
    container.replaceChildren(el('span', 'empty', '巡检数据不可用'));
  }
}

// ---------------------------------------------------------------------------
// 启动
// ---------------------------------------------------------------------------

async function boot(): Promise<void> {
  const ops = document.getElementById('ops');
  if (ops === null) return;

  try {
    meta = (await (await fetch('/api/meta')).json()) as MetaPayload;
  } catch {
    meta = null;
  }

  const planRefs = meta === null ? [] : meta.demo_plans.map((p) => p.membership_plan_ref);
  for (const spec of OPERATIONS) {
    for (const field of spec.fields) {
      if (field.datalist !== undefined) field.datalist = planRefs;
    }
    const card = buildCard(spec);
    cards.push(card);
    ops.append(card.root);
  }

  activeCard = cards[0] ?? null;
  await refreshInspect();
}

void boot();
