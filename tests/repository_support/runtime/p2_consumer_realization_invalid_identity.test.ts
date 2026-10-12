import assert from "node:assert/strict";
import test from "node:test";

import {
  realizeP2ConsumerDependency,
} from "../../../runtime/p2_consumer_p1_dependency_realization.ts";
import type {
  P2ConsumerRealizationPersistence,
} from "../../../runtime/p2_consumer_p1_dependency_realization.ts";

const unreachable = async (): Promise<never> => {
  throw new Error("persistence must not be reached for invalid receiving-P1 identity");
};

const persistence: P2ConsumerRealizationPersistence = Object.freeze({
  persist_mount_record: unreachable,
  read_mount_record: unreachable,
  persist_mount_set_record: unreachable,
  read_mount_set_record: unreachable,
  reverify_implementation_material: unreachable,
  read_active_mount_set_pointer: unreachable,
  switch_active_mount_set_pointer: unreachable,
  persist_dependency_binding_record: unreachable,
  read_dependency_binding_record: unreachable,
});

test("receiving-P1 dependency realization fails closed on an empty dependency identity before mount materialization", async () => {
  const providerContractRef = "Q.PROVIDER.CONTRACT.CAPABILITY.EXAMPLE@V0100";
  const publication = Object.freeze({
    immutable: true,
    capability_contract_ref: providerContractRef,
    capability_contract_hash: `sha256:${"c".repeat(64)}`,
    provider_interface_refs: Object.freeze([
      `${providerContractRef}#/interfaces/run_invoke`,
    ]),
    publication_hash: `sha256:${"b".repeat(64)}`,
    publication_artifact_binding: Object.freeze({
      immutable: true,
      artifact_ref: "Q.CAPABILITY_PACKAGE.PROVIDER.EXAMPLE@V0100#/implementation_material",
      content_hash: `sha256:${"d".repeat(64)}`,
      entry_symbol_ref: "entry/example.ts#entry",
      provider_neutral_locator_binding: Object.freeze({ kind: "test" }),
    }),
  });

  await assert.rejects(
    () => realizeP2ConsumerDependency(Object.freeze({
      publication,
      verification: Object.freeze({
        integrity_verified: true,
        local_material_binding_ref: "local:mounted-provider:example",
      }),
      receiving_domain_ref: "Q.RECEIVER@V0100",
      receiving_p1_binding: Object.freeze({
        exact_owner_capability_ref: "Q.RECEIVER.CAPABILITY.EXAMPLE@V0100",
        exact_receiving_operation_ref: "Q.RECEIVER.CONTRACT.CAPABILITY.EXAMPLE@V0100#/operations/use_provider",
        exact_local_dependency_ref: "",
      }),
      trace_id: "trace-v0136-invalid",
      request_id: "request-v0136-invalid",
    }), persistence),
    /exact_local_dependency_ref must be a non-empty exact identity/,
  );
});
