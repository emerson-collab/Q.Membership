import assert from "node:assert/strict";
import test from "node:test";

import {
  P2_CONSUMER_MOUNT_SEQUENCE,
  executeP2MountedCapability,
  realizeP2ConsumerMount,
  recoverP2ConsumerMount,
} from "../../../runtime/p2_consumer_mount_realization.ts";
import type {
  JsonObject,
} from "../../../runtime/p2_consumer_mount_realization.ts";
import {
  P2_CONSUMER_REALIZATION_SEQUENCE,
  realizeP2ConsumerDependency,
  realizeP2DeclaredDependency,
  recoverP2ConsumerDependency,
} from "../../../runtime/p2_consumer_p1_dependency_realization.ts";
import type {
  P2ConsumerRealizationPersistence,
} from "../../../runtime/p2_consumer_p1_dependency_realization.ts";

function asObject(value: unknown, field: string): JsonObject {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), `${field} must be an object`);
  return value as JsonObject;
}

function inMemoryPersistence(): Readonly<{
  persistence: P2ConsumerRealizationPersistence;
  activePointer(): JsonObject | undefined;
  dependencyCount(): number;
}> {
  const mounts = new Map<string, JsonObject>();
  const mountSets = new Map<string, JsonObject>();
  const dependencies = new Map<string, JsonObject>();
  let pointer: JsonObject | undefined;
  const dependencyKey = (
    domain: string,
    ownerCapabilityRef: string,
    receivingOperationRef: string,
    dependencyRef: string,
    activeHash: string,
  ) => `${domain}\u0000${ownerCapabilityRef}\u0000${receivingOperationRef}\u0000${dependencyRef}\u0000${activeHash}`;

  const persistence: P2ConsumerRealizationPersistence = {
    async persist_mount_record({ receiving_domain_ref, mount_hash, mount }) {
      mounts.set(`${receiving_domain_ref}\u0000${mount_hash}`, mount);
    },
    async read_mount_record({ receiving_domain_ref, mount_hash }) {
      return mounts.get(`${receiving_domain_ref}\u0000${mount_hash}`);
    },
    async persist_mount_set_record({ receiving_domain_ref, mount_set_hash, mount_set }) {
      mountSets.set(`${receiving_domain_ref}\u0000${mount_set_hash}`, mount_set);
    },
    async read_mount_set_record({ receiving_domain_ref, mount_set_hash }) {
      return mountSets.get(`${receiving_domain_ref}\u0000${mount_set_hash}`);
    },
    async reverify_implementation_material() {
      return;
    },
    async read_active_mount_set_pointer({ receiving_domain_ref }) {
      return pointer?.receiving_domain_ref === receiving_domain_ref ? pointer : undefined;
    },
    async switch_active_mount_set_pointer({ receiving_domain_ref, mount_set_hash }) {
      pointer = Object.freeze({ receiving_domain_ref, mount_set_hash, status: "ACTIVE" });
    },
    async persist_dependency_binding_record({
      receiving_domain_ref,
      exact_owner_capability_ref,
      exact_receiving_operation_ref,
      exact_local_dependency_ref,
      active_mount_set_hash,
      binding,
    }) {
      dependencies.set(
        dependencyKey(
          receiving_domain_ref,
          exact_owner_capability_ref,
          exact_receiving_operation_ref,
          exact_local_dependency_ref,
          active_mount_set_hash,
        ),
        structuredClone(binding) as JsonObject,
      );
    },
    async read_dependency_binding_record({
      receiving_domain_ref,
      exact_owner_capability_ref,
      exact_receiving_operation_ref,
      exact_local_dependency_ref,
      active_mount_set_hash,
    }) {
      return dependencies.get(
        dependencyKey(
          receiving_domain_ref,
          exact_owner_capability_ref,
          exact_receiving_operation_ref,
          exact_local_dependency_ref,
          active_mount_set_hash,
        ),
      );
    },
  };

  return Object.freeze({
    persistence: Object.freeze(persistence),
    activePointer: () => pointer,
    dependencyCount: () => dependencies.size,
  });
}

function fixture() {
  const providerContractRef = "Q.PROVIDER.CONTRACT.CAPABILITY.EXAMPLE@V0100";
  const exactInterfaceRef = `${providerContractRef}#/interfaces/run_invoke`;
  return Object.freeze({
    publication: Object.freeze({
      immutable: true,
      capability_contract_ref: providerContractRef,
      capability_contract_hash: `sha256:${"c".repeat(64)}`,
      provider_interface_refs: Object.freeze([exactInterfaceRef]),
      publication_hash: `sha256:${"b".repeat(64)}`,
      publication_artifact_binding: Object.freeze({
        immutable: true,
        artifact_ref: "Q.CAPABILITY_PACKAGE.PROVIDER.EXAMPLE@V0100#/implementation_material",
        content_hash: `sha256:${"d".repeat(64)}`,
        entry_symbol_ref: "entry/example.ts#entry",
        provider_neutral_locator_binding: Object.freeze({ kind: "test" }),
      }),
    }),
    verification: Object.freeze({
      integrity_verified: true,
      local_material_binding_ref: "local:mounted-provider:example",
    }),
  });
}

const receivingDomainRef = "Q.RECEIVER@V0100";
const receivingOperationRef = "Q.RECEIVER.CONTRACT.CAPABILITY.EXAMPLE@V0100#/operations/use_provider";
const localDependencyRef = "Q.RECEIVER.DEPENDENCY.PROVIDER@V0100";
const receivingBinding = Object.freeze({
  exact_owner_capability_ref: "Q.RECEIVER.CAPABILITY.EXAMPLE@V0100",
  exact_receiving_operation_ref: receivingOperationRef,
  exact_local_dependency_ref: localDependencyRef,
});

test("mount-only realization reaches ACTIVE without creating a P1 dependency binding", async () => {
  const store = inMemoryPersistence();
  const source = fixture();
  const mounted = await realizeP2ConsumerMount(Object.freeze({
    publication: source.publication,
    verification: source.verification,
    receiving_domain_ref: receivingDomainRef,
    trace_id: "trace-mount-only",
    request_id: "request-mount-only",
  }), store.persistence);

  assert.deepEqual(mounted.operation_sequence, P2_CONSUMER_MOUNT_SEQUENCE);
  assert.equal(mounted.active_mount_set.status, "ACTIVE");
  assert.equal(store.activePointer()?.mount_set_hash, mounted.active_mount_set.mount_set_hash);
  assert.equal(store.dependencyCount(), 0);
});

test("mount-only restart recovery succeeds without any dependency binding", async () => {
  const store = inMemoryPersistence();
  const source = fixture();
  const mounted = await realizeP2ConsumerMount(Object.freeze({
    publication: source.publication,
    verification: source.verification,
    receiving_domain_ref: receivingDomainRef,
    trace_id: "trace-mount-restart-create",
    request_id: "request-mount-restart-create",
  }), store.persistence);

  const recovered = await recoverP2ConsumerMount(receivingDomainRef, store.persistence);
  assert.equal(recovered.mount_set_hash, mounted.active_mount_set.mount_set_hash);
  assert.equal(recovered.status, "ACTIVE");
  assert.equal(store.dependencyCount(), 0);
});

test("declared P1 dependency is realized only after an ACTIVE mount already exists", async () => {
  const store = inMemoryPersistence();
  const source = fixture();
  const mounted = await realizeP2ConsumerMount(Object.freeze({
    publication: source.publication,
    verification: source.verification,
    receiving_domain_ref: receivingDomainRef,
    trace_id: "trace-declared-mount",
    request_id: "request-declared-mount",
  }), store.persistence);
  assert.equal(store.dependencyCount(), 0);

  const providerCapabilityContractRef = String(source.publication.capability_contract_ref);
  const bound = await realizeP2DeclaredDependency(Object.freeze({
    receiving_domain_ref: receivingDomainRef,
    active_mount_set: mounted.active_mount_set,
    selected_mount: mounted.mount,
    provider_capability_contract_ref: providerCapabilityContractRef,
    receiving_p1_binding: receivingBinding,
    trace_id: "trace-declared-bind",
    request_id: "request-declared-bind",
  }), store.persistence);

  assert.equal(store.dependencyCount(), 1);
  assert.equal(bound.operation_use_binding.exact_receiving_operation_ref, receivingOperationRef);
  assert.equal(bound.operation_use_binding.exact_local_dependency_ref, localDependencyRef);
});

test("ACTIVE mounted capability executes independently and emits a V0128 receipt", async () => {
  const store = inMemoryPersistence();
  const source = fixture();
  await realizeP2ConsumerMount(Object.freeze({
    publication: source.publication,
    verification: source.verification,
    receiving_domain_ref: receivingDomainRef,
    trace_id: "trace-exec-mount",
    request_id: "request-exec-mount",
  }), store.persistence);

  const providerCapabilityContractRef = String(source.publication.capability_contract_ref);
  const providerInterfaceRefs = source.publication.provider_interface_refs;
  assert.ok(Array.isArray(providerInterfaceRefs));
  const exactInterfaceRef = String(providerInterfaceRefs[0]);
  let localP0Calls = 0;
  const executed = await executeP2MountedCapability(Object.freeze({
    receiving_domain_ref: receivingDomainRef,
    requested_provider_capability_contract_ref: providerCapabilityContractRef,
    exact_interface_binding: Object.freeze({
      interface_ref: exactInterfaceRef,
      operation_ref: `${providerCapabilityContractRef}#/operations/run`,
    }),
    operation_input: Object.freeze({ value: 7 }),
    runtime_context: Object.freeze({}),
    trace_id: "trace-mounted-exec",
    request_id: "request-mounted-exec",
  }), store.persistence, Object.freeze({
    async invoke_local_p0(input: Readonly<{ exact_interface_binding: JsonObject }>) {
      localP0Calls += 1;
      assert.equal(input.exact_interface_binding.interface_ref, exactInterfaceRef);
      return Object.freeze({ ok: true, value: 7 });
    },
  }));

  assert.equal(localP0Calls, 1);
  assert.deepEqual(executed.mounted_execution.runtime_result, { ok: true, value: 7 });
  const receiptPayload = asObject(executed.execution_receipt.receipt_payload, "receipt_payload");
  assert.equal(
    receiptPayload.stage_contract_ref,
    "Q.SS.STD.P2.CONTRACT.CROSS_DOMAIN_REALIZATION@V0128",
  );
  assert.equal(store.dependencyCount(), 0);
});

test("repository runtime persists dependency realization before operation-use closure", async () => {
  const store = inMemoryPersistence();
  const source = fixture();
  const result = await realizeP2ConsumerDependency(Object.freeze({
    publication: source.publication,
    verification: source.verification,
    receiving_domain_ref: receivingDomainRef,
    receiving_p1_binding: receivingBinding,
    trace_id: "trace-v0136",
    request_id: "request-v0136",
  }), store.persistence);

  assert.deepEqual(result.operation_sequence, P2_CONSUMER_REALIZATION_SEQUENCE);
  assert.deepEqual(result.operation_sequence, [
    "consume_publication",
    "create_mount",
    "create_mount_set",
    "activate_mount_set",
    "realize_dependency",
    "bind_operation_use",
  ]);
  assert.equal(result.active_mount_set.status, "ACTIVE");
  assert.equal(store.activePointer()?.mount_set_hash, result.active_mount_set.mount_set_hash);
  assert.equal(store.dependencyCount(), 1);

  const dependency = asObject(result.dependency_realization_binding, "dependency_realization_binding");
  assert.equal(dependency.exact_local_dependency_ref, localDependencyRef);
  assert.equal(
    dependency.p1_dependency_interface_ref,
    "Q.SS.STD.P1.CONTRACT.BUSINESS_RUNTIME@V0186#/interfaces/dependency_invoke",
  );
  const persisted = await store.persistence.read_dependency_binding_record({
    receiving_domain_ref: receivingDomainRef,
    exact_owner_capability_ref: receivingBinding.exact_owner_capability_ref,
    exact_receiving_operation_ref: receivingBinding.exact_receiving_operation_ref,
    exact_local_dependency_ref: localDependencyRef,
    active_mount_set_hash: String(result.active_mount_set.mount_set_hash),
  });
  assert.deepEqual(persisted, dependency);

  const operationUse = asObject(result.operation_use_binding, "operation_use_binding");
  assert.equal(operationUse.exact_receiving_operation_ref, receivingOperationRef);
  assert.equal(operationUse.exact_local_dependency_ref, localDependencyRef);
});

test("restart recovery resolves durable dependency by recovered current active mount set", async () => {
  const store = inMemoryPersistence();
  const source = fixture();
  const created = await realizeP2ConsumerDependency(Object.freeze({
    publication: source.publication,
    verification: source.verification,
    receiving_domain_ref: receivingDomainRef,
    receiving_p1_binding: receivingBinding,
    trace_id: "trace-create",
    request_id: "request-create",
  }), store.persistence);

  const recovered = await recoverP2ConsumerDependency(Object.freeze({
    receiving_domain_ref: receivingDomainRef,
    receiving_p1_binding: receivingBinding,
    trace_id: "trace-recover",
    request_id: "request-recover",
  }), store.persistence);

  assert.equal(recovered.active_mount_set.mount_set_hash, created.active_mount_set.mount_set_hash);
  assert.deepEqual(recovered.dependency_realization_binding, created.dependency_realization_binding);
  assert.equal(recovered.operation_use_binding.exact_local_dependency_ref, localDependencyRef);
});

test("restart dependency recovery fails closed when durable binding is missing", async () => {
  const store = inMemoryPersistence();
  const source = fixture();
  const created = await realizeP2ConsumerDependency(Object.freeze({
    publication: source.publication,
    verification: source.verification,
    receiving_domain_ref: receivingDomainRef,
    receiving_p1_binding: receivingBinding,
    trace_id: "trace-create-missing",
    request_id: "request-create-missing",
  }), store.persistence);

  const missingPersistence: P2ConsumerRealizationPersistence = Object.freeze({
    ...store.persistence,
    async read_dependency_binding_record() { return undefined; },
  });
  assert.ok(created.active_mount_set.mount_set_hash);
  await assert.rejects(
    () => recoverP2ConsumerDependency(Object.freeze({
      receiving_domain_ref: receivingDomainRef,
      receiving_p1_binding: receivingBinding,
      trace_id: "trace-recover-missing",
      request_id: "request-recover-missing",
    }), missingPersistence),
    /exact durable dependency realization binding is missing/,
  );
});
