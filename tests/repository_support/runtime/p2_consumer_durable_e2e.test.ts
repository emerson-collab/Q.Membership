import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  P0_CONTRACT_REF,
  P0_PROVIDER_SYMBOL_REF,
  deep_freeze,
} from "../../../src/p0/runtime_contract.ts";
import {
  handler as consumePublication,
} from "../../../src/p2/consumer/external_capability_mounting/consume_publication/handler.ts";
import {
  handler as createMount,
  persist_created_mount_with_owner,
} from "../../../src/p2/consumer/external_capability_mounting/create_mount/handler.ts";
import {
  handler as createMountSet,
  persist_created_mount_set_with_owner,
} from "../../../src/p2/consumer/external_capability_mounting/create_mount_set/handler.ts";
import {
  handler as activateMountSet,
  commit_active_mount_set_with_owner,
} from "../../../src/p2/consumer/external_capability_mounting/activate_mount_set/handler.ts";
import {
  handler as realizeDependency,
} from "../../../src/p2/consumer/p1_dependency_realization/realize_dependency/handler.ts";
import {
  handler as bindOperationUse,
} from "../../../src/p2/consumer/p1_dependency_realization/bind_operation_use/handler.ts";
import {
  handler as executeMountedCapability,
} from "../../../src/p2/consumer/external_capability_mounting/execute_mounted_capability/handler.ts";
import {
  IMPLEMENTATION_MATERIAL_REPRESENTATION_ID,
} from "../../../runtime/implementation_material_runtime.ts";
import {
  createMountedProviderLocalP0Invoker,
} from "../../../runtime/mounted_provider_runtime_binding.ts";
import {
  createOwnerLocalP2DurablePersistence,
} from "../../../runtime/owner_local_p2_persistence.ts";

type JsonObject = Readonly<Record<string, unknown>>;
const execFile = promisify(execFileCallback);

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, stable((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

function shaBytes(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function field(name: string, value: string): string {
  return `${name}:${Buffer.byteLength(value, "utf8")}:${value}\n`;
}

function asObject(value: unknown, fieldName: string): JsonObject {
  assert.ok(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${fieldName} must be an object`,
  );
  return value as JsonObject;
}

function request(
  input: JsonObject,
  runtimeContext: JsonObject = Object.freeze({}),
) {
  return Object.freeze({
    input,
    runtime_context: runtimeContext,
    trace_id: "trace-p2-consumer-e2e",
    request_id: "request-p2-consumer-e2e",
  });
}

async function recoverInFreshNodeProcess(input: Readonly<{
  repository_root: string;
  receiving_domain_ref: string;
  manifest: Uint8Array;
  installed_file: Readonly<{ relative_path: string; bytes: Uint8Array }>;
}>): Promise<JsonObject> {
  const persistenceModuleUrl = new URL(
    "../../../runtime/owner_local_p2_persistence.ts",
    import.meta.url,
  ).href;
  const activationModuleUrl = new URL(
    "../../../src/p2/consumer/external_capability_mounting/activate_mount_set/handler.ts",
    import.meta.url,
  ).href;
  const materialModuleUrl = new URL(
    "../../../runtime/implementation_material_runtime.ts",
    import.meta.url,
  ).href;

  const childProgram = `
const { createOwnerLocalP2DurablePersistence } = await import(${JSON.stringify(persistenceModuleUrl)});
const { recover_active_mount_set_with_owner } = await import(${JSON.stringify(activationModuleUrl)});
const { IMPLEMENTATION_MATERIAL_REPRESENTATION_ID } = await import(${JSON.stringify(materialModuleUrl)});
const repositoryRoot = process.env.Q_REPOSITORY_ROOT;
const receivingDomainRef = process.env.Q_RECEIVING_DOMAIN_REF;
const relativePath = process.env.Q_FILE_PATH;
if (!repositoryRoot || !receivingDomainRef || !relativePath) throw new Error("restart fixture environment incomplete");
const manifest = Buffer.from(process.env.Q_MANIFEST_B64 ?? "", "base64");
const fileBytes = Buffer.from(process.env.Q_FILE_B64 ?? "", "base64");
const materialReadPort = Object.freeze({
  async readExact() {
    return Object.freeze({
      representation_id: IMPLEMENTATION_MATERIAL_REPRESENTATION_ID,
      manifest_bytes: manifest,
      files: Object.freeze([Object.freeze({ relative_path: relativePath, bytes: fileBytes })]),
    });
  },
});
const persistence = createOwnerLocalP2DurablePersistence({
  repository_root: repositoryRoot,
  material_read_port: materialReadPort,
});
const recovered = await recover_active_mount_set_with_owner(receivingDomainRef, persistence);
process.stdout.write(JSON.stringify(recovered));
`;

  const { stdout } = await execFile(
    process.execPath,
    ["--experimental-transform-types", "--input-type=module", "--eval", childProgram],
    {
      env: {
        ...process.env,
        Q_REPOSITORY_ROOT: input.repository_root,
        Q_RECEIVING_DOMAIN_REF: input.receiving_domain_ref,
        Q_MANIFEST_B64: Buffer.from(input.manifest).toString("base64"),
        Q_FILE_PATH: input.installed_file.relative_path,
        Q_FILE_B64: Buffer.from(input.installed_file.bytes).toString("base64"),
      },
      maxBuffer: 1024 * 1024,
    },
  );

  return asObject(JSON.parse(stdout), "fresh_process_recovered_mount_set");
}

test("P2 Consumer durable mount -> activate -> real process restart -> pointer-first recovery -> dependency bind -> local P0 execute", async (t) => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "q-p2-consumer-e2e-"));
  t.after(async () => {
    await rm(repositoryRoot, { recursive: true, force: true });
  });

  const receivingDomainRef = "Q.RECEIVER.CONTRACT.DOMAIN@V0100";
  const providerContractRef =
    "Q.PROVIDER.CONTRACT.CAPABILITY.EXAMPLE@V0100";
  const exactInterfaceRef =
    `${providerContractRef}#/interfaces/run_invoke`;
  const exactOperationRef =
    `${providerContractRef}#/operations/run`;
  const packageRef = "Q.CAPABILITY_PACKAGE.PROVIDER.EXAMPLE@V0100";
  const publicEntryRef = "entry/example.ts#entry";
  const installedFile = Object.freeze({
    relative_path: "entry/example.ts",
    bytes: Buffer.from("export const entry = {};\n", "utf8"),
  });
  const manifest = Buffer.from(
    [
      "QCPIM1\n",
      field("package_ref", packageRef),
      field("package_content_hash", `sha256:${"a".repeat(64)}`),
      field("public_entry_ref", publicEntryRef),
      field("file_count", "1"),
      `F:${Buffer.byteLength(installedFile.relative_path, "utf8")}:${installedFile.relative_path}:${shaBytes(installedFile.bytes)}\n`,
    ].join(""),
    "utf8",
  );

  const publicationHash = `sha256:${"b".repeat(64)}`;
  const publication = Object.freeze({
    immutable: true,
    capability_contract_ref: providerContractRef,
    capability_contract_hash: `sha256:${"c".repeat(64)}`,
    provider_interface_refs: Object.freeze([exactInterfaceRef]),
    publication_hash: publicationHash,
    publication_artifact_binding: Object.freeze({
      immutable: true,
      artifact_ref: `${packageRef}#/implementation_material`,
      content_hash: shaBytes(manifest),
      entry_symbol_ref: publicEntryRef,
      provider_neutral_locator_binding: Object.freeze({
        kind: "owner_local_test_fixture",
      }),
    }),
  });

  const materialReadPort = Object.freeze({
    async readExact() {
      return Object.freeze({
        representation_id: IMPLEMENTATION_MATERIAL_REPRESENTATION_ID,
        manifest_bytes: manifest,
        files: Object.freeze([installedFile]),
      });
    },
  });

  const firstProcessPersistence = createOwnerLocalP2DurablePersistence({
    repository_root: repositoryRoot,
    material_read_port: materialReadPort,
  });

  const consumed = await consumePublication(
    request(Object.freeze({
      publication,
      verification: Object.freeze({
        integrity_verified: true,
        local_material_binding_ref: "local:mounted-provider:example",
      }),
    })),
  );
  const verifiedPublication = asObject(
    consumed.runtime_result.verified_publication,
    "verified_publication",
  );

  const mounted = await createMount(
    request(Object.freeze({
      verified_publication: verifiedPublication,
      receiving_domain_ref: receivingDomainRef,
      mount_policy: Object.freeze({}),
    })),
  );
  const mount = asObject(mounted.runtime_result.mount, "mount");
  await persist_created_mount_with_owner(
    mount,
    firstProcessPersistence,
  );

  const setCreated = await createMountSet(
    request(Object.freeze({
      receiving_domain_ref: receivingDomainRef,
      mounts: Object.freeze([mount]),
    })),
  );
  const mountSet = asObject(
    setCreated.runtime_result.mount_set,
    "mount_set",
  );
  await persist_created_mount_set_with_owner(
    mountSet,
    Object.freeze([mount]),
    firstProcessPersistence,
  );

  const activated = await activateMountSet(
    request(Object.freeze({ mount_set: mountSet })),
  );
  const activeMountSet = asObject(
    activated.runtime_result.active_mount_set,
    "active_mount_set",
  );
  await commit_active_mount_set_with_owner(
    activeMountSet,
    firstProcessPersistence,
  );

  const durableMount = await firstProcessPersistence.read_mount_record({
    receiving_domain_ref: receivingDomainRef,
    mount_hash: String(mount.mount_hash),
  });
  assert.deepEqual(durableMount, stable(mount));

  const durableMountSet =
    await firstProcessPersistence.read_mount_set_record({
      receiving_domain_ref: receivingDomainRef,
      mount_set_hash: String(mountSet.mount_set_hash),
    });
  assert.deepEqual(durableMountSet, stable(mountSet));

  const durablePointer =
    await firstProcessPersistence.read_active_mount_set_pointer({
      receiving_domain_ref: receivingDomainRef,
    });
  assert.deepEqual(durablePointer, {
    mount_set_hash: mountSet.mount_set_hash,
    receiving_domain_ref: receivingDomainRef,
    status: "ACTIVE",
  });

  const recovered = await recoverInFreshNodeProcess({
    repository_root: repositoryRoot,
    receiving_domain_ref: receivingDomainRef,
    manifest,
    installed_file: installedFile,
  });
  assert.equal(recovered.status, "ACTIVE");
  assert.equal(recovered.mount_set_hash, mountSet.mount_set_hash);
  const recoveredMounts = recovered.member_mounts;
  assert.ok(Array.isArray(recoveredMounts));
  assert.equal(recoveredMounts.length, 1);
  const recoveredMount = asObject(
    recoveredMounts[0],
    "recovered.member_mounts[0]",
  );
  assert.equal(recoveredMount.mount_hash, mount.mount_hash);

  const receivingOperationRef =
    "Q.RECEIVER.CONTRACT.CAPABILITY.EXAMPLE@V0100#/operations/use_provider";
  const localDependencyRef =
    "Q.RECEIVER.CONTRACT.CAPABILITY.EXAMPLE@V0100#/dependencies/provider";

  const dependency = await realizeDependency(
    request(Object.freeze({
      verified_provider_binding_or_governed_data_binding: Object.freeze({
        source_binding_kind: "ACTIVE_MOUNT_SET_MEMBER",
        active_mount_set_hash: recovered.mount_set_hash,
        provider_capability_contract_ref: providerContractRef,
        selected_mount: recoveredMount,
      }),
      receiving_p1_binding: Object.freeze({
        exact_owner_capability_ref:
          "Q.RECEIVER.CONTRACT.CAPABILITY.EXAMPLE@V0100",
        exact_receiving_operation_ref: receivingOperationRef,
        exact_local_dependency_ref: localDependencyRef,
      }),
      create_p1_dependency: false,
    })),
  );
  const dependencyBinding = asObject(
    dependency.runtime_result.dependency_realization_binding,
    "dependency_realization_binding",
  );

  const operationUse = await bindOperationUse(
    request(Object.freeze({
      dependency_realization_binding: dependencyBinding,
      operation_use: Object.freeze({
        exact_receiving_operation_ref: receivingOperationRef,
        exact_local_dependency_ref: localDependencyRef,
      }),
    })),
  );
  const operationUseBinding = asObject(
    operationUse.runtime_result.operation_use_binding,
    "operation_use_binding",
  );
  assert.equal(operationUseBinding.provider_capability_reowned, false);
  assert.equal(operationUseBinding.p1_business_semantics_written, false);

  let providerOperationCalls = 0;
  const stageExtension = deep_freeze({
    stage_id: "P1" as const,
    stage_role: "NONE" as const,
    stage_contract_ref: "Q.SS.STD.P1.CONTRACT.BUSINESS_RUNTIME@V0186",
    implementation_ref: providerContractRef,
    provided_interface_refs: [exactInterfaceRef],
    consumed_interface_refs: [
      `${P0_CONTRACT_REF}#/interfaces/runtime_execution_invoke`,
    ],
    hook_consumer_refs: [],
    hook_binding_refs: [],
    port_refs: [],
    upstream_runtime_ref: P0_CONTRACT_REF,
    runtime_provider_symbol_ref: P0_PROVIDER_SYMBOL_REF,
    status: "active" as const,
    rule_version_ref: "Q.SS.STD.P1.CONTRACT.BUSINESS_RUNTIME@V0186",
  });

  const localP0 = createMountedProviderLocalP0Invoker({
    material_read_port: materialReadPort,
    prepared_operation_port: {
      async resolveExactPreparedOperation(input) {
        assert.equal(input.exact_interface_ref, exactInterfaceRef);
        assert.equal(input.exact_operation_ref, exactOperationRef);
        return Object.freeze({
          local_material_binding_ref:
            "local:mounted-provider:example",
          implementation_artifact_ref:
            `${packageRef}#/implementation_material`,
          implementation_artifact_hash: shaBytes(manifest),
          entry_symbol_ref: publicEntryRef,
          interface_ref: exactInterfaceRef,
          operation_ref: exactOperationRef,
          stage_extension: stageExtension,
          hook_binding_set: Object.freeze([]),
          async operation(input: unknown) {
            providerOperationCalls += 1;
            return Object.freeze({
              ok: true,
              input,
              dependency_operation_use_binding_hash:
                operationUseBinding.operation_use_binding_hash,
            });
          },
        });
      },
    },
  });

  const executed = await executeMountedCapability(
    request(
      Object.freeze({
        active_mount_set: recovered,
        requested_provider_capability_contract_ref: providerContractRef,
        exact_interface_binding: Object.freeze({
          interface_ref: exactInterfaceRef,
          operation_ref: exactOperationRef,
        }),
        operation_input: Object.freeze({ value: 7 }),
      }),
      Object.freeze({
        invocation_id: "invoke-p2-consumer-e2e",
        binding_set_ref: "binding-set-p2-consumer-e2e",
      }),
    ),
    localP0,
  );

  assert.equal(providerOperationCalls, 1);
  const mountedExecution = asObject(
    executed.runtime_result.mounted_execution,
    "mounted_execution",
  );
  assert.equal(
    mountedExecution.selected_provider_capability_contract_ref,
    providerContractRef,
  );
  assert.equal(mountedExecution.second_runtime_used, false);
  assert.deepEqual(mountedExecution.runtime_result, {
    dependency_operation_use_binding_hash:
      operationUseBinding.operation_use_binding_hash,
    input: { value: 7 },
    ok: true,
  });

  const receipt = asObject(
    executed.runtime_result.execution_receipt,
    "execution_receipt",
  );
  const receiptPayload = asObject(
    receipt.receipt_payload,
    "execution_receipt.receipt_payload",
  );
  assert.equal(
    receiptPayload.stage_contract_ref,
    "Q.SS.STD.P2.CONTRACT.CROSS_DOMAIN_REALIZATION@V0128",
  );
  assert.equal(receiptPayload.second_runtime_used, false);
});
