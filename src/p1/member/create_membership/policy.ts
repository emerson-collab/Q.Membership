/**
 * create_membership: effective-time, lifecycle and overlap business rules.
 * Pure evaluation only; no Provider, repository, or Runtime ownership.
 */
import { toEpoch } from '../../export/member/contracts.ts';
import type { StoredMember, StoredMembership } from '../../export/member/types.ts';

export type CreateMembershipTimeResult =
  | {
      readonly ok: true;
      readonly effectiveTime: string;
      readonly effectiveEpoch: number;
    }
  | {
      readonly ok: false;
      readonly errorCode: 'INVALID_BUSINESS_TIME' | 'INVALID_STATE_TRANSITION';
    };

export function evaluateCreateMembershipTime(
  member: StoredMember,
  requestedTime: Date | null,
  requestedEffectiveTime: string | undefined,
  commitTime: string,
): CreateMembershipTimeResult {
  const commitEpoch = toEpoch(commitTime);
  const effectiveTime = requestedTime ? requestedEffectiveTime! : commitTime;
  const effectiveEpoch = requestedTime ? requestedTime.getTime() : commitEpoch;

  if (effectiveEpoch > commitEpoch) {
    return { ok: false, errorCode: 'INVALID_BUSINESS_TIME' };
  }
  if (effectiveEpoch < toEpoch(member.created_at)) {
    return { ok: false, errorCode: 'INVALID_BUSINESS_TIME' };
  }
  if (member.terminated_at !== null && effectiveEpoch >= toEpoch(member.terminated_at)) {
    return { ok: false, errorCode: 'INVALID_STATE_TRANSITION' };
  }
  return { ok: true, effectiveTime, effectiveEpoch };
}

export function hasCreateMembershipOverlap(
  existing: readonly StoredMembership[],
  effectiveEpoch: number,
): boolean {
  return existing.some(
    (m) => m.termination_time === null || toEpoch(m.termination_time) > effectiveEpoch,
  );
}
