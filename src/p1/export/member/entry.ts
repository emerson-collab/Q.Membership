/**
 * 统一会员能力 V0103 — 公共出口（桶导出）
 *
 * 对外发布 8 个 Operation 的调用入口；resolve_membership 虽在类型中可见，
 * 但其接口被契约标记为 INTERNAL 且 publication_forbidden，
 * 调用必须携带内部用途证据，否则 OPERATION_NOT_AUTHORIZED。
 */

export * from './types';
export * from './contracts';
export {
  MemberCapabilityClient,
  InMemoryMemberRepository,
  staticMembershipPlanProvider,
} from './client';
export { MEMBER_CAPABILITY_METADATA } from './metadata';
export type { MemberCapabilityMetadata } from './metadata';
