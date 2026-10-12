import {
  handler as consumePublication,
} from "../src/p2/consumer/external_capability_mounting/consume_publication/handler.ts";
import {
  handler as createMount,
  persist_created_mount_with_owner,
} from "../src/p2/consumer/external_capability_mounting/create_mount/handler.ts";
import type {
  OwnerLocalMountRecordPersistencePort,
} from "../src/p2/consumer/external_capability_mounting/create_mount/handler.ts";
import {
  handler as createMountSet,
  persist_created_mount_set_with_owner,
} from "../src/p2/consumer/external_capability_mounting/create_mount_set/handler.ts";
import type {
  OwnerLocalMountSetPersistencePort,
} from "../src/p2/consumer/external_capability_mounting/create_mount_set/handler.ts";
import {
  handler as activateMountSet,
  commit_active_mount_set_with_owner,
  recover_active_mount_set_with_owner,
} from "../src/p2/consumer/external_capability_mounting/activate_mount_set/handler.ts";
import type {
  OwnerLocalActiveMountSetPersistencePort,
} from "../src/p2/consumer/external_capability_mounting/activate_mount_set/handler.ts";
import {
  handler as executeMountedCapability,
} from "../src/p2/consumer/external_capability_mounting/execute_mounted_capability/handler.ts";
import type {
  MountedCapabilityExecutionDependencies,
} from "../src/p2/consumer/external_capability_mounting/execute_mounted_capability/handler.ts";

export type JsonObject = Readonly<Record<string, unknown>>;

export const P2_CONSUMER_MOUNT_SEQUENCE = Object.freeze([
  "consume_publication",
  "create_mount",
  "create_mount_set",
  "activate_mount_set",
] as const);

export type P2ConsumerMountPersistence =
  & OwnerLocalMountRecordPersistencePort
  & OwnerLocalMountSetPersistencePort
  & OwnerLocalActiveMountSetPersistencePort;

export interface P2ConsumerMountRealizationInput {
  readonly publication: JsonObject;
  readonly verification: JsonObject;
  readonly receiving_domain_ref: string;
  readonly mount_policy?: JsonObject;
  readonly additional_retained_mounts?: readonly JsonObject[];
  readonly current_active_mount_set?: JsonObject;
  readonly runtime_context?: JsonObject;
  readonly trace_id: string;
  readonly request_id: string;
}

export interface P2ConsumerMountRealizationResult {
  readonly operation_sequence: typeof P2_CONSUMER_MOUNT_SEQUENCE;
  readonly verified_publication: JsonObject;
  readonly mount: JsonObject;
  readonly mount_set: JsonObject;
  readonly active_mount_set: JsonObject;
}

export interface P2ConsumerMountedExecutionInput {
  readonly receiving_domain_ref: string;
  readonly requested_provider_capability_contract_ref: string;
  readonly exact_interface_binding: JsonObject;
  readonly operation_input: unknown;
  readonly runtime_context?: JsonObject;
  readonly trace_id: string;
  readonly request_id: string;
}

export interface P2ConsumerMountedExecutionResult {
  readonly active_mount_set: JsonObject;
  readonly mounted_execution: JsonObject;
  readonly execution_receipt: JsonObject;
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${field} must be a non-empty exact identity`);
  }
  return value;
}

function objectValue(value: unknown, field: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return value as JsonObject;
}

function objectArray(value: unknown, field: string): readonly JsonObject[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${field} must be a non-empty array`);
  }
  return value.map((item, index) => objectValue(item, `${field}[${index}]`));
}

function request(
  input: JsonObject,
  context: Readonly<{
    runtime_context?: JsonObject;
    trace_id: string;
    request_id: string;
  }>,
) {
  return Object.freeze({
    input,
    runtime_context: context.runtime_context ?? Object.freeze({}),
    trace_id: nonEmptyString(context.trace_id, "trace_id"),
    request_id: nonEmptyString(context.request_id, "request_id"),
  });
}

function assertSelectedMountIsActiveMember(
  activeMountSet: JsonObject,
  providerCapabilityContractRef: string,
  mount: JsonObject,
): void {
  const mountHash = nonEmptyString(mount.mount_hash, "mount.mount_hash");
  const members = objectArray(activeMountSet.members, "active_mount_set.members");
  const matched = members.filter((member) =>
    member.provider_capability_contract_ref === providerCapabilityContractRef
    && member.mount_hash === mountHash
  );
  if (matched.length !== 1) {
    throw new TypeError(
      "selected Provider Capability mount must be exactly one member of the active mount set",
    );
  }
}

/**
 * Mount-only receiving-Skeleton P2 Consumer realization.
 *
 * This closes the existing P2 V0128 mount lifecycle at an ACTIVE mount set.
 * It intentionally requires no receiving-P1 dependency declaration and creates
 * no P1 dependency, Operation, Interface, wrapper, protocol, or second Runtime.
 */
export async function realizeP2ConsumerMount(
  input: P2ConsumerMountRealizationInput,
  persistence: P2ConsumerMountPersistence,
): Promise<P2ConsumerMountRealizationResult> {
  const receivingDomainRef = nonEmptyString(
    input.receiving_domain_ref,
    "receiving_domain_ref",
  );

  const consumed = await consumePublication(request(Object.freeze({
    publication: input.publication,
    verification: input.verification,
  }), input));
  const verifiedPublication = objectValue(
    consumed.runtime_result.verified_publication,
    "verified_publication",
  );

  const mounted = await createMount(request(Object.freeze({
    verified_publication: verifiedPublication,
    receiving_domain_ref: receivingDomainRef,
    mount_policy: input.mount_policy ?? Object.freeze({}),
  }), input));
  const mount = objectValue(mounted.runtime_result.mount, "mount");
  await persist_created_mount_with_owner(mount, persistence);

  const mounts = Object.freeze([
    ...(input.additional_retained_mounts ?? Object.freeze([])),
    mount,
  ]);
  const createdSet = await createMountSet(request(Object.freeze({
    receiving_domain_ref: receivingDomainRef,
    mounts,
  }), input));
  const mountSet = objectValue(createdSet.runtime_result.mount_set, "mount_set");
  await persist_created_mount_set_with_owner(mountSet, mounts, persistence);

  const activated = await activateMountSet(request(Object.freeze({
    mount_set: mountSet,
    ...(input.current_active_mount_set === undefined
      ? {}
      : { current_active_mount_set: input.current_active_mount_set }),
  }), input));
  const activeMountSet = objectValue(
    activated.runtime_result.active_mount_set,
    "active_mount_set",
  );
  await commit_active_mount_set_with_owner(activeMountSet, persistence);

  const providerCapabilityContractRef = nonEmptyString(
    verifiedPublication.capability_contract_ref,
    "verified_publication.capability_contract_ref",
  );
  assertSelectedMountIsActiveMember(
    activeMountSet,
    providerCapabilityContractRef,
    mount,
  );

  return Object.freeze({
    operation_sequence: P2_CONSUMER_MOUNT_SEQUENCE,
    verified_publication: verifiedPublication,
    mount,
    mount_set: mountSet,
    active_mount_set: activeMountSet,
  });
}

/** Resolve/reverify mount state after restart without requiring a P1 dependency. */
export async function recoverP2ConsumerMount(
  receiving_domain_ref: string,
  persistence: P2ConsumerMountPersistence,
): Promise<JsonObject> {
  return await recover_active_mount_set_with_owner(
    nonEmptyString(receiving_domain_ref, "receiving_domain_ref"),
    persistence,
  );
}

/**
 * Execute one exact Interface from an independently ACTIVE mounted capability.
 * The existing execute_mounted_capability Operation remains semantic authority;
 * receiving-local P0 invocation is supplied through its existing dependency port.
 */
export async function executeP2MountedCapability(
  input: P2ConsumerMountedExecutionInput,
  persistence: P2ConsumerMountPersistence,
  dependencies: MountedCapabilityExecutionDependencies,
): Promise<P2ConsumerMountedExecutionResult> {
  const activeMountSet = await recoverP2ConsumerMount(
    input.receiving_domain_ref,
    persistence,
  );
  const executed = await executeMountedCapability(request(Object.freeze({
    active_mount_set: activeMountSet,
    requested_provider_capability_contract_ref:
      nonEmptyString(
        input.requested_provider_capability_contract_ref,
        "requested_provider_capability_contract_ref",
      ),
    exact_interface_binding: input.exact_interface_binding,
    operation_input: input.operation_input,
  }), input), dependencies);
  return Object.freeze({
    active_mount_set: activeMountSet,
    mounted_execution: objectValue(
      executed.runtime_result.mounted_execution,
      "mounted_execution",
    ),
    execution_receipt: objectValue(
      executed.runtime_result.execution_receipt,
      "execution_receipt",
    ),
  });
}
