/**
 * create_membership: exact member/relation reads and one atomic relation insert.
 * The repository port owns persistence, conflict recheck, and commit atomicity.
 */
import { generateMembershipRef } from '../../export/member/contracts.ts';
import type {
  MemberRepository,
  StoredMember,
  StoredMembership,
} from '../../export/member/types.ts';

export function loadCreateMembershipMember(
  repository: MemberRepository,
  memberRef: string,
): Promise<StoredMember | null> {
  return repository.getMemberByRef(memberRef);
}

export function listCreateMembershipRelations(
  repository: MemberRepository,
  memberRef: string,
): Promise<StoredMembership[]> {
  return repository.listMembershipsByMember(memberRef);
}

export function insertCreateMembershipAtomic(
  repository: MemberRepository,
  memberRef: string,
  planRef: string,
  effectiveTime: string,
): ReturnType<MemberRepository['insertMembershipAtomic']> {
  const record: StoredMembership = {
    membership_ref: generateMembershipRef(),
    member_ref: memberRef,
    plan_ref: planRef,
    membership_status: 'active',
    effective_time: effectiveTime,
    termination_time: null,
    version: 1,
  };
  return repository.insertMembershipAtomic(record);
}
