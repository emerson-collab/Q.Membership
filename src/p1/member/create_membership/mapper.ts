/**
 * create_membership: storage-commit record -> existing exact response contract.
 * Does not expose repository version or create any extra business fact.
 */
import type {
  CreateMembershipResponse,
  StoredMembership,
} from '../../export/member/types.ts';

export function toCreateMembershipResponse(
  record: StoredMembership,
): CreateMembershipResponse {
  return {
    membership_ref: record.membership_ref,
    membership_status: 'active',
    effective_time: record.effective_time,
  };
}
