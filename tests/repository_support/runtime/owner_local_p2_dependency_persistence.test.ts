import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  handler as realizeDependency,
  persist_dependency_realization_with_owner,
} from "../../../src/p2/consumer/p1_dependency_realization/realize_dependency/handler.ts";
import {
  createOwnerLocalP2DurablePersistence,
} from "../../../runtime/owner_local_p2_persistence.ts";

type JsonObject = Readonly<Record<string, unknown>>;

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(source).sort().map((key) => [key, stable(source[key])]));
  }
  return value;
}

function sha(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(stable(value)), "utf8").digest("hex")}`;
}

function request(input: JsonObject) {
  return Object.freeze({
    input,
    runtime_context: Object.freeze({}),
    trace_id: "trace-owner-local-dependency",
    request_id: "request-owner-local-dependency",
  });
}

test("owner-local filesystem persistence stores exact dependency realization by receiving domain + dependency + active mount-set", async (t) => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "q-p2-dependency-"));
  t.after(async () => {
    await rm(repositoryRoot, { recursive: true, force: true });
  });

  const receivingDomainRef = "Q.RECEIVER@V0100";
  const providerContractRef = "Q.PROVIDER.CONTRACT.CAPABILITY.EXAMPLE@V0100";
  const activeMountSetHash = `sha256:${"e".repeat(64)}`;
  const receivingBinding = Object.freeze({
    exact_owner_capability_ref: "Q.RECEIVER.CONTRACT.CAPABILITY.EXAMPLE@V0100",
    exact_receiving_operation_ref: "Q.RECEIVER.CONTRACT.CAPABILITY.EXAMPLE@V0100#/operations/use_provider",
    exact_local_dependency_ref: "Q.RECEIVER.CONTRACT.CAPABILITY.EXAMPLE@V0100#/dependencies/provider",
  });
  const resolverPayload = Object.freeze({
    publication_hash: `sha256:${"b".repeat(64)}`,
    implementation_artifact_ref: "Q.CAPABILITY_PACKAGE.PROVIDER.EXAMPLE@V0100#/implementation_material",
    implementation_artifact_hash: `sha256:${"c".repeat(64)}`,
    entry_symbol_ref: "entry/example.ts#entry",
    local_material_binding_ref: "local:mounted-provider:example",
  });
  const resolverState = Object.freeze({
    ...resolverPayload,
    binding_hash: sha(resolverPayload),
    verified: true,
  });
  const selectedMount = Object.freeze({
    mount_hash: `sha256:${"a".repeat(64)}`,
    verified_publication: Object.freeze({
      verified: true,
      capability_contract_ref: providerContractRef,
    }),
    resolver_state: resolverState,
    implementation_binding_hash: sha(resolverState),
  });
  const activeMember = Object.freeze({
    source_binding_kind: "ACTIVE_MOUNT_SET_MEMBER",
    active_mount_set_hash: activeMountSetHash,
    provider_capability_contract_ref: providerContractRef,
    selected_mount: selectedMount,
  });

  const realized = await realizeDependency(request(Object.freeze({
    verified_provider_binding_or_governed_data_binding: activeMember,
    receiving_p1_binding: receivingBinding,
    create_p1_dependency: false,
  })));
  const binding = realized.runtime_result.dependency_realization_binding as JsonObject;

  const persistence = createOwnerLocalP2DurablePersistence({
    repository_root: repositoryRoot,
    material_read_port: Object.freeze({
      async readExact() {
        throw new Error("implementation material read is not part of dependency-binding persistence");
      },
    }),
  });

  await persist_dependency_realization_with_owner(receivingDomainRef, binding, persistence);
  const readback = await persistence.read_dependency_binding_record(Object.freeze({
    receiving_domain_ref: receivingDomainRef,
    exact_owner_capability_ref: receivingBinding.exact_owner_capability_ref,
    exact_receiving_operation_ref: receivingBinding.exact_receiving_operation_ref,
    exact_local_dependency_ref: receivingBinding.exact_local_dependency_ref,
    active_mount_set_hash: activeMountSetHash,
  }));

  assert.deepEqual(readback, binding);
});
