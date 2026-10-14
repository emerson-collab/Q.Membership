/**
 * create_membership: existing request Schema and requested-time validation.
 * No new business constraint; preserves direct-handler validation behavior.
 */
import { parseDateTime, validateOperationRequest } from '../../export/member/contracts';
import type {
  CallContext,
  CallOutcome,
  CreateMembershipRequest,
  CreateMembershipResponse,
} from '../../export/member/types';
import { createMembershipFailure } from './errors';

export type CreateMembershipValidation =
  | { readonly ok: true; readonly requestedTime: Date | null }
  | { readonly ok: false; readonly outcome: CallOutcome<CreateMembershipResponse> };

export function validateCreateMembershipRequest(
  request: CreateMembershipRequest,
  context: CallContext,
): CreateMembershipValidation {
  const validation = validateOperationRequest('create_membership', request);
  if (!validation.ok) {
    const code = validation.category === 'identity'
      ? 'MEMBER_IDENTITY_MISSING'
      : validation.category === 'time'
        ? 'INVALID_BUSINESS_TIME'
        : 'MEMBERSHIP_REQUIRED_INPUT_MISSING';
    return { ok: false, outcome: createMembershipFailure(context, code) };
  }

  let requestedTime: Date | null = null;
  if (request.requested_effective_time !== undefined) {
    requestedTime = parseDateTime(request.requested_effective_time);
    if (requestedTime === null) {
      return {
        ok: false,
        outcome: createMembershipFailure(context, 'INVALID_BUSINESS_TIME'),
      };
    }
  }
  return { ok: true, requestedTime };
}
