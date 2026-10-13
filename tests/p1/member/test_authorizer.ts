/**
 * TEST-ONLY simulated actor/permission authority for legacy business behavior.
 * This fixture is not governed V0117 authorization evidence or production code.
 */
import type { OperationAuthorizer } from '../../../src/p1/export/member/types';

export const testAuthorizer: OperationAuthorizer = {
  authorize({ context, operation_id }) {
    const evidence = context.authorization;
    return (
      typeof evidence?.actor_ref === 'string' &&
      evidence.actor_ref.length > 0 &&
      typeof evidence.issued_by === 'string' &&
      evidence.issued_by.length > 0 &&
      (evidence.allowed_operations.includes('*') ||
        evidence.allowed_operations.includes(operation_id))
    );
  },
};
