import { createHash } from "node:crypto";

import {
  readAndVerifyInstalledImplementationMaterial,
} from "./implementation_material_runtime.ts";
import type {
  LocalImplementationMaterialReadPort,
  ResolvedImplementationBinding,
} from "./implementation_material_runtime.ts";

export type JsonObject = Readonly<Record<string, unknown>>;

export interface PostgresQueryPort {
  query<Row extends JsonObject = JsonObject>(
    statement: string,
    parameters?: readonly unknown[],
  ): Promise<readonly Row[]>;
}

export interface OwnerLocalP2PostgresTables {
  readonly provider_publication: string;
  readonly provider_interface_projection: string;
  readonly consumer_mount: string;
  readonly consumer_mount_set: string;
  readonly consumer_active_mount_set_pointer: string;
  readonly consumer_dependency_binding?: string;
}

export interface OwnerLocalP2PostgresOptions {
  readonly database: PostgresQueryPort;
  readonly tables: OwnerLocalP2PostgresTables;
  readonly material_read_port: LocalImplementationMaterialReadPort;
}

export class OwnerLocalP2PostgresError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "OwnerLocalP2PostgresError";
    this.code = code;
  }
}

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const QUALIFIED_IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/;

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new OwnerLocalP2PostgresError(
      "P2_DATABASE_IDENTITY_INVALID",
      `${field} must be a non-empty string`,
    );
  }
  return value;
}

function sha256Value(value: unknown, field: string): string {
  const text = nonEmptyString(value, field);
  if (!SHA256_PATTERN.test(text)) {
    throw new OwnerLocalP2PostgresError(
      "P2_DATABASE_IDENTITY_INVALID",
      `${field} must be an exact sha256 binding`,
    );
  }
  return text;
}

function objectValue(value: unknown, field: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new OwnerLocalP2PostgresError(
      "P2_DATABASE_RECORD_INVALID",
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
        throw new OwnerLocalP2PostgresError(
          "P2_DATABASE_RECORD_INVALID",
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
    throw new OwnerLocalP2PostgresError(
      "P2_DATABASE_RECORD_INVALID",
      "database runtime facts must be exact JSON values",
    );
  }
  return value;
}

function canonical(value: unknown): string {
  const serialized = JSON.stringify(stableClone(value));
  if (serialized === undefined) {
    throw new OwnerLocalP2PostgresError(
      "P2_DATABASE_RECORD_INVALID",
      "database runtime fact did not produce exact JSON text",
    );
  }
  return serialized;
}

function sha256Json(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonical(value), "utf8").digest("hex")}`;
}

function parseCanonicalRecord(recordText: unknown, field: string): JsonObject {
  const text = nonEmptyString(recordText, field);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new OwnerLocalP2PostgresError(
      "P2_DATABASE_RECORD_INVALID",
      `${field} is not valid JSON`,
      { cause: error },
    );
  }
  const record = objectValue(parsed, field);
  if (canonical(record) !== text) {
    throw new OwnerLocalP2PostgresError(
      "P2_DATABASE_EXACT_READBACK_MISMATCH",
      `${field} is not exact canonical JSON text`,
    );
  }
  return record;
}

function tableIdentifier(value: string, field: string): string {
  const exact = nonEmptyString(value, field);
  if (!QUALIFIED_IDENTIFIER_PATTERN.test(exact)) {
    throw new OwnerLocalP2PostgresError(
      "P2_DATABASE_TABLE_BINDING_INVALID",
      `${field} must be an exact schema.table identifier`,
    );
  }
  return exact
    .split(".")
    .map((part) => `"${part}"`)
    .join(".");
}

function exactCapabilityContractRef(value: unknown, field: string): string {
  const text = nonEmptyString(value, field);
  if (!/@V\d{4}$/.test(text)) {
    throw new OwnerLocalP2PostgresError(
      "P2_CAPABILITY_CONTRACT_INVALID",
      `${field} must be exact-versioned`,
    );
  }
  return text;
}

function providerInterfaceRefs(
  publication: JsonObject,
  capabilityContractRef: string,
): readonly string[] {
  const value = publication.provider_interface_refs;
  if (!Array.isArray(value) || value.length === 0) {
    throw new OwnerLocalP2PostgresError(
      "P2_PUBLICATION_INVALID",
      "publication.provider_interface_refs must be a non-empty array",
    );
  }
  const refs = value.map((item, index) =>
    nonEmptyString(item, `publication.provider_interface_refs[${index}]`));
  const seen = new Set<string>();
  for (const ref of refs) {
    if (!ref.startsWith(`${capabilityContractRef}#/interfaces/`)) {
      throw new OwnerLocalP2PostgresError(
        "P2_INTERFACE_MEMBER_MISMATCH",
        "provider Interface does not belong to publication Capability Contract",
      );
    }
    if (seen.has(ref)) {
      throw new OwnerLocalP2PostgresError(
        "P2_PUBLICATION_INVALID",
        "publication.provider_interface_refs must not contain duplicates",
      );
    }
    seen.add(ref);
  }
  return Object.freeze([...refs]);
}

function resolverBinding(resolverState: JsonObject): ResolvedImplementationBinding {
  if (resolverState.verified !== true) {
    throw new OwnerLocalP2PostgresError(
      "P2_RESOLVER_STATE_NOT_VERIFIED",
      "verified resolver state required",
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
    throw new OwnerLocalP2PostgresError(
      "P2_DATABASE_DEPENDENCY_BINDING_INVALID",
      "mounted dependency persistence requires ACTIVE_MOUNT_SET_MEMBER binding",
    );
  }
  if (binding.creates_or_writes_p1_business_semantics !== false) {
    throw new OwnerLocalP2PostgresError(
      "P2_DATABASE_DEPENDENCY_BINDING_INVALID",
      "persisted dependency realization must not write P1 business semantics",
    );
  }
  const verified = objectValue(
    binding.verified_provider_binding_or_governed_data_binding,
    "dependency_realization_binding.verified_provider_binding_or_governed_data_binding",
  );
  if (verified.source_binding_kind !== "ACTIVE_MOUNT_SET_MEMBER") {
    throw new OwnerLocalP2PostgresError(
      "P2_DATABASE_DEPENDENCY_BINDING_INVALID",
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
    throw new OwnerLocalP2PostgresError(
      "P2_DATABASE_DEPENDENCY_BINDING_HASH_MISMATCH",
      "dependency realization binding_hash mismatch",
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

export interface ProviderPublicationSearchResult {
  readonly capability_contract_ref: string;
  readonly publication_hash: string;
  readonly publication: JsonObject;
}

export interface OwnerLocalP2PostgresPersistence {
  persist_publication_record(input: Readonly<{
    capability_contract_ref: string;
    publication_hash: string;
    publication: JsonObject;
  }>): Promise<void>;
  read_publication_record(input: Readonly<{
    capability_contract_ref: string;
    publication_hash: string;
  }>): Promise<JsonObject | undefined>;
  find_publications_by_interface(input: Readonly<{
    exact_interface_ref: string;
  }>): Promise<readonly ProviderPublicationSearchResult[]>;

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
  read_active_mount_set_pointer(input: Readonly<{
    receiving_domain_ref: string;
  }>): Promise<JsonObject | undefined>;
  switch_active_mount_set_pointer(input: Readonly<{
    receiving_domain_ref: string;
    mount_set_hash: string;
    previous_active_pointer?: JsonObject;
  }>): Promise<void>;
  reverify_implementation_material(input: Readonly<{
    receiving_domain_ref: string;
    mount_hash: string;
    implementation_binding_hash: string;
    resolver_state: JsonObject;
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

export function createOwnerLocalP2PostgresPersistence(
  options: OwnerLocalP2PostgresOptions,
): OwnerLocalP2PostgresPersistence {
  const publicationTable = tableIdentifier(
    options.tables.provider_publication,
    "tables.provider_publication",
  );
  const interfaceTable = tableIdentifier(
    options.tables.provider_interface_projection,
    "tables.provider_interface_projection",
  );
  const mountTable = tableIdentifier(
    options.tables.consumer_mount,
    "tables.consumer_mount",
  );
  const mountSetTable = tableIdentifier(
    options.tables.consumer_mount_set,
    "tables.consumer_mount_set",
  );
  const pointerTable = tableIdentifier(
    options.tables.consumer_active_mount_set_pointer,
    "tables.consumer_active_mount_set_pointer",
  );
  const dependencyTable = options.tables.consumer_dependency_binding === undefined
    ? undefined
    : tableIdentifier(
      options.tables.consumer_dependency_binding,
      "tables.consumer_dependency_binding",
    );
  const dependencyTableRequired = (): string => {
    if (dependencyTable === undefined) {
      throw new OwnerLocalP2PostgresError(
        "P2_DATABASE_DEPENDENCY_PERSISTENCE_NOT_CONFIGURED",
        "consumer_dependency_binding is required only when declared P1 dependency realization is used",
      );
    }
    return dependencyTable;
  };

  const store: OwnerLocalP2PostgresPersistence = {
    async persist_publication_record({
      capability_contract_ref,
      publication_hash,
      publication,
    }) {
      const contractRef = exactCapabilityContractRef(
        capability_contract_ref,
        "capability_contract_ref",
      );
      const publicationHash = sha256Value(publication_hash, "publication_hash");
      if (
        publication.capability_contract_ref !== contractRef
        || publication.publication_hash !== publicationHash
        || publication.immutable !== true
      ) {
        throw new OwnerLocalP2PostgresError(
          "P2_DATABASE_PUBLICATION_IDENTITY_MISMATCH",
          "publication key does not match exact immutable publication identity",
        );
      }
      const interfaces = providerInterfaceRefs(publication, contractRef);
      const recordText = canonical(publication);

      await options.database.query(
        `insert into ${publicationTable} (capability_contract_ref, publication_hash, record_text) values ($1,$2,$3) on conflict (capability_contract_ref, publication_hash) do nothing`,
        [contractRef, publicationHash, recordText],
      );
      const readback = await store.read_publication_record({
        capability_contract_ref: contractRef,
        publication_hash: publicationHash,
      });
      if (readback === undefined || canonical(readback) !== recordText) {
        throw new OwnerLocalP2PostgresError(
          "P2_DATABASE_EXACT_READBACK_MISMATCH",
          "Provider publication exact database readback failed",
        );
      }

      for (const exactInterfaceRef of interfaces) {
        await options.database.query(
          `insert into ${interfaceTable} (exact_interface_ref, capability_contract_ref, publication_hash) values ($1,$2,$3) on conflict (exact_interface_ref, publication_hash) do nothing`,
          [exactInterfaceRef, contractRef, publicationHash],
        );
      }
      for (const exactInterfaceRef of interfaces) {
        const found = await store.find_publications_by_interface({
          exact_interface_ref: exactInterfaceRef,
        });
        if (!found.some((entry) =>
          entry.capability_contract_ref === contractRef
          && entry.publication_hash === publicationHash
        )) {
          throw new OwnerLocalP2PostgresError(
            "P2_DATABASE_EXACT_READBACK_MISMATCH",
            "Provider Interface projection exact database readback failed",
          );
        }
      }
    },

    async read_publication_record({ capability_contract_ref, publication_hash }) {
      const contractRef = exactCapabilityContractRef(
        capability_contract_ref,
        "capability_contract_ref",
      );
      const publicationHash = sha256Value(publication_hash, "publication_hash");
      const rows = await options.database.query<{
        readonly record_text: string;
      }>(
        `select record_text from ${publicationTable} where capability_contract_ref=$1 and publication_hash=$2`,
        [contractRef, publicationHash],
      );
      if (rows.length === 0) return undefined;
      if (rows.length !== 1) {
        throw new OwnerLocalP2PostgresError(
          "P2_DATABASE_RECORD_INVALID",
          "Provider publication lookup returned duplicate identity rows",
        );
      }
      const record = parseCanonicalRecord(rows[0]?.record_text, "publication.record_text");
      if (
        record.capability_contract_ref !== contractRef
        || record.publication_hash !== publicationHash
      ) {
        throw new OwnerLocalP2PostgresError(
          "P2_DATABASE_PUBLICATION_IDENTITY_MISMATCH",
          "Provider publication readback identity mismatch",
        );
      }
      return record;
    },

    async find_publications_by_interface({ exact_interface_ref }) {
      const interfaceRef = nonEmptyString(exact_interface_ref, "exact_interface_ref");
      const rows = await options.database.query<{
        readonly capability_contract_ref: string;
        readonly publication_hash: string;
        readonly record_text: string;
      }>(
        `select p.capability_contract_ref, p.publication_hash, p.record_text from ${interfaceTable} i join ${publicationTable} p on p.capability_contract_ref=i.capability_contract_ref and p.publication_hash=i.publication_hash where i.exact_interface_ref=$1 order by p.capability_contract_ref, p.publication_hash`,
        [interfaceRef],
      );
      return Object.freeze(rows.map((row) => {
        const publication = parseCanonicalRecord(row.record_text, "publication.record_text");
        const contractRef = exactCapabilityContractRef(
          row.capability_contract_ref,
          "capability_contract_ref",
        );
        const publicationHash = sha256Value(row.publication_hash, "publication_hash");
        if (!providerInterfaceRefs(publication, contractRef).includes(interfaceRef)) {
          throw new OwnerLocalP2PostgresError(
            "P2_DATABASE_INTERFACE_PROJECTION_MISMATCH",
            "Interface index does not match exact Provider publication surface",
          );
        }
        return Object.freeze({
          capability_contract_ref: contractRef,
          publication_hash: publicationHash,
          publication,
        });
      }));
    },

    async persist_mount_record({ receiving_domain_ref, mount_hash, mount }) {
      const domain = nonEmptyString(receiving_domain_ref, "receiving_domain_ref");
      const mountHash = sha256Value(mount_hash, "mount_hash");
      if (
        mount.receiving_domain_ref !== domain
        || mount.mount_hash !== mountHash
        || mount.status !== "INACTIVE"
      ) {
        throw new OwnerLocalP2PostgresError(
          "P2_DATABASE_MOUNT_IDENTITY_MISMATCH",
          "mount key must match exact retained INACTIVE mount identity",
        );
      }
      const recordText = canonical(mount);
      await options.database.query(
        `insert into ${mountTable} (receiving_domain_ref, mount_hash, record_text) values ($1,$2,$3) on conflict (receiving_domain_ref, mount_hash) do nothing`,
        [domain, mountHash, recordText],
      );
      const readback = await store.read_mount_record({
        receiving_domain_ref: domain,
        mount_hash: mountHash,
      });
      if (readback === undefined || canonical(readback) !== recordText) {
        throw new OwnerLocalP2PostgresError(
          "P2_DATABASE_EXACT_READBACK_MISMATCH",
          "mount exact database readback failed",
        );
      }
    },

    async read_mount_record({ receiving_domain_ref, mount_hash }) {
      const domain = nonEmptyString(receiving_domain_ref, "receiving_domain_ref");
      const mountHash = sha256Value(mount_hash, "mount_hash");
      const rows = await options.database.query<{ readonly record_text: string }>(
        `select record_text from ${mountTable} where receiving_domain_ref=$1 and mount_hash=$2`,
        [domain, mountHash],
      );
      if (rows.length === 0) return undefined;
      if (rows.length !== 1) throw new OwnerLocalP2PostgresError("P2_DATABASE_RECORD_INVALID", "mount lookup returned duplicate rows");
      const record = parseCanonicalRecord(rows[0]?.record_text, "mount.record_text");
      if (record.receiving_domain_ref !== domain || record.mount_hash !== mountHash || record.status !== "INACTIVE") {
        throw new OwnerLocalP2PostgresError("P2_DATABASE_MOUNT_IDENTITY_MISMATCH", "mount readback identity mismatch");
      }
      return record;
    },

    async persist_mount_set_record({ receiving_domain_ref, mount_set_hash, mount_set }) {
      const domain = nonEmptyString(receiving_domain_ref, "receiving_domain_ref");
      const mountSetHash = sha256Value(mount_set_hash, "mount_set_hash");
      if (
        mount_set.receiving_domain_ref !== domain
        || mount_set.mount_set_hash !== mountSetHash
        || mount_set.status !== "INACTIVE"
      ) {
        throw new OwnerLocalP2PostgresError("P2_DATABASE_MOUNT_SET_IDENTITY_MISMATCH", "mount-set key must match exact retained INACTIVE mount-set identity");
      }
      const recordText = canonical(mount_set);
      await options.database.query(
        `insert into ${mountSetTable} (receiving_domain_ref, mount_set_hash, record_text) values ($1,$2,$3) on conflict (receiving_domain_ref, mount_set_hash) do nothing`,
        [domain, mountSetHash, recordText],
      );
      const readback = await store.read_mount_set_record({ receiving_domain_ref: domain, mount_set_hash: mountSetHash });
      if (readback === undefined || canonical(readback) !== recordText) {
        throw new OwnerLocalP2PostgresError("P2_DATABASE_EXACT_READBACK_MISMATCH", "mount-set exact database readback failed");
      }
    },

    async read_mount_set_record({ receiving_domain_ref, mount_set_hash }) {
      const domain = nonEmptyString(receiving_domain_ref, "receiving_domain_ref");
      const mountSetHash = sha256Value(mount_set_hash, "mount_set_hash");
      const rows = await options.database.query<{ readonly record_text: string }>(
        `select record_text from ${mountSetTable} where receiving_domain_ref=$1 and mount_set_hash=$2`,
        [domain, mountSetHash],
      );
      if (rows.length === 0) return undefined;
      if (rows.length !== 1) throw new OwnerLocalP2PostgresError("P2_DATABASE_RECORD_INVALID", "mount-set lookup returned duplicate rows");
      const record = parseCanonicalRecord(rows[0]?.record_text, "mount_set.record_text");
      if (record.receiving_domain_ref !== domain || record.mount_set_hash !== mountSetHash || record.status !== "INACTIVE") {
        throw new OwnerLocalP2PostgresError("P2_DATABASE_MOUNT_SET_IDENTITY_MISMATCH", "mount-set readback identity mismatch");
      }
      return record;
    },

    async read_active_mount_set_pointer({ receiving_domain_ref }) {
      const domain = nonEmptyString(receiving_domain_ref, "receiving_domain_ref");
      const rows = await options.database.query<{ readonly record_text: string }>(
        `select record_text from ${pointerTable} where receiving_domain_ref=$1`,
        [domain],
      );
      if (rows.length === 0) return undefined;
      if (rows.length !== 1) throw new OwnerLocalP2PostgresError("P2_DATABASE_RECORD_INVALID", "active pointer lookup returned duplicate rows");
      const record = parseCanonicalRecord(rows[0]?.record_text, "active_pointer.record_text");
      if (record.receiving_domain_ref !== domain || record.status !== "ACTIVE") {
        throw new OwnerLocalP2PostgresError("P2_DATABASE_POINTER_IDENTITY_MISMATCH", "active pointer readback identity mismatch");
      }
      sha256Value(record.mount_set_hash, "active_pointer.mount_set_hash");
      return record;
    },

    async switch_active_mount_set_pointer({ receiving_domain_ref, mount_set_hash, previous_active_pointer }) {
      const domain = nonEmptyString(receiving_domain_ref, "receiving_domain_ref");
      const mountSetHash = sha256Value(mount_set_hash, "mount_set_hash");
      const next = Object.freeze({ receiving_domain_ref: domain, mount_set_hash: mountSetHash, status: "ACTIVE" });
      const nextText = canonical(next);
      let rows: readonly JsonObject[];
      if (previous_active_pointer === undefined) {
        rows = await options.database.query(
          `insert into ${pointerTable} (receiving_domain_ref, mount_set_hash, record_text) values ($1,$2,$3) on conflict (receiving_domain_ref) do nothing returning receiving_domain_ref`,
          [domain, mountSetHash, nextText],
        );
      } else {
        rows = await options.database.query(
          `update ${pointerTable} set mount_set_hash=$2, record_text=$3 where receiving_domain_ref=$1 and record_text=$4 returning receiving_domain_ref`,
          [domain, mountSetHash, nextText, canonical(previous_active_pointer)],
        );
      }
      if (rows.length !== 1) {
        throw new OwnerLocalP2PostgresError(
          "P2_DATABASE_POINTER_COMPARE_FAILED",
          "active mount-set pointer changed since activation pre-read",
        );
      }
      const readback = await store.read_active_mount_set_pointer({ receiving_domain_ref: domain });
      if (readback === undefined || canonical(readback) !== nextText) {
        throw new OwnerLocalP2PostgresError("P2_DATABASE_EXACT_READBACK_MISMATCH", "active mount-set pointer exact database readback failed");
      }
    },

    async reverify_implementation_material({ receiving_domain_ref, mount_hash, implementation_binding_hash, resolver_state }) {
      nonEmptyString(receiving_domain_ref, "receiving_domain_ref");
      sha256Value(mount_hash, "mount_hash");
      const bindingHash = sha256Value(implementation_binding_hash, "implementation_binding_hash");
      if (sha256Json(resolver_state) !== bindingHash) {
        throw new OwnerLocalP2PostgresError("P2_IMPLEMENTATION_BINDING_HASH_MISMATCH", "resolver_state does not match mount implementation_binding_hash");
      }
      await readAndVerifyInstalledImplementationMaterial(
        resolverBinding(resolver_state),
        options.material_read_port,
      );
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
      const ownerCapabilityRef = nonEmptyString(exact_owner_capability_ref, "exact_owner_capability_ref");
      const receivingOperationRef = nonEmptyString(exact_receiving_operation_ref, "exact_receiving_operation_ref");
      const localDependency = nonEmptyString(exact_local_dependency_ref, "exact_local_dependency_ref");
      const mountSetHash = sha256Value(active_mount_set_hash, "active_mount_set_hash");
      const bindingHash = sha256Value(binding_hash, "binding_hash");
      const identity = dependencyBindingIdentity(binding);
      if (
        identity.exact_owner_capability_ref !== ownerCapabilityRef
        || identity.exact_receiving_operation_ref !== receivingOperationRef
        || identity.exact_local_dependency_ref !== localDependency
        || identity.active_mount_set_hash !== mountSetHash
        || identity.binding_hash !== bindingHash
      ) {
        throw new OwnerLocalP2PostgresError(
          "P2_DATABASE_DEPENDENCY_BINDING_IDENTITY_MISMATCH",
          "dependency realization binding does not match the exact five-field durable key",
        );
      }
      const recordText = canonical(binding);
      await options.database.query(
        `insert into ${dependencyTableRequired()} (receiving_domain_ref, exact_owner_capability_ref, exact_receiving_operation_ref, exact_local_dependency_ref, active_mount_set_hash, binding_hash, record_text) values ($1,$2,$3,$4,$5,$6,$7) on conflict (receiving_domain_ref, exact_owner_capability_ref, exact_receiving_operation_ref, exact_local_dependency_ref, active_mount_set_hash) do nothing`,
        [domain, ownerCapabilityRef, receivingOperationRef, localDependency, mountSetHash, bindingHash, recordText],
      );
      const readback = await store.read_dependency_binding_record({
        receiving_domain_ref: domain,
        exact_owner_capability_ref: ownerCapabilityRef,
        exact_receiving_operation_ref: receivingOperationRef,
        exact_local_dependency_ref: localDependency,
        active_mount_set_hash: mountSetHash,
      });
      if (readback === undefined || canonical(readback) !== recordText) {
        throw new OwnerLocalP2PostgresError("P2_DATABASE_EXACT_READBACK_MISMATCH", "dependency realization binding exact database readback failed");
      }
      const readbackIdentity = dependencyBindingIdentity(readback);
      if (
        readbackIdentity.exact_owner_capability_ref !== ownerCapabilityRef
        || readbackIdentity.exact_receiving_operation_ref !== receivingOperationRef
        || readbackIdentity.exact_local_dependency_ref !== localDependency
        || readbackIdentity.active_mount_set_hash !== mountSetHash
        || readbackIdentity.binding_hash !== bindingHash
      ) {
        throw new OwnerLocalP2PostgresError(
          "P2_DATABASE_DEPENDENCY_BINDING_IDENTITY_MISMATCH",
          "dependency realization database readback identity mismatch",
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
      const ownerCapabilityRef = nonEmptyString(exact_owner_capability_ref, "exact_owner_capability_ref");
      const receivingOperationRef = nonEmptyString(exact_receiving_operation_ref, "exact_receiving_operation_ref");
      const localDependency = nonEmptyString(exact_local_dependency_ref, "exact_local_dependency_ref");
      const mountSetHash = sha256Value(active_mount_set_hash, "active_mount_set_hash");
      const rows = await options.database.query<{ readonly record_text: string }>(
        `select record_text from ${dependencyTableRequired()} where receiving_domain_ref=$1 and exact_owner_capability_ref=$2 and exact_receiving_operation_ref=$3 and exact_local_dependency_ref=$4 and active_mount_set_hash=$5`,
        [domain, ownerCapabilityRef, receivingOperationRef, localDependency, mountSetHash],
      );
      if (rows.length === 0) return undefined;
      if (rows.length !== 1) throw new OwnerLocalP2PostgresError("P2_DATABASE_RECORD_INVALID", "dependency binding lookup returned duplicate rows");
      const record = parseCanonicalRecord(rows[0]?.record_text, "dependency_binding.record_text");
      const identity = dependencyBindingIdentity(record);
      if (
        identity.exact_owner_capability_ref !== ownerCapabilityRef
        || identity.exact_receiving_operation_ref !== receivingOperationRef
        || identity.exact_local_dependency_ref !== localDependency
        || identity.active_mount_set_hash !== mountSetHash
      ) {
        throw new OwnerLocalP2PostgresError(
          "P2_DATABASE_DEPENDENCY_BINDING_IDENTITY_MISMATCH",
          "dependency realization database record does not match the exact five-field key",
        );
      }
      return record;
    },
  };

  return Object.freeze(store);
}
