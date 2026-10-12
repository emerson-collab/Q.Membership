import assert from "node:assert/strict";
import test from "node:test";

import {
  createOwnerLocalP2PostgresPersistence,
} from "../../../runtime/owner_local_p2_postgres_persistence.ts";
import type {
  PostgresQueryPort,
} from "../../../runtime/owner_local_p2_postgres_persistence.ts";
import {
  realizeP2ConsumerDependency,
  recoverP2ConsumerDependency,
} from "../../../runtime/p2_consumer_p1_dependency_realization.ts";
import type {
  P2ConsumerRealizationPersistence,
} from "../../../runtime/p2_consumer_p1_dependency_realization.ts";

type JsonObject = Readonly<Record<string, unknown>>;
type MutableJsonObject = Record<string, unknown>;

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(source).sort().map((key) => [key, stable(source[key])]),
    );
  }
  return value;
}

function canonical(value: unknown): string {
  return JSON.stringify(stable(value));
}

function mountPersistence(): P2ConsumerRealizationPersistence {
  const mounts = new Map<string, JsonObject>();
  const mountSets = new Map<string, JsonObject>();
  let pointer: JsonObject | undefined;
  return {
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
    async persist_dependency_binding_record() {
      throw new Error("dependency persistence must be supplied by Postgres adapter");
    },
    async read_dependency_binding_record() {
      throw new Error("dependency persistence must be supplied by Postgres adapter");
    },
  };
}

function fixture() {
  const providerContractRef = "Q.PROVIDER.CONTRACT.CAPABILITY.EXAMPLE@V0100";
  return Object.freeze({
    publication: Object.freeze({
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
    }),
    verification: Object.freeze({
      integrity_verified: true,
      local_material_binding_ref: "local:mounted-provider:example",
    }),
  });
}

test(
  "Postgres-backed P2 restart accepts exact durable dependency and rejects canonical tamper with stale binding_hash",
  async () => {
    let dependencyRecordText: string | undefined;
    const database: PostgresQueryPort = Object.freeze({
      async query<Row extends JsonObject = JsonObject>(
        statement: string,
        parameters: readonly unknown[] = [],
      ): Promise<readonly Row[]> {
        if (statement.startsWith('insert into "qtest"."dependency_binding"')) {
          if (dependencyRecordText === undefined) {
            dependencyRecordText = String(parameters[6]);
          }
          return Object.freeze([]) as readonly Row[];
        }
        if (statement.startsWith('select record_text from "qtest"."dependency_binding"')) {
          if (dependencyRecordText === undefined) return Object.freeze([]) as readonly Row[];
          return Object.freeze([
            Object.freeze({ record_text: dependencyRecordText }) as unknown as Row,
          ]);
        }
        throw new Error(`unexpected SQL in focused dependency test: ${statement}`);
      },
    });

    const postgres = createOwnerLocalP2PostgresPersistence({
      database,
      tables: Object.freeze({
        provider_publication: "qtest.provider_publication",
        provider_interface_projection: "qtest.provider_interface_projection",
        consumer_mount: "qtest.consumer_mount",
        consumer_mount_set: "qtest.consumer_mount_set",
        consumer_active_mount_set_pointer: "qtest.consumer_active_mount_set_pointer",
        consumer_dependency_binding: "qtest.dependency_binding",
      }),
      material_read_port: Object.freeze({
        async readExact() {
          throw new Error("not used by focused Postgres dependency test");
        },
      }),
    });
    const mounts = mountPersistence();
    const persistence: P2ConsumerRealizationPersistence = Object.freeze({
      ...mounts,
      persist_dependency_binding_record: postgres.persist_dependency_binding_record,
      read_dependency_binding_record: postgres.read_dependency_binding_record,
    });

    const receivingDomainRef = "Q.RECEIVER@V0100";
    const receivingP1Binding = Object.freeze({
      exact_owner_capability_ref: "Q.RECEIVER.CAPABILITY.EXAMPLE@V0100",
      exact_receiving_operation_ref:
        "Q.RECEIVER.CONTRACT.CAPABILITY.EXAMPLE@V0100#/operations/use_provider",
      exact_local_dependency_ref: "Q.RECEIVER.DEPENDENCY.PROVIDER@V0100",
    });
    const source = fixture();

    const created = await realizeP2ConsumerDependency(Object.freeze({
      publication: source.publication,
      verification: source.verification,
      receiving_domain_ref: receivingDomainRef,
      receiving_p1_binding: receivingP1Binding,
      trace_id: "trace-postgres-create",
      request_id: "request-postgres-create",
    }), persistence);
    assert.ok(dependencyRecordText);

    const recovered = await recoverP2ConsumerDependency(Object.freeze({
      receiving_domain_ref: receivingDomainRef,
      receiving_p1_binding: receivingP1Binding,
      trace_id: "trace-postgres-recover",
      request_id: "request-postgres-recover",
    }), persistence);
    assert.equal(
      recovered.dependency_realization_binding.binding_hash,
      created.dependency_realization_binding.binding_hash,
    );

    const tampered = JSON.parse(dependencyRecordText!) as MutableJsonObject;
    tampered.p1_dependency_interface_ref =
      "Q.SS.STD.P1.CONTRACT.BUSINESS_RUNTIME@${CURRENT}#/interfaces/tampered";
    dependencyRecordText = canonical(tampered);

    await assert.rejects(
      () => recoverP2ConsumerDependency(Object.freeze({
        receiving_domain_ref: receivingDomainRef,
        receiving_p1_binding: receivingP1Binding,
        trace_id: "trace-postgres-tamper",
        request_id: "request-postgres-tamper",
      }), persistence),
      /dependency realization binding_hash mismatch/,
    );
  },
);
