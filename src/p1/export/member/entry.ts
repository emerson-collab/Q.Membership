/**
 * Member V0103 candidate declaration-only export.
 *
 * This is NOT an approved external_provider_surface, production execution
 * entry, or P1CM V0117 runtime/whitelist completion receipt.
 * Deliberately do not expose the local direct-to-handler client, in-memory
 * storage, or static provider through the public Capability barrel.
 */
export * from './types';
export * from './contracts';
export {
  MEMBER_CAPABILITY_METADATA,
  MEMBER_OPERATION_INTERFACE_IDS,
  getMemberGeneralExportCandidate,
} from './metadata';
export type { MemberCapabilityMetadata } from './metadata';
