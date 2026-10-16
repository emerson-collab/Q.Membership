/**
 * create_membership: only its declared stable-error closure and Provider
 * PRESERVE_EXACT boundary. No additional error code is introduced.
 */
import {
  fail,
  preserveExactProviderStableError,
  stableError,
  STABLE_ERROR_CODE_SETS,
} from '../../export/member/contracts.ts';
import type {
  CallContext,
  CallOutcome,
  CreateMembershipResponse,
  MemberRepository,
  StableErrorPayload,
} from '../../export/member/types.ts';

export type CreateMembershipErrorCode =
  (typeof STABLE_ERROR_CODE_SETS)['create_membership'][number];

type InsertFailureReason =
  Extract<Awaited<ReturnType<MemberRepository['insertMembershipAtomic']>>, { ok: false }>['reason'];

export function createMembershipFailure(
  context: CallContext,
  code: CreateMembershipErrorCode,
): CallOutcome<CreateMembershipResponse> {
  return fail(context, stableError('create_membership', code));
}

export function createMembershipProviderFailure(
  context: CallContext,
  stable: StableErrorPayload,
): CallOutcome<CreateMembershipResponse> {
  return fail(context, preserveExactProviderStableError('create_membership', stable));
}

export function createMembershipInsertErrorCode(
  reason: InsertFailureReason,
): CreateMembershipErrorCode {
  if (reason === 'OVERLAP') return 'MEMBERSHIP_RELATION_CONFLICT';
  if (reason === 'MEMBER_NOT_ACTIVE_AT_TIME') return 'INVALID_STATE_TRANSITION';
  if (reason === 'MEMBER_NOT_FOUND') return 'MEMBER_NOT_FOUND';
  return 'CONCURRENT_MODIFICATION_CONFLICT';
}
