/**
 * JsonFileMemberRepository — JSON 文件持久化仓储（本地演示层）
 *
 * 定位：与 InMemoryMemberRepository 实现同一个 MemberRepository 端口，
 * 语义完全一致（写串行化、CAS 版本校验、身份唯一、半开区间不重叠、
 * append-only 事件），差异仅在每次成功写操作后把全量状态落盘：
 *  - 写临时文件后 rename 原子替换，崩溃不会留下半截文件；
 *  - 启动时若文件存在则自动加载并重建全部索引；
 *  - 单进程演示用途，不做跨进程锁。
 * 本文件属于 web/ 演示层，不修改 src/p1 的任何既有实现。
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

import { generateEventRef, toEpoch } from '../src/p1/export/member/contracts.ts';
import type {
  MemberRepository,
  MemberStatusEvent,
  MembershipRelationEvent,
  StoredMember,
  StoredMembership,
} from '../src/p1/export/member/types.ts';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** 落盘文件结构（全量快照，版本字段用于将来迁移） */
interface StoreFileShape {
  store_version: 1;
  members: StoredMember[];
  memberships: StoredMembership[];
  member_status_events: MemberStatusEvent[];
  relation_events: MembershipRelationEvent[];
}

export class JsonFileMemberRepository implements MemberRepository {
  private readonly membersByRef = new Map<string, StoredMember>();
  // B-05：身份二元组使用嵌套原生 Map（namespace -> value -> member_ref），
  // 不拼接分隔符，键为原始取值，不做大小写/空白归一化。
  private readonly refByIdentity = new Map<string, Map<string, string>>();
  private readonly membershipsByRef = new Map<string, StoredMembership>();
  private readonly refsByMember = new Map<string, Set<string>>();
  private readonly memberStatusEvents: MemberStatusEvent[] = [];
  private readonly relationEvents: MembershipRelationEvent[] = [];
  private txQueue: Promise<unknown> = Promise.resolve();
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.load();
  }

  // -- 持久化 -----------------------------------------------------------------

  private load(): void {
    if (!existsSync(this.filePath)) return;
    const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as StoreFileShape;
    if (parsed.store_version !== 1) {
      throw new Error(`unsupported store_version: ${String(parsed.store_version)}`);
    }
    for (const member of parsed.members) {
      this.membersByRef.set(member.member_ref, clone(member));
      this.identityBucket(member.identity_namespace).set(
        member.identity_value,
        member.member_ref,
      );
    }
    for (const membership of parsed.memberships) {
      this.membershipsByRef.set(membership.membership_ref, clone(membership));
      this.memberRefSet(membership.member_ref).add(membership.membership_ref);
    }
    for (const event of parsed.member_status_events) {
      this.memberStatusEvents.push(clone(event));
    }
    for (const event of parsed.relation_events) {
      this.relationEvents.push(clone(event));
    }
  }

  /** 原子落盘：先写临时文件再 rename；必须在串行化事务内调用 */
  private persist(): void {
    const snapshot: StoreFileShape = {
      store_version: 1,
      members: [...this.membersByRef.values()],
      memberships: [...this.membershipsByRef.values()],
      member_status_events: this.memberStatusEvents,
      relation_events: this.relationEvents,
    };
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(snapshot, null, 2), 'utf8');
    renameSync(tmpPath, this.filePath);
  }

  private serialize<T>(fn: () => T): Promise<T> {
    const run = this.txQueue.then(() => fn());
    this.txQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  // -- member ---------------------------------------------------------------

  insertMemberAtomic(record: StoredMember) {
    return this.serialize(() => {
      const identities = this.identityBucket(record.identity_namespace);
      if (identities.has(record.identity_value)) {
        return { ok: false as const, reason: 'DUPLICATE_IDENTITY' as const };
      }
      const stored = clone(record);
      this.membersByRef.set(stored.member_ref, stored);
      identities.set(stored.identity_value, stored.member_ref);
      this.appendMemberStatusEvent({
        event_ref: generateEventRef('msev'),
        member_ref: stored.member_ref,
        from_status: null,
        to_status: 'active',
        occurred_at: stored.created_at,
        reason: null,
      });
      this.persist();
      return { ok: true as const, record: clone(stored) };
    });
  }

  async getMemberByRef(memberRef: string): Promise<StoredMember | null> {
    const found = this.membersByRef.get(memberRef);
    return found ? clone(found) : null;
  }

  async getMemberByIdentity(
    namespace: string,
    value: string,
  ): Promise<StoredMember | null> {
    const ref = this.refByIdentity.get(namespace)?.get(value);
    const found = ref ? this.membersByRef.get(ref) : undefined;
    return found ? clone(found) : null;
  }

  updateMemberProfileAtomic(input: {
    member_ref: string;
    expected_version: number;
    display_name?: string;
    contact_email?: string;
  }) {
    return this.serialize(() => {
      const stored = this.membersByRef.get(input.member_ref);
      if (!stored) {
        return { ok: false as const, reason: 'NOT_FOUND' as const };
      }
      if (stored.version !== input.expected_version) {
        return { ok: false as const, reason: 'CONCURRENT' as const };
      }
      const changed =
        (input.display_name !== undefined &&
          stored.display_name !== input.display_name) ||
        (input.contact_email !== undefined &&
          stored.contact_email !== input.contact_email);
      if (changed) {
        if (input.display_name !== undefined) {
          stored.display_name = input.display_name;
        }
        if (input.contact_email !== undefined) {
          stored.contact_email = input.contact_email;
        }
        stored.version += 1;
        this.persist();
      }
      return {
        ok: true as const,
        record: clone(stored),
        changed,
      };
    });
  }

  terminateMemberAtomic(input: {
    member_ref: string;
    expected_version: number;
    terminated_at: string;
    reason: string | null;
  }) {
    return this.serialize(() => {
      const stored = this.membersByRef.get(input.member_ref);
      if (!stored) {
        return { ok: false as const, reason: 'NOT_FOUND' as const };
      }
      if (stored.member_status !== 'active') {
        return { ok: false as const, reason: 'NOT_ACTIVE' as const };
      }
      if (stored.version !== input.expected_version) {
        return { ok: false as const, reason: 'CONCURRENT' as const };
      }
      stored.member_status = 'terminated';
      stored.terminated_at = input.terminated_at;
      stored.terminate_reason = input.reason;
      stored.version += 1;
      this.appendMemberStatusEvent({
        event_ref: generateEventRef('msev'),
        member_ref: stored.member_ref,
        from_status: 'active',
        to_status: 'terminated',
        occurred_at: input.terminated_at,
        reason: input.reason,
      });
      this.persist();
      return { ok: true as const, record: clone(stored) };
    });
  }

  // -- membership -------------------------------------------------------------

  insertMembershipAtomic(record: StoredMembership) {
    return this.serialize(() => {
      // B-03：提交边界内重新核验会员在拟生效时点的历史状态。
      const member = this.membersByRef.get(record.member_ref);
      if (!member) {
        return { ok: false as const, reason: 'MEMBER_NOT_FOUND' as const };
      }
      const effectiveEpoch = toEpoch(record.effective_time);
      if (effectiveEpoch < toEpoch(member.created_at)) {
        return {
          ok: false as const,
          reason: 'MEMBER_NOT_ACTIVE_AT_TIME' as const,
        };
      }
      if (
        member.terminated_at !== null &&
        effectiveEpoch >= toEpoch(member.terminated_at)
      ) {
        return {
          ok: false as const,
          reason: 'MEMBER_NOT_ACTIVE_AT_TIME' as const,
        };
      }
      if (this.hasOverlap(record.member_ref, record.effective_time, null)) {
        return { ok: false as const, reason: 'OVERLAP' as const };
      }
      const stored = clone(record);
      this.membershipsByRef.set(stored.membership_ref, stored);
      this.memberRefSet(stored.member_ref).add(stored.membership_ref);
      this.appendRelationEvent({
        event_ref: generateEventRef('mrev'),
        membership_ref: stored.membership_ref,
        member_ref: stored.member_ref,
        plan_ref: stored.plan_ref,
        event_kind: 'created',
        effective_time: stored.effective_time,
        termination_time: null,
        successor_ref: null,
        predecessor_ref: null,
        occurred_at: stored.effective_time,
      });
      this.persist();
      return { ok: true as const, record: clone(stored) };
    });
  }

  async getMembershipByRef(
    membershipRef: string,
  ): Promise<StoredMembership | null> {
    const found = this.membershipsByRef.get(membershipRef);
    return found ? clone(found) : null;
  }

  async listMembershipsByMember(memberRef: string): Promise<StoredMembership[]> {
    const refs = this.refsByMember.get(memberRef);
    if (!refs) return [];
    return [...refs]
      .map((ref) => this.membershipsByRef.get(ref))
      .filter((m): m is StoredMembership => m !== undefined)
      .map(clone);
  }

  replaceMembershipAtomic(input: {
    member_ref: string;
    current_membership_ref: string;
    expected_version: number;
    effective_time: string;
    new_record: StoredMembership;
  }) {
    return this.serialize(() => {
      const previous = this.membershipsByRef.get(input.current_membership_ref);
      if (!previous) {
        return {
          ok: false as const,
          reason: 'MEMBERSHIP_NOT_FOUND' as const,
        };
      }
      if (previous.member_ref !== input.member_ref) {
        return {
          ok: false as const,
          reason: 'NOT_BELONG_TO_MEMBER' as const,
        };
      }
      if (previous.membership_status !== 'active') {
        return { ok: false as const, reason: 'NOT_ACTIVE' as const };
      }
      if (previous.version !== input.expected_version) {
        return { ok: false as const, reason: 'CONCURRENT' as const };
      }
      // B-04：新生效时点必须严格晚于旧关系开始。
      if (
        toEpoch(input.effective_time) <= toEpoch(previous.effective_time)
      ) {
        return { ok: false as const, reason: 'INVALID_INTERVAL' as const };
      }
      const otherOverlap = this.hasOverlap(
        input.member_ref,
        input.effective_time,
        input.current_membership_ref,
      );
      if (otherOverlap) {
        return { ok: false as const, reason: 'OVERLAP' as const };
      }

      // 原子完成：旧关系在 t 终止，新关系在 t 生效
      previous.membership_status = 'replaced';
      previous.termination_time = input.effective_time;
      previous.version += 1;

      const successor = clone(input.new_record);
      this.membershipsByRef.set(successor.membership_ref, successor);
      this.memberRefSet(successor.member_ref).add(successor.membership_ref);

      this.appendRelationEvent({
        event_ref: generateEventRef('mrev'),
        membership_ref: previous.membership_ref,
        member_ref: previous.member_ref,
        plan_ref: previous.plan_ref,
        event_kind: 'replaced_out',
        effective_time: previous.effective_time,
        termination_time: input.effective_time,
        successor_ref: successor.membership_ref,
        predecessor_ref: null,
        occurred_at: input.effective_time,
      });
      this.appendRelationEvent({
        event_ref: generateEventRef('mrev'),
        membership_ref: successor.membership_ref,
        member_ref: successor.member_ref,
        plan_ref: successor.plan_ref,
        event_kind: 'created',
        effective_time: input.effective_time,
        termination_time: null,
        successor_ref: null,
        predecessor_ref: previous.membership_ref,
        occurred_at: input.effective_time,
      });

      this.persist();
      return {
        ok: true as const,
        previous: clone(previous),
        current: clone(successor),
      };
    });
  }

  // -- 审计视图（append-only 事件） --------------------------------------------

  listMemberStatusEvents(memberRef?: string): MemberStatusEvent[] {
    return this.memberStatusEvents
      .filter((e) => memberRef === undefined || e.member_ref === memberRef)
      .map(clone);
  }

  listRelationEvents(memberRef?: string): MembershipRelationEvent[] {
    return this.relationEvents
      .filter((e) => memberRef === undefined || e.member_ref === memberRef)
      .map(clone);
  }

  /** 演示层巡检用：全量成员/关系快照（重启后巡检面板依然可见历史数据） */
  snapshot(): { members: StoredMember[]; memberships: StoredMembership[] } {
    return {
      members: [...this.membersByRef.values()].map(clone),
      memberships: [...this.membershipsByRef.values()].map(clone),
    };
  }

  // -- 内部辅助 ---------------------------------------------------------------

  private identityBucket(namespace: string): Map<string, string> {
    let bucket = this.refByIdentity.get(namespace);
    if (!bucket) {
      bucket = new Map<string, string>();
      this.refByIdentity.set(namespace, bucket);
    }
    return bucket;
  }

  private memberRefSet(memberRef: string): Set<string> {
    let set = this.refsByMember.get(memberRef);
    if (!set) {
      set = new Set<string>();
      this.refsByMember.set(memberRef, set);
    }
    return set;
  }

  private appendMemberStatusEvent(event: MemberStatusEvent): void {
    this.memberStatusEvents.push(clone(event));
  }

  private appendRelationEvent(event: MembershipRelationEvent): void {
    this.relationEvents.push(clone(event));
  }

  /**
   * 区间重叠检查：候选区间 [candidateStart, ∞) 与既有关系
   * [effective_time, termination_time) 是否重叠。ignoreRef 指定的旧关系除外。
   */
  private hasOverlap(
    memberRef: string,
    candidateStart: string,
    ignoreRef: string | null,
  ): boolean {
    const refs = this.refsByMember.get(memberRef);
    if (!refs) return false;
    const candidateEpoch = toEpoch(candidateStart);
    for (const ref of refs) {
      if (ignoreRef !== null && ref === ignoreRef) continue;
      const m = this.membershipsByRef.get(ref);
      if (!m) continue;
      if (
        m.termination_time === null ||
        toEpoch(m.termination_time) > candidateEpoch
      ) {
        return true;
      }
    }
    return false;
  }
}
