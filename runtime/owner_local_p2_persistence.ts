import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  readAndVerifyInstalledImplementationMaterial,
} from "./implementation_material_runtime.ts";
import type {
  LocalImplementationMaterialReadPort,
  ResolvedImplementationBinding,
} from "./implementation_material_runtime.ts";

export type JsonObject = Readonly<Record<string, unknown>>;

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;

export class OwnerLocalP2PersistenceError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "OwnerLocalP2PersistenceError";
    this.code = code;
  }
}

export interface OwnerLocalP2DurablePersistence {
  readonly runtime_root: string;
  persist_mount_record(input: Readonly<{
    receiving_domain_ref: string;
    mount_hash: string;
    mount: JsonObject;
  }>): Promise<void>;
  read_mount_record(input: Readonly<{
    receiving_domain_ref: string;
    mount_hash: string;
  }>): Promise<JsonObject | undefined>;
  persist_mount_set_record(input: Readonly<{
    receiving_domain_ref: string;
    mount_set_hash: string;
    mount_set: JsonObject;
  }>): Promise<void>;
  read_mount_set_record(input: Readonly<{
    receiving_domain_ref: string;
    mount_set_hash: string;
  }>): Promise<JsonObject | undefined>;
  reverify_implementation_material(input: Readonly<{
    receiving_domain_ref: string;
    mount_hash: string;
    implementation_binding_hash: string;
    resolver_state: JsonObject;
  }>): Promise<void>;
  read_active_mount_set_pointer(input: Readonly<{
    receiving_domain_ref: string;
  }>): Promise<JsonObject | undefined>;
  switch_active_mount_set_pointer(input: Readonly<{
    receiving_domain_ref: string;
    mount_set_hash: string;
    previous_active_pointer?: JsonObject;
  }>): Promise<void>;
  persist_dependency_binding_record(input: Readonly<{
    receiving_domain_ref: string;
    exact_owner_capability_ref: string;
    exact_receiving_operation_ref: string;
    exact_local_dependency_ref: string;
    active_mount_set_hash: string;
    binding_hash: string;
    binding: JsonObject;
  }>): Promise<void>;
  read_dependency_binding_record(input: Readonly<{
    receiving_domain_ref: string;
    exact_owner_capability_ref: string;
    exact_receiving_operation_ref: string;
    exact_local_dependency_ref: string;
    active_mount_set_hash: string;
  }>): Promise<JsonObject | undefined>;
}

export interface OwnerLocalP2DurablePersistenceOptions {
  readonly repository_root: string;
  readonly material_read_port: LocalImplementationMaterialReadPort;
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new OwnerLocalP2PersistenceError(
      "P2_DURABLE_IDENTITY_INVALID",
      `${field} must be a non-empty string`,
    );
  }
  return value;
}

function sha256Value(value: unknown, field: string): string {
  const text = nonEmptyString(value, field);
  if (!SHA256_PATTERN.test(text)) {
    throw new OwnerLocalP2PersistenceError(
      "P2_DURABLE_IDENTITY_INVALID",
      `${field} must be an exact sha256 binding`,
    );
  }
  return text;
}

function objectValue(value: unknown, field: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new OwnerLocalP2PersistenceError(
      "P2_DURABLE_RECORD_INVALID",
      `${field} must be an object`,
    );
  }
  return value as JsonObject;
}

function stableClone(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableClone);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const nested = source[key];
      if (nested === undefined) {
        throw new OwnerLocalP2PersistenceError(
          "P2_DURABLE_RECORD_INVALID",
          `undefined JSON member is forbidden: ${key}`,
        );
      }
      out[key] = stableClone(nested);
    }
    return out;
  }
  if (
    value === undefined
    || typeof value === "bigint"
    || typeof value === "function"
    || typeof value === "symbol"
  ) {
    throw new OwnerLocalP2PersistenceError(
      "P2_DURABLE_RECORD_INVALID",
      "durable runtime facts must be exact JSON values",
    );
  }
  return value;
}

function canonical(value: unknown): string {
  const serialized = JSON.stringify(stableClone(value));
  if (serialized === undefined) {
    throw new OwnerLocalP2PersistenceError(
      "P2_DURABLE_RECORD_INVALID",
      "durable runtime fact did not produce exact JSON bytes",
    );
  }
  return serialized;
}

function canonicalBytes(value: JsonObject): Buffer {
  return Buffer.from(canonical(value), "utf8");
}

function sha256Json(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonical(value), "utf8").digest("hex")}`;
}

function digestKey(exactHash: string): string {
  return sha256Value(exactHash, "hash").slice("sha256:".length);
}

function stringDigest(value: string, field: string): string {
  return createHash("sha256")
    .update(nonEmptyString(value, field), "utf8")
    .digest("hex");
}

function domainKey(receivingDomainRef: string): string {
  return stringDigest(receivingDomainRef, "receiving_domain_ref");
}

function isErrno(error: unknown, code: string): boolean {
  return (
    error !== null
    && typeof error === "object"
    && "code" in error
    && (error as NodeJS.ErrnoException).code === code
  );
}

async function syncDirectory(path: string): Promise<void> {
  if (process.platform === "win32") return;
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function readCanonicalObject(path: string): Promise<JsonObject | undefined> {
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (error) {
    if (isErrno(error, "ENOENT")) return undefined;
    throw new OwnerLocalP2PersistenceError(
      "P2_DURABLE_READ_FAILED",
      `durable runtime fact read failed: ${path}`,
      { cause: error },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new OwnerLocalP2PersistenceError(
      "P2_DURABLE_RECORD_INVALID",
      `durable runtime fact is not valid JSON: ${path}`,
      { cause: error },
    );
  }
  const object = objectValue(parsed, "durable_runtime_fact");
  if (!bytes.equals(canonicalBytes(object))) {
    throw new OwnerLocalP2PersistenceError(
      "P2_DURABLE_EXACT_READBACK_MISMATCH",
      `durable runtime fact is not exact canonical bytes: ${path}`,
    );
  }
  return object;
}

async function writeSyncedTemp(path: string, bytes: Uint8Array): Promise<string> {
  const parent = dirname(path);
  await mkdir(parent, { recursive: true });
  const temp = join(
    parent,
    `.${path.slice(parent.length + 1)}.${process.pid}.${randomUUID()}.tmp`,
  );
  const handle = await open(temp, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  return temp;
}

async function persistImmutableExact(path: string, value: JsonObject): Promise<void> {
  const expected = canonicalBytes(value);
  const existing = await readCanonicalObject(path);
  if (existing !== undefined) {
    if (!canonicalBytes(existing).equals(expected)) {
      throw new OwnerLocalP2PersistenceError(
        "P2_DURABLE_IMMUTABLE_CONFLICT",
        `immutable durable runtime fact already exists with different bytes: ${path}`,
      );
    }
    return;
  }

  const temp = await writeSyncedTemp(path, expected);
  try {
    try {
      await link(temp, path);
    } catch (error) {
      if (!isErrno(error, "EEXIST")) throw error;
      const raced = await readCanonicalObject(path);
      if (raced === undefined || !canonicalBytes(raced).equals(expected)) {
        throw new OwnerLocalP2PersistenceError(
          "P2_DURABLE_IMMUTABLE_CONFLICT",
          `immutable durable runtime fact raced with different bytes: ${path}`,
          { cause: error },
        );
      }
    }
    await syncDirectory(dirname(path));
  } finally {
    await unlink(temp).catch((error: unknown) => {
      if (!isErrno(error, "ENOENT")) throw error;
    });
  }
}

async function replaceMutableExact(path: string, value: JsonObject): Promise<void> {
  const temp = await writeSyncedTemp(path, canonicalBytes(value));
  try {
    await rename(temp, path);
    await syncDirectory(dirname(path));
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw new OwnerLocalP2PersistenceError(
      "P2_DURABLE_POINTER_WRITE_FAILED",
      `active mount-set pointer atomic replace failed: ${path}`,
      { cause: error },
    );
  }
}

function resolverBinding(resolverState: JsonObject): ResolvedImplementationBinding {
  if (resolverState.verified !== true) {
    throw new OwnerLocalP2PersistenceError(
      "P2_RESOLVER_STATE_NOT_VERIFIED",
      "verified resolver state required for restart/activation reverification",
    );
  }
  return Object.freeze({
    publication_hash: sha256Value(
      resolverState.publication_hash,
      "resolver_state.publication_hash",
    ),
    implementation_artifact_ref: nonEmptyString(
      resolverState.implementation_artifact_ref,
      "resolver_state.implementation_artifact_ref",
    ),
    implementation_artifact_hash: sha256Value(
      resolverState.implementation_artifact_hash,
      "resolver_state.implementation_artifact_hash",
    ),
    entry_symbol_ref: nonEmptyString(
      resolverState.entry_symbol_ref,
      "resolver_state.entry_symbol_ref",
    ),
    local_material_binding_ref: nonEmptyString(
      resolverState.local_material_binding_ref,
      "resolver_state.local_material_binding_ref",
    ),
    binding_hash: sha256Value(
      resolverState.binding_hash,
      "resolver_state.binding_hash",
    ),
    verified: true as const,
  });
}

function dependencyBindingIdentity(binding: JsonObject): Readonly<{
  exact_owner_capability_ref: string;
  exact_receiving_operation_ref: string;
  exact_local_dependency_ref: string;
  active_mount_set_hash: string;
  binding_hash: string;
}> {
  if (binding.source_binding_kind !== "ACTIVE_MOUNT_SET_MEMBER") {
    throw new OwnerLocalP2PersistenceError(
      "P2_DURABLE_DEPENDENCY_BINDING_INVALID",
      "only ACTIVE_MOUNT_SET_MEMBER dependency realization is a mandatory durable mount fact",
    );
  }
  if (binding.creates_or_writes_p1_business_semantics !== false) {
    throw new OwnerLocalP2PersistenceError(
      "P2_DURABLE_DEPENDENCY_BINDING_INVALID",
      "durable dependency realization may not write P1 business semantics",
    );
  }
  const verified = objectValue(
    binding.verified_provider_binding_or_governed_data_binding,
    "dependency_realization_binding.verified_provider_binding_or_governed_data_binding",
  );
  if (verified.source_binding_kind !== "ACTIVE_MOUNT_SET_MEMBER") {
    throw new OwnerLocalP2PersistenceError(
      "P2_DURABLE_DEPENDENCY_BINDING_INVALID",
      "durable dependency realization must preserve ACTIVE_MOUNT_SET_MEMBER source identity",
    );
  }
  const activeMountSetHash = sha256Value(
    verified.active_mount_set_hash,
    "dependency_realization_binding.active_mount_set_hash",
  );
  const exactOwnerCapabilityRef = nonEmptyString(
    binding.exact_owner_capability_ref,
    "dependency_realization_binding.exact_owner_capability_ref",
  );
  const exactReceivingOperationRef = nonEmptyString(
    binding.exact_receiving_operation_ref,
    "dependency_realization_binding.exact_receiving_operation_ref",
  );
  const exactLocalDependencyRef = nonEmptyString(
    binding.exact_local_dependency_ref,
    "dependency_realization_binding.exact_local_dependency_ref",
  );
  const p1DependencyInterfaceRef = nonEmptyString(
    binding.p1_dependency_interface_ref,
    "dependency_realization_binding.p1_dependency_interface_ref",
  );
  const bindingHash = sha256Value(
    binding.binding_hash,
    "dependency_realization_binding.binding_hash",
  );
  const expectedBindingHash = sha256Json({
    verified_provider_binding_or_governed_data_binding: verified,
    exact_owner_capability_ref: exactOwnerCapabilityRef,
    exact_receiving_operation_ref: exactReceivingOperationRef,
    exact_local_dependency_ref: exactLocalDependencyRef,
    p1_dependency_interface_ref: p1DependencyInterfaceRef,
  });
  if (bindingHash !== expectedBindingHash) {
    throw new OwnerLocalP2PersistenceError(
      "P2_DURABLE_DEPENDENCY_BINDING_HASH_MISMATCH",
      "durable dependency realization binding_hash mismatch",
    );
  }
  return Object.freeze({
    exact_owner_capability_ref: exactOwnerCapabilityRef,
    exact_receiving_operation_ref: exactReceivingOperationRef,
    exact_local_dependency_ref: exactLocalDependencyRef,
    active_mount_set_hash: activeMountSetHash,
    binding_hash: bindingHash,
  });
}

export function createOwnerLocalP2DurablePersistence(
  options: OwnerLocalP2DurablePersistenceOptions,
): OwnerLocalP2DurablePersistence {
  const repositoryRoot = resolve(
    nonEmptyString(options.repository_root, "repository_root"),
  );
  const runtimeRoot = join(repositoryRoot, ".qruntime");
  const p2Root = join(runtimeRoot, "p2", "consumer");

  const domainRoot = (receivingDomainRef: string): string =>
    join(p2Root, domainKey(receivingDomainRef));
  const mountPath = (receivingDomainRef: string, mountHash: string): string =>
    join(domainRoot(receivingDomainRef), "mounts", `${digestKey(mountHash)}.json`);
  const mountSetPath = (
    receivingDomainRef: string,
    mountSetHash: string,
  ): string => join(
    domainRoot(receivingDomainRef),
    "mount_sets",
    `${digestKey(mountSetHash)}.json`,
  );
  const pointerPath = (receivingDomainRef: string): string =>
    join(domainRoot(receivingDomainRef), "active_mount_set_pointer.json");
  const dependencyBindingPath = (
    receivingDomainRef: string,
    exactOwnerCapabilityRef: string,
    exactReceivingOperationRef: string,
    exactLocalDependencyRef: string,
    activeMountSetHash: string,
  ): string => join(
    domainRoot(receivingDomainRef),
    "dependency_bindings",
    stringDigest(exactOwnerCapabilityRef, "exact_owner_capability_ref"),
    stringDigest(exactReceivingOperationRef, "exact_receiving_operation_ref"),
    stringDigest(exactLocalDependencyRef, "exact_local_dependency_ref"),
    `${digestKey(activeMountSetHash)}.json`,
  );

  const persistence: OwnerLocalP2DurablePersistence = {
    runtime_root: runtimeRoot,

    async persist_mount_record({ receiving_domain_ref, mount_hash, mount }) {
      if (
        mount.receiving_domain_ref !== receiving_domain_ref
        || mount.mount_hash !== mount_hash
        || mount.status !== "INACTIVE"
      ) {
        throw new OwnerLocalP2PersistenceError(
          "P2_DURABLE_MOUNT_IDENTITY_MISMATCH",
          "mount record key must match exact retained INACTIVE mount identity",
        );
      }
      await persistImmutableExact(mountPath(receiving_domain_ref, mount_hash), mount);
    },

    async read_mount_record({ receiving_domain_ref, mount_hash }) {
      const record = await readCanonicalObject(
        mountPath(receiving_domain_ref, mount_hash),
      );
      if (
        record !== undefined
        && (
          record.receiving_domain_ref !== receiving_domain_ref
          || record.mount_hash !== mount_hash
          || record.status !== "INACTIVE"
        )
      ) {
        throw new OwnerLocalP2PersistenceError(
          "P2_DURABLE_MOUNT_IDENTITY_MISMATCH",
          "retained mount record does not match durable key",
        );
      }
      return record;
    },

    async persist_mount_set_record({
      receiving_domain_ref,
      mount_set_hash,
      mount_set,
    }) {
      if (
        mount_set.receiving_domain_ref !== receiving_domain_ref
        || mount_set.mount_set_hash !== mount_set_hash
        || mount_set.status !== "INACTIVE"
      ) {
        throw new OwnerLocalP2PersistenceError(
          "P2_DURABLE_MOUNT_SET_IDENTITY_MISMATCH",
          "mount-set record key must match exact retained INACTIVE mount-set identity",
        );
      }
      await persistImmutableExact(
        mountSetPath(receiving_domain_ref, mount_set_hash),
        mount_set,
      );
    },

    async read_mount_set_record({ receiving_domain_ref, mount_set_hash }) {
      const record = await readCanonicalObject(
        mountSetPath(receiving_domain_ref, mount_set_hash),
      );
      if (
        record !== undefined
        && (
          record.receiving_domain_ref !== receiving_domain_ref
          || record.mount_set_hash !== mount_set_hash
          || record.status !== "INACTIVE"
        )
      ) {
        throw new OwnerLocalP2PersistenceError(
          "P2_DURABLE_MOUNT_SET_IDENTITY_MISMATCH",
          "retained mount-set record does not match durable key",
        );
      }
      return record;
    },

    async reverify_implementation_material({
      receiving_domain_ref,
      mount_hash,
      implementation_binding_hash,
      resolver_state,
    }) {
      nonEmptyString(receiving_domain_ref, "receiving_domain_ref");
      sha256Value(mount_hash, "mount_hash");
      const exactBindingHash = sha256Value(
        implementation_binding_hash,
        "implementation_binding_hash",
      );
      if (sha256Json(resolver_state) !== exactBindingHash) {
        throw new OwnerLocalP2PersistenceError(
          "P2_IMPLEMENTATION_BINDING_HASH_MISMATCH",
          "resolver_state does not match exact mount implementation_binding_hash",
        );
      }
      await readAndVerifyInstalledImplementationMaterial(
        resolverBinding(resolver_state),
        options.material_read_port,
      );
    },

    async read_active_mount_set_pointer({ receiving_domain_ref }) {
      const pointer = await readCanonicalObject(pointerPath(receiving_domain_ref));
      if (
        pointer !== undefined
        && (
          pointer.status !== "ACTIVE"
          || pointer.receiving_domain_ref !== receiving_domain_ref
        )
      ) {
        throw new OwnerLocalP2PersistenceError(
          "P2_DURABLE_POINTER_IDENTITY_MISMATCH",
          "active mount-set pointer does not match receiving Domain",
        );
      }
      if (pointer !== undefined) {
        sha256Value(pointer.mount_set_hash, "active_pointer.mount_set_hash");
      }
      return pointer;
    },

    async switch_active_mount_set_pointer({
      receiving_domain_ref,
      mount_set_hash,
      previous_active_pointer,
    }) {
      const domain = nonEmptyString(receiving_domain_ref, "receiving_domain_ref");
      const nextHash = sha256Value(mount_set_hash, "mount_set_hash");
      const path = pointerPath(domain);
      const current = await readCanonicalObject(path);

      if (previous_active_pointer === undefined) {
        if (current !== undefined) {
          throw new OwnerLocalP2PersistenceError(
            "P2_DURABLE_POINTER_COMPARE_FAILED",
            "active pointer appeared after activation pre-read",
          );
        }
      } else if (
        current === undefined
        || canonical(current) !== canonical(previous_active_pointer)
      ) {
        throw new OwnerLocalP2PersistenceError(
          "P2_DURABLE_POINTER_COMPARE_FAILED",
          "active pointer changed since activation pre-read",
        );
      }

      await replaceMutableExact(path, Object.freeze({
        receiving_domain_ref: domain,
        mount_set_hash: nextHash,
        status: "ACTIVE",
      }));

      const readback = await readCanonicalObject(path);
      if (
        readback === undefined
        || readback.receiving_domain_ref !== domain
        || readback.mount_set_hash !== nextHash
        || readback.status !== "ACTIVE"
      ) {
        throw new OwnerLocalP2PersistenceError(
          "P2_DURABLE_EXACT_READBACK_MISMATCH",
          "active mount-set pointer exact durable readback failed",
        );
      }
    },

    async persist_dependency_binding_record({
      receiving_domain_ref,
      exact_owner_capability_ref,
      exact_receiving_operation_ref,
      exact_local_dependency_ref,
      active_mount_set_hash,
      binding_hash,
      binding,
    }) {
      const domain = nonEmptyString(receiving_domain_ref, "receiving_domain_ref");
      const ownerCapabilityRef = nonEmptyString(
        exact_owner_capability_ref,
        "exact_owner_capability_ref",
      );
      const receivingOperationRef = nonEmptyString(
        exact_receiving_operation_ref,
        "exact_receiving_operation_ref",
      );
      const dependencyRef = nonEmptyString(
        exact_local_dependency_ref,
        "exact_local_dependency_ref",
      );
      const activeHash = sha256Value(active_mount_set_hash, "active_mount_set_hash");
      const expectedBindingHash = sha256Value(binding_hash, "binding_hash");
      const identity = dependencyBindingIdentity(binding);
      if (
        identity.exact_owner_capability_ref !== ownerCapabilityRef
        || identity.exact_receiving_operation_ref !== receivingOperationRef
        || identity.exact_local_dependency_ref !== dependencyRef
        || identity.active_mount_set_hash !== activeHash
        || identity.binding_hash !== expectedBindingHash
      ) {
        throw new OwnerLocalP2PersistenceError(
          "P2_DURABLE_DEPENDENCY_BINDING_IDENTITY_MISMATCH",
          "dependency realization binding does not match the exact five-field durable key",
        );
      }
      const path = dependencyBindingPath(
        domain,
        ownerCapabilityRef,
        receivingOperationRef,
        dependencyRef,
        activeHash,
      );
      await persistImmutableExact(path, binding);
      const readback = await readCanonicalObject(path);
      if (readback === undefined || canonical(readback) !== canonical(binding)) {
        throw new OwnerLocalP2PersistenceError(
          "P2_DURABLE_EXACT_READBACK_MISMATCH",
          "dependency realization exact durable readback failed",
        );
      }
      const readbackIdentity = dependencyBindingIdentity(readback);
      if (
        readbackIdentity.exact_owner_capability_ref !== ownerCapabilityRef
        || readbackIdentity.exact_receiving_operation_ref !== receivingOperationRef
        || readbackIdentity.exact_local_dependency_ref !== dependencyRef
        || readbackIdentity.active_mount_set_hash !== activeHash
        || readbackIdentity.binding_hash !== expectedBindingHash
      ) {
        throw new OwnerLocalP2PersistenceError(
          "P2_DURABLE_DEPENDENCY_BINDING_IDENTITY_MISMATCH",
          "dependency realization durable readback identity mismatch",
        );
      }
    },

    async read_dependency_binding_record({
      receiving_domain_ref,
      exact_owner_capability_ref,
      exact_receiving_operation_ref,
      exact_local_dependency_ref,
      active_mount_set_hash,
    }) {
      const domain = nonEmptyString(receiving_domain_ref, "receiving_domain_ref");
      const ownerCapabilityRef = nonEmptyString(
        exact_owner_capability_ref,
        "exact_owner_capability_ref",
      );
      const receivingOperationRef = nonEmptyString(
        exact_receiving_operation_ref,
        "exact_receiving_operation_ref",
      );
      const dependencyRef = nonEmptyString(
        exact_local_dependency_ref,
        "exact_local_dependency_ref",
      );
      const activeHash = sha256Value(active_mount_set_hash, "active_mount_set_hash");
      const record = await readCanonicalObject(
        dependencyBindingPath(
          domain,
          ownerCapabilityRef,
          receivingOperationRef,
          dependencyRef,
          activeHash,
        ),
      );
      if (record === undefined) return undefined;
      const identity = dependencyBindingIdentity(record);
      if (
        identity.exact_owner_capability_ref !== ownerCapabilityRef
        || identity.exact_receiving_operation_ref !== receivingOperationRef
        || identity.exact_local_dependency_ref !== dependencyRef
        || identity.active_mount_set_hash !== activeHash
      ) {
        throw new OwnerLocalP2PersistenceError(
          "P2_DURABLE_DEPENDENCY_BINDING_IDENTITY_MISMATCH",
          "dependency realization durable record does not match the exact five-field key",
        );
      }
      return record;
    },
  };

  return Object.freeze(persistence);
}
