/**
 * create_membership: only the already-declared Membership Plan Provider call.
 * Provider stable errors remain exact and are checked in errors.ts.
 */
import { validatePlanResolution } from '../../export/member/contracts';
import type {
  CallContext,
  MembershipPlanProvider,
  StableErrorPayload,
} from '../../export/member/types';

export type CreateMembershipPlanResult =
  | { readonly kind: 'active' }
  | { readonly kind: 'provider_stable_error'; readonly stableError: StableErrorPayload }
  | {
      readonly kind: 'rejected';
      readonly errorCode: 'DEPENDENCY_INFORMATION_INCOMPLETE' | 'MEMBERSHIP_PLAN_NOT_FOUND';
    };

export async function resolveActiveCreateMembershipPlan(
  provider: MembershipPlanProvider,
  planRef: string,
  context: CallContext,
): Promise<CreateMembershipPlanResult> {
  let result: Awaited<ReturnType<MembershipPlanProvider['resolveMembershipPlan']>>;
  try {
    result = await provider.resolveMembershipPlan(
      { membership_plan_ref: planRef },
      context,
    );
  } catch {
    return { kind: 'rejected', errorCode: 'DEPENDENCY_INFORMATION_INCOMPLETE' };
  }
  if (result.outcome_type === 'STABLE_ERROR') {
    return { kind: 'provider_stable_error', stableError: result.stable_error };
  }
  const issue = validatePlanResolution(result.membership_plan, planRef);
  if (!issue.ok) {
    return {
      kind: 'rejected',
      errorCode: issue.reason === 'MALFORMED_BINDING'
        ? 'DEPENDENCY_INFORMATION_INCOMPLETE'
        : 'MEMBERSHIP_PLAN_NOT_FOUND',
    };
  }
  return { kind: 'active' };
}
