import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { handler as realizeHandler } from "#q/p2/consumer/p1_dependency_realization/realize_dependency/handler.ts";
import { handler, P2StableError, STAGE_CONTRACT_REF } from "#q/p2/consumer/p1_dependency_realization/bind_operation_use/handler.ts";

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
const receiving = {
  exact_owner_capability_ref: "Q.RECEIVER.CONTRACT.CAPABILITY.SEARCH@V0100",
  exact_receiving_operation_ref: "Q.RECEIVER.CONTRACT.CAPABILITY.SEARCH@V0100#/operations/run",
  exact_local_dependency_ref: "Q.RECEIVER.CONTRACT.CAPABILITY.SEARCH@V0100#/dependencies/provider_search",
};

test("bind_operation_use is bound to P2 V0128", () => {
  assert.equal(STAGE_CONTRACT_REF, "Q.SS.STD.P2.CONTRACT.CROSS_DOMAIN_REALIZATION@V0128");
});

test("realize_dependency→bind_operation_use preserves exact predeclared P1 slot", async () => {
  const rr = await realizeHandler(baseRequest({
    verified_provider_binding_or_governed_data_binding: activeMember,
    receiving_p1_binding: receiving,
  }));
  const realization = rr.runtime_result.dependency_realization_binding as Record<string, unknown>;
  const br = await handler(baseRequest({
    dependency_realization_binding: realization,
    operation_use: {
      exact_receiving_operation_ref: receiving.exact_receiving_operation_ref,
      exact_local_dependency_ref: receiving.exact_local_dependency_ref,
    },
  }));
  const binding = br.runtime_result.operation_use_binding as Record<string, unknown>;
  assert.equal(binding.provider_capability_reowned, false);
  assert.equal(binding.p1_business_semantics_written, false);
  assert.match(String(binding.operation_use_binding_hash), /^sha256:[0-9a-f]{64}$/);
});

test("bind_operation_use fails closed on tampered realization binding", async () => {
  const rr = await realizeHandler(baseRequest({
    verified_provider_binding_or_governed_data_binding: activeMember,
    receiving_p1_binding: receiving,
  }));
  const realization = rr.runtime_result.dependency_realization_binding as Record<string, unknown>;
  await assert.rejects(
    () => handler(baseRequest({
      dependency_realization_binding: { ...realization, exact_owner_capability_ref: "Q.TAMPERED@V0100" },
      operation_use: {
        exact_receiving_operation_ref: receiving.exact_receiving_operation_ref,
        exact_local_dependency_ref: receiving.exact_local_dependency_ref,
      },
    })),
    (error: unknown) => error instanceof P2StableError && error.code === "P2_INTEGRITY_BINDING_INVALID",
  );
});

test("bind_operation_use fails closed when operation use differs", async () => {
  const rr = await realizeHandler(baseRequest({
    verified_provider_binding_or_governed_data_binding: activeMember,
    receiving_p1_binding: receiving,
  }));
  const realization = rr.runtime_result.dependency_realization_binding as Record<string, unknown>;
  await assert.rejects(
    () => handler(baseRequest({
      dependency_realization_binding: realization,
      operation_use: {
        exact_receiving_operation_ref: "other",
        exact_local_dependency_ref: "other",
      },
    })),
    (error: unknown) => error instanceof P2StableError && error.code === "P2_OPERATION_USE_BINDING_MISMATCH",
  );
});
