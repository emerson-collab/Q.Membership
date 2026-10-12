import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  handler,
  persist_dependency_realization_with_owner,
  P2StableError,
  STAGE_CONTRACT_REF,
} from "#q/p2/consumer/p1_dependency_realization/realize_dependency/handler.ts";

const baseRequest = (input: Record<string, unknown>) => ({
  input,
  runtime_context: { stage_contract_ref: STAGE_CONTRACT_REF },
  trace_id: "trace-p2",
  request_id: "request-p2",
});

function stable(value: unknown): unknown {
  return Array.isArray(value)
    ? value.map(stable)
    : (value !== null && typeof value === "object"
      ? Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, stable((value as Record<string, unknown>)[key])]))
      : value);
}

const sha = (value: unknown) => `sha256:${createHash("sha256").update(JSON.stringify(stable(value)), "utf8").digest("hex")}`;
const provider = "Q.PROVIDER.CONTRACT.CAPABILITY.X@V0100";
const resolverPayload = {
  publication_hash: `sha256:${"b".repeat(64)}`,
  implementation_artifact_ref: "artifact://implementation",
  implementation_artifact_hash: `sha256:${"c".repeat(64)}`,
  entry_symbol_ref: "src/p1/export/example/entry.ts#entry",
  local_material_binding_ref: "src/p1/export/example/entry.ts#entry",
};
const resolver_state = { ...resolverPayload, binding_hash: sha(resolverPayload), verified: true };
const selectedMount = {
  receiving_domain_ref: "Q.RECEIVER.CONTRACT.DOMAIN@V0100",
  mount_hash: `sha256:${"a".repeat(64)}`,
  verified_publication: { verified: true, capability_contract_ref: provider },
  resolver_state,
  implementation_binding_hash: sha(resolver_state),
};
const activeMember = {
  source_binding_kind: "ACTIVE_MOUNT_SET_MEMBER",
  active_mount_set_hash: `sha256:${"e".repeat(64)}`,
  provider_capability_contract_ref: provider,
  selected_mount: selectedMount,
};
const governedBinding = {
  data_category: "STATIC",
  source_domain_identity: "Q.SOURCE.CONTRACT.DOMAIN@V0100",
  subject_identity: "subject-1",
  source_provenance: { revision_ref: "rev-1" },
  source_fact_authority: "Q.SOURCE.CONTRACT.DOMAIN@V0100",
  governed_access_binding: { authorization_ref: "auth-1" },
  integrity_binding: { profile_ref: "Q.INTEGRITY" },
  material_ref: "urn:q:material:1",
  content_hash: `sha256:${"d".repeat(64)}`,
  creates_evidence_or_gate_result: false,
};
const receiving = {
  exact_owner_capability_ref: "Q.RECEIVER.CONTRACT.CAPABILITY.SEARCH@V0100",
  exact_receiving_operation_ref: "Q.RECEIVER.CONTRACT.CAPABILITY.SEARCH@V0100#/operations/run",
  exact_local_dependency_ref: "Q.RECEIVER.CONTRACT.CAPABILITY.SEARCH@V0100#/dependencies/provider_search",
};

test("realize_dependency is bound to P2 V0128", () => {
  assert.equal(STAGE_CONTRACT_REF, "Q.SS.STD.P2.CONTRACT.CROSS_DOMAIN_REALIZATION@V0128");
});

test("realize_dependency accepts exact active mount-set member", async () => {
  const response = await handler(baseRequest({
    verified_provider_binding_or_governed_data_binding: activeMember,
    receiving_p1_binding: receiving,
  }));
  const binding = response.runtime_result.dependency_realization_binding as Record<string, unknown>;
  assert.equal(binding.source_binding_kind, "ACTIVE_MOUNT_SET_MEMBER");
  assert.equal(binding.exact_owner_capability_ref, receiving.exact_owner_capability_ref);
  assert.equal(binding.exact_receiving_operation_ref, receiving.exact_receiving_operation_ref);
  assert.equal(binding.exact_local_dependency_ref, receiving.exact_local_dependency_ref);
  assert.equal(binding.creates_or_writes_p1_business_semantics, false);
  assert.match(String(binding.binding_hash), /^sha256:[0-9a-f]{64}$/);
});

test("realize_dependency accepts governed-data consumption binding", async () => {
  const response = await handler(baseRequest({
    verified_provider_binding_or_governed_data_binding: governedBinding,
    receiving_p1_binding: receiving,
  }));
  const binding = response.runtime_result.dependency_realization_binding as Record<string, unknown>;
  assert.equal(binding.source_binding_kind, "GOVERNED_DATA_CONSUMPTION_BINDING");
});

test("realize_dependency rejects predecessor active-mount-only binding", async () => {
  await assert.rejects(
    () => handler(baseRequest({
      verified_provider_binding_or_governed_data_binding: selectedMount,
      receiving_p1_binding: receiving,
    })),
    (error: unknown) => error instanceof P2StableError && error.code === "P2_PROVIDER_BINDING_NOT_VERIFIED",
  );
});

test("realize_dependency never creates P1 dependency semantics", async () => {
  await assert.rejects(
    () => handler(baseRequest({
      verified_provider_binding_or_governed_data_binding: activeMember,
      receiving_p1_binding: receiving,
      create_p1_dependency: true,
    })),
    (error: unknown) => error instanceof P2StableError && error.code === "P2_P1_DEPENDENCY_CREATION_FORBIDDEN",
  );
});

test("mounted dependency persistence uses the exact V0128 five-field durable key", async () => {
  const response = await handler(baseRequest({
    verified_provider_binding_or_governed_data_binding: activeMember,
    receiving_p1_binding: receiving,
  }));
  const binding = response.runtime_result.dependency_realization_binding as Record<string, unknown>;
  let stored: Record<string, unknown> | undefined;

  await persist_dependency_realization_with_owner(
    "Q.RECEIVER.CONTRACT.DOMAIN@V0100",
    binding,
    {
      async persist_dependency_binding_record(input) {
        assert.equal(input.receiving_domain_ref, "Q.RECEIVER.CONTRACT.DOMAIN@V0100");
        assert.equal(input.exact_owner_capability_ref, receiving.exact_owner_capability_ref);
        assert.equal(input.exact_receiving_operation_ref, receiving.exact_receiving_operation_ref);
        assert.equal(input.exact_local_dependency_ref, receiving.exact_local_dependency_ref);
        assert.equal(input.active_mount_set_hash, activeMember.active_mount_set_hash);
        assert.equal(input.binding_hash, binding.binding_hash);
        stored = structuredClone(input.binding) as Record<string, unknown>;
      },
      async read_dependency_binding_record(input) {
        assert.equal(input.receiving_domain_ref, "Q.RECEIVER.CONTRACT.DOMAIN@V0100");
        assert.equal(input.exact_owner_capability_ref, receiving.exact_owner_capability_ref);
        assert.equal(input.exact_receiving_operation_ref, receiving.exact_receiving_operation_ref);
        assert.equal(input.exact_local_dependency_ref, receiving.exact_local_dependency_ref);
        assert.equal(input.active_mount_set_hash, activeMember.active_mount_set_hash);
        return stored === undefined ? undefined : structuredClone(stored);
      },
    },
  );

  assert.deepEqual(stored, binding);
});
