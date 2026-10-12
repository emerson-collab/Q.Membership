import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  GOVERNED_DATA_TRIAD_CATEGORY_PARTITION_REF,
  GOVERNED_DATA_TRIAD_EXECUTION_BOUNDARY_REF,
  GOVERNED_DATA_TRIAD_SCHEMA_REF,
  GOVERNED_DATA_TRIAD_SET_HASH_ALGORITHM,
  GOVERNED_DATA_TRIAD_SET_INTEGRITY_REF,
  GOVERNED_DATA_TRIAD_SOURCE_BOUNDARY_REF,
  P1_BUSINESS_RUNTIME_REF,
  P1_CAPABILITY_MATERIALIZATION_HASH,
  P1_CAPABILITY_MATERIALIZATION_REF,
  P2_CONTRACT_HASH,
  P2_CONTRACT_REF,
  REPOSITORY_SKELETON_HASH,
  REPOSITORY_SKELETON_REF,
  GovernedDataProviderRealizationError,
  realizeGovernedDataTriad,
  type GovernedDataBindingExecution,
  type GovernedDataCategory,
  type GovernedDataHandoffBinding,
  type P2GovernedDataExposureMaterializer,
  type GovernedDataTriadDurableStore,
  type GovernedDataFilename,
  type SourceAccessKind,
} from "../../../runtime/governed_data_provider_realization.ts";

const CAPABILITY_CONTRACT_REF = "Q.TEST.CONTRACT.CAPABILITY.EXAMPLE@V0100";
const CAPABILITY_CONTRACT_HASH = `sha256:${"b".repeat(64)}`;
const OWNER_REF = "Q.TEST.CONTRACT.DOMAIN.EXAMPLE@V0100";
const INTEGRITY_REF = "Q.TEST.INTEGRITY.PROFILE@V0100";
const HANDOFF_SOURCE_REF =
  `${P1_CAPABILITY_MATERIALIZATION_REF}#/p1_to_p2_handoff_declaration_contract`;

function canonicalClone(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalClone);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) out[key] = canonicalClone(source[key]);
    return out;
  }
  return value;
}

function canonical(value: unknown): string {
  return JSON.stringify(canonicalClone(value));
}

function hash(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonical(value), "utf8").digest("hex")}`;
}

function sourceKind(category: GovernedDataCategory): SourceAccessKind {
  if (category === "STATIC") return "P1_AUTHORIZED_STATIC_OR_PACKAGE_FACT";
  if (category === "DYNAMIC") return "AUTHORIZED_GOVERNED_STATE_OR_REGISTRY_FACT";
  return "ALREADY_PRODUCED_RUNTIME_FACT";
}

function binding(
  category: GovernedDataCategory,
  suffix: string,
  kind: SourceAccessKind = sourceKind(category),
): GovernedDataHandoffBinding {
  return Object.freeze({
    binding_ref: `binding:${category.toLowerCase()}:${suffix}`,
    data_category: category,
    source_access_kind: kind,
    source_access_ref: `${CAPABILITY_CONTRACT_REF}#/sources/${category.toLowerCase()}/${suffix}`,
    members: Object.freeze([
      Object.freeze({
        member_ref: `member:${category.toLowerCase()}:${suffix}`,
        source_fact_ref: `${CAPABILITY_CONTRACT_REF}#/facts/${category.toLowerCase()}/${suffix}`,
        source_fact_authority_ref: OWNER_REF,
      }),
    ]),
  });
}

function p2Input(category: GovernedDataCategory, suffix: string) {
  const subjectRef = `subject:${category.toLowerCase()}:${suffix}`;
  const requestedRepresentation = category === "STATIC"
    ? "INLINE_FACT_SET"
    : category === "DYNAMIC"
    ? "ARTIFACT_CHUNKED_SNAPSHOT"
    : "ARTIFACT_SNAPSHOT";
  return Object.freeze({
    source_domain_identity: OWNER_REF,
    subject_identity: subjectRef,
    source_provenance: Object.freeze({
      source_ref: `${CAPABILITY_CONTRACT_REF}#/facts/${category.toLowerCase()}/${suffix}`,
      revision_ref: `revision:${category.toLowerCase()}:${suffix}`,
    }),
    source_fact_authority: OWNER_REF,
    governed_access_binding: Object.freeze({ authorization_ref: `authorization:${suffix}` }),
    integrity_binding: Object.freeze({ profile_ref: INTEGRITY_REF }),
    authorized_exposure_request: Object.freeze({
      subject_ref: subjectRef,
      requested_representation: requestedRepresentation,
      selection_spec: Object.freeze({ scope: "authorized" }),
    }),
    exact_source_authority: Object.freeze({ ref: OWNER_REF }),
    owning_persistence_contract: Object.freeze({ ref: `${OWNER_REF}#/persistence` }),
    integrity_profile: Object.freeze({ ref: INTEGRITY_REF }),
    artifact_store_binding: Object.freeze({ ref: "artifact-store:governed" }),
    ...(category === "RUNTIME" ? { reexecution_requested: false } : {}),
  });
}

function execution(bindingValue: GovernedDataHandoffBinding): GovernedDataBindingExecution {
  const suffix = bindingValue.binding_ref.split(":").at(-1) ?? "x";
  return Object.freeze({
    binding_ref: bindingValue.binding_ref,
    p2_operation_input: p2Input(bindingValue.data_category, suffix),
    runtime_context: Object.freeze({ stage_contract_ref: P2_CONTRACT_REF }),
    trace_id: `trace:${bindingValue.binding_ref}`,
    request_id: `request:${bindingValue.binding_ref}`,
    ...(bindingValue.source_access_kind === "DECLARED_Q_INTERFACE_SOURCE_FACT"
      ? {
          p1_interface_anchor_binding_ref:
            `${P1_BUSINESS_RUNTIME_REF}#/concrete_interface_framework_anchor_crosswalk/anchors/CALL_INVOKE`,
        }
      : {}),
  });
}

function p2Handoff(bindings: readonly GovernedDataHandoffBinding[]) {
  const withoutHash = Object.freeze({
    source_boundary_ref: HANDOFF_SOURCE_REF,
    source_capability_contract_ref: CAPABILITY_CONTRACT_REF,
    source_capability_contract_hash: CAPABILITY_CONTRACT_HASH,
    exact_current_p2_ref: P2_CONTRACT_REF,
    exact_current_p2_hash: P2_CONTRACT_HASH,
    capability_publication: Object.freeze({
      mode: "NONE",
      external_provider_surface_ref: `${CAPABILITY_CONTRACT_REF}#/external_provider_surface`,
    }),
    governed_data_exposure: Object.freeze({
      mode: "DECLARED",
      bindings: Object.freeze([...bindings]),
    }),
    canonical_binding_order: "binding_ref_ASCENDING_THEN_member_ref_ASCENDING",
  });
  return Object.freeze({
    ...withoutHash,
    p2_handoff_obligation_snapshot_hash: hash(withoutHash),
  });
}

function triadObligation(overrides: Readonly<Record<string, unknown>> = {}) {
  return Object.freeze({
    source_boundary_ref: GOVERNED_DATA_TRIAD_SOURCE_BOUNDARY_REF,
    applicability: "DECLARED",
    source_capability_contract_ref: CAPABILITY_CONTRACT_REF,
    source_capability_contract_hash: CAPABILITY_CONTRACT_HASH,
    exact_current_p2_ref: P2_CONTRACT_REF,
    exact_current_p2_hash: P2_CONTRACT_HASH,
    canonical_file_set: Object.freeze({
      STATIC: Object.freeze({
        filename: "static.json",
        p2_operation_id: "expose_static_data",
      }),
      DYNAMIC: Object.freeze({
        filename: "dynamic.json",
        p2_operation_id: "expose_dynamic_data",
      }),
      RUNTIME: Object.freeze({
        filename: "runtime.json",
        p2_operation_id: "expose_runtime_data",
      }),
    }),
    canonical_json_schema_ref: GOVERNED_DATA_TRIAD_SCHEMA_REF,
    category_partition_ref: GOVERNED_DATA_TRIAD_CATEGORY_PARTITION_REF,
    triad_set_integrity_ref: GOVERNED_DATA_TRIAD_SET_INTEGRITY_REF,
    execution_boundary_ref: GOVERNED_DATA_TRIAD_EXECUTION_BOUNDARY_REF,
    ...overrides,
  });
}

function materializer(observed: GovernedDataCategory[]): P2GovernedDataExposureMaterializer {
  return Object.freeze({
    async produce_exposure_material(
      input: Parameters<P2GovernedDataExposureMaterializer["produce_exposure_material"]>[0],
    ) {
      observed.push(input.data_category);
      const request = input.authorized_exposure_request as Readonly<Record<string, unknown>>;
      return Object.freeze({
        material_ref: `urn:q:material:${String(request.subject_ref)}`,
        subject_ref: request.subject_ref,
        owner_ref: OWNER_REF,
        source_ref: `${CAPABILITY_CONTRACT_REF}#/facts/${input.data_category.toLowerCase()}`,
        representation_mode: request.requested_representation,
        content_hash: `sha256:${"a".repeat(64)}`,
        integrity_profile_ref: INTEGRITY_REF,
      });
    },
  });
}

function memoryStore(
  events: string[],
  options: Readonly<{ corrupt_readback_filename?: GovernedDataFilename }> = {},
): GovernedDataTriadDurableStore & Readonly<{
  files: Map<GovernedDataFilename, Uint8Array>;
}> {
  const files = new Map<GovernedDataFilename, Uint8Array>();
  return Object.freeze({
    authority_ref: "Q.TEST.GOVERNED.TRIAD.STORE@V0100",
    files,
    async write_file(input: Parameters<GovernedDataTriadDurableStore["write_file"]>[0]) {
      events.push(`write:${input.filename}`);
      files.set(input.filename, Buffer.from(input.bytes));
    },
    async read_file(input: Parameters<GovernedDataTriadDurableStore["read_file"]>[0]) {
      events.push(`read:${input.filename}`);
      const bytes = files.get(input.filename);
      assert.ok(bytes);
      if (options.corrupt_readback_filename === input.filename) {
        return Buffer.from("{}", "utf8");
      }
      return Buffer.from(bytes);
    },
    async compute_triad_set_hash(input: Parameters<GovernedDataTriadDurableStore["compute_triad_set_hash"]>[0]) {
      events.push("compute-set-hash");
      assert.equal(input.algorithm, GOVERNED_DATA_TRIAD_SET_HASH_ALGORITHM);
      assert.deepEqual(
        input.ordered_files.map((file: { readonly filename: GovernedDataFilename }) => file.filename),
        ["static.json", "dynamic.json", "runtime.json"],
      );
      return `sha256:${"c".repeat(64)}`;
    },
    async commit_verified_triad_and_switch_current(input: Parameters<GovernedDataTriadDurableStore["commit_verified_triad_and_switch_current"]>[0]) {
      events.push("commit-and-switch-current");
      assert.equal(input.triad_set_hash, `sha256:${"c".repeat(64)}`);
      assert.deepEqual(
        input.ordered_files.map((file: { readonly filename: GovernedDataFilename }) => file.filename),
        ["static.json", "dynamic.json", "runtime.json"],
      );
    },
  });
}

test("V0152 realizes exact triad, skips P2 for empty category, and commits only after all readbacks", async () => {
  const staticBinding = binding("STATIC", "a");
  const runtimeBinding = binding("RUNTIME", "r");
  const bindings = Object.freeze([runtimeBinding, staticBinding]);
  const observed: GovernedDataCategory[] = [];
  const events: string[] = [];
  const store = memoryStore(events);

  const result = await realizeGovernedDataTriad(
    Object.freeze({
      p2_handoff_obligation: p2Handoff(bindings),
      governed_data_json_triad_obligation: triadObligation(),
      binding_executions: Object.freeze([
        execution(runtimeBinding),
        execution(staticBinding),
      ]),
    }),
    materializer(observed),
    store,
  );

  assert.equal(result.repository_support_ref, REPOSITORY_SKELETON_REF);
  assert.equal(result.repository_support_hash, REPOSITORY_SKELETON_HASH);
  assert.equal(result.p1_capability_materialization_ref, P1_CAPABILITY_MATERIALIZATION_REF);
  assert.equal(result.p1_capability_materialization_hash, P1_CAPABILITY_MATERIALIZATION_HASH);
  assert.equal(result.p2_contract_ref, P2_CONTRACT_REF);
  assert.equal(result.p2_contract_hash, P2_CONTRACT_HASH);
  assert.deepEqual(observed, ["STATIC", "RUNTIME"]);
  assert.deepEqual(events, [
    "write:static.json",
    "write:dynamic.json",
    "write:runtime.json",
    "read:static.json",
    "read:dynamic.json",
    "read:runtime.json",
    "compute-set-hash",
    "commit-and-switch-current",
  ]);

  const staticBytes = store.files.get("static.json");
  const dynamicBytes = store.files.get("dynamic.json");
  const runtimeBytes = store.files.get("runtime.json");
  assert.ok(staticBytes);
  assert.ok(dynamicBytes);
  assert.ok(runtimeBytes);

  const staticProjection = JSON.parse(Buffer.from(staticBytes).toString("utf8"));
  const dynamicProjection = JSON.parse(Buffer.from(dynamicBytes).toString("utf8"));
  const runtimeProjection = JSON.parse(Buffer.from(runtimeBytes).toString("utf8"));

  assert.equal(staticProjection.schema_ref, GOVERNED_DATA_TRIAD_SCHEMA_REF);
  assert.equal(staticProjection.data_category, "STATIC");
  assert.equal(staticProjection.bindings.length, 1);
  assert.equal(staticProjection.material_envelopes.length, 1);
  assert.equal(dynamicProjection.data_category, "DYNAMIC");
  assert.deepEqual(dynamicProjection.bindings, []);
  assert.deepEqual(dynamicProjection.material_envelopes, []);
  assert.equal(runtimeProjection.data_category, "RUNTIME");
  assert.equal(runtimeProjection.bindings.length, 1);
  assert.equal(runtimeProjection.material_envelopes.length, 1);

  assert.equal(
    Buffer.from(staticBytes).toString("utf8"),
    canonical(staticProjection),
  );
  assert.equal(result.files.STATIC.filename, "static.json");
  assert.equal(result.files.DYNAMIC.filename, "dynamic.json");
  assert.equal(result.files.RUNTIME.filename, "runtime.json");
  assert.equal(result.triad_set_hash_algorithm, GOVERNED_DATA_TRIAD_SET_HASH_ALGORITHM);
});

test("V0152 fails closed when canonical triad resource identity is changed", async () => {
  const staticBinding = binding("STATIC", "a");
  const events: string[] = [];
  await assert.rejects(
    () => realizeGovernedDataTriad(
      Object.freeze({
        p2_handoff_obligation: p2Handoff([staticBinding]),
        governed_data_json_triad_obligation: triadObligation({
          canonical_file_set: Object.freeze({
            STATIC: Object.freeze({
              filename: "wrong.json",
              p2_operation_id: "expose_static_data",
            }),
            DYNAMIC: Object.freeze({
              filename: "dynamic.json",
              p2_operation_id: "expose_dynamic_data",
            }),
            RUNTIME: Object.freeze({
              filename: "runtime.json",
              p2_operation_id: "expose_runtime_data",
            }),
          }),
        }),
        binding_executions: Object.freeze([execution(staticBinding)]),
      }),
      materializer([]),
      memoryStore(events),
    ),
    (error: unknown) =>
      error instanceof GovernedDataProviderRealizationError
      && error.code === "RDS_GOVERNED_DATA_TRIAD_OBLIGATION_INVALID",
  );
  assert.deepEqual(events, []);
});

test("V0152 fails closed instead of reordering noncanonical binding order", async () => {
  const staticBinding = binding("STATIC", "a");
  const runtimeBinding = binding("RUNTIME", "r");
  const noncanonical = Object.freeze([staticBinding, runtimeBinding]);
  const events: string[] = [];
  await assert.rejects(
    () => realizeGovernedDataTriad(
      Object.freeze({
        p2_handoff_obligation: p2Handoff(noncanonical),
        governed_data_json_triad_obligation: triadObligation(),
        binding_executions: Object.freeze([
          execution(staticBinding),
          execution(runtimeBinding),
        ]),
      }),
      materializer([]),
      memoryStore(events),
    ),
    (error: unknown) =>
      error instanceof GovernedDataProviderRealizationError
      && error.code === "RDS_GOVERNED_DATA_BINDING_ORDER_INVALID",
  );
  assert.deepEqual(events, []);
});

test("V0152 requires exactly one execution input for every declared binding", async () => {
  const staticBinding = binding("STATIC", "a");
  const events: string[] = [];
  await assert.rejects(
    () => realizeGovernedDataTriad(
      Object.freeze({
        p2_handoff_obligation: p2Handoff([staticBinding]),
        governed_data_json_triad_obligation: triadObligation(),
        binding_executions: Object.freeze([]),
      }),
      materializer([]),
      memoryStore(events),
    ),
    (error: unknown) =>
      error instanceof GovernedDataProviderRealizationError
      && error.code === "RDS_GOVERNED_DATA_EXECUTION_BINDING_INVALID",
  );
  assert.deepEqual(events, []);
});

test("V0152 exact readback mismatch forbids set-hash and triad commit", async () => {
  const staticBinding = binding("STATIC", "a");
  const observed: GovernedDataCategory[] = [];
  const events: string[] = [];
  await assert.rejects(
    () => realizeGovernedDataTriad(
      Object.freeze({
        p2_handoff_obligation: p2Handoff([staticBinding]),
        governed_data_json_triad_obligation: triadObligation(),
        binding_executions: Object.freeze([execution(staticBinding)]),
      }),
      materializer(observed),
      memoryStore(events, { corrupt_readback_filename: "dynamic.json" }),
    ),
    (error: unknown) =>
      error instanceof GovernedDataProviderRealizationError
      && error.code === "RDS_GOVERNED_DATA_TRIAD_READBACK_HASH_MISMATCH",
  );
  assert.deepEqual(observed, ["STATIC"]);
  assert.deepEqual(events, [
    "write:static.json",
    "write:dynamic.json",
    "write:runtime.json",
    "read:static.json",
    "read:dynamic.json",
  ]);
});

test("V0152 NOT_APPLICABLE triad cannot execute P2 or storage", async () => {
  const staticBinding = binding("STATIC", "a");
  const observed: GovernedDataCategory[] = [];
  const events: string[] = [];
  await assert.rejects(
    () => realizeGovernedDataTriad(
      Object.freeze({
        p2_handoff_obligation: p2Handoff([staticBinding]),
        governed_data_json_triad_obligation: triadObligation({
          applicability: "NOT_APPLICABLE",
        }),
        binding_executions: Object.freeze([execution(staticBinding)]),
      }),
      materializer(observed),
      memoryStore(events),
    ),
    (error: unknown) =>
      error instanceof GovernedDataProviderRealizationError
      && error.code === "RDS_GOVERNED_DATA_NOT_DECLARED",
  );
  assert.deepEqual(observed, []);
  assert.deepEqual(events, []);
});

test("V0152 DECLARED_Q_INTERFACE_SOURCE_FACT requires pre-resolved P1 V0186 anchor evidence", async () => {
  const dynamicBinding = binding(
    "DYNAMIC",
    "d",
    "DECLARED_Q_INTERFACE_SOURCE_FACT",
  );
  const invalidExecution = Object.freeze({
    ...execution(dynamicBinding),
    p1_interface_anchor_binding_ref: undefined,
  }) as unknown as GovernedDataBindingExecution;

  await assert.rejects(
    () => realizeGovernedDataTriad(
      Object.freeze({
        p2_handoff_obligation: p2Handoff([dynamicBinding]),
        governed_data_json_triad_obligation: triadObligation(),
        binding_executions: Object.freeze([invalidExecution]),
      }),
      materializer([]),
      memoryStore([]),
    ),
    /requires p1_interface_anchor_binding_ref/,
  );
});

test("V0152 rejects tampered p2_handoff obligation snapshot before execution", async () => {
  const staticBinding = binding("STATIC", "a");
  const handoff = {
    ...p2Handoff([staticBinding]),
    p2_handoff_obligation_snapshot_hash: `sha256:${"d".repeat(64)}`,
  };
  const events: string[] = [];
  await assert.rejects(
    () => realizeGovernedDataTriad(
      Object.freeze({
        p2_handoff_obligation: Object.freeze(handoff),
        governed_data_json_triad_obligation: triadObligation(),
        binding_executions: Object.freeze([execution(staticBinding)]),
      }),
      materializer([]),
      memoryStore(events),
    ),
    (error: unknown) =>
      error instanceof GovernedDataProviderRealizationError
      && error.code === "RDS_GOVERNED_DATA_HANDOFF_SNAPSHOT_HASH_MISMATCH",
  );
  assert.deepEqual(events, []);
});
