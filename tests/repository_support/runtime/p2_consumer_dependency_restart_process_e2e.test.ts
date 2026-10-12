import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  IMPLEMENTATION_MATERIAL_REPRESENTATION_ID,
} from "../../../runtime/implementation_material_runtime.ts";
import {
  createOwnerLocalP2DurablePersistence,
} from "../../../runtime/owner_local_p2_persistence.ts";
import {
  realizeP2ConsumerDependency,
} from "../../../runtime/p2_consumer_p1_dependency_realization.ts";

type JsonObject = Readonly<Record<string, unknown>>;
const execFile = promisify(execFileCallback);

function shaBytes(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function field(name: string, value: string): string {
  return `${name}:${Buffer.byteLength(value, "utf8")}:${value}\n`;
}

function asObject(value: unknown, name: string): JsonObject {
  assert.ok(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${name} must be an object`,
  );
  return value as JsonObject;
}

async function recoverInFreshNodeProcess(input: Readonly<{
  repository_root: string;
  receiving_domain_ref: string;
  receiving_p1_binding: JsonObject;
  manifest: Uint8Array;
  installed_file: Readonly<{ relative_path: string; bytes: Uint8Array }>;
}>): Promise<JsonObject> {
  const persistenceModuleUrl = new URL(
    "../../../runtime/owner_local_p2_persistence.ts",
    import.meta.url,
  ).href;
  const realizationModuleUrl = new URL(
    "../../../runtime/p2_consumer_p1_dependency_realization.ts",
    import.meta.url,
  ).href;
  const materialModuleUrl = new URL(
    "../../../runtime/implementation_material_runtime.ts",
    import.meta.url,
  ).href;

  const childProgram = `
const { createOwnerLocalP2DurablePersistence } = await import(${JSON.stringify(persistenceModuleUrl)});
const { recoverP2ConsumerDependency } = await import(${JSON.stringify(realizationModuleUrl)});
const { IMPLEMENTATION_MATERIAL_REPRESENTATION_ID } = await import(${JSON.stringify(materialModuleUrl)});
const repositoryRoot = process.env.Q_REPOSITORY_ROOT;
const receivingDomainRef = process.env.Q_RECEIVING_DOMAIN_REF;
const receivingP1Binding = JSON.parse(process.env.Q_RECEIVING_P1_BINDING ?? "null");
const relativePath = process.env.Q_FILE_PATH;
if (!repositoryRoot || !receivingDomainRef || !relativePath || !receivingP1Binding) {
  throw new Error("restart fixture environment incomplete");
}
const manifest = Buffer.from(process.env.Q_MANIFEST_B64 ?? "", "base64");
const fileBytes = Buffer.from(process.env.Q_FILE_B64 ?? "", "base64");
const persistence = createOwnerLocalP2DurablePersistence({
  repository_root: repositoryRoot,
  material_read_port: Object.freeze({
    async readExact() {
      return Object.freeze({
        representation_id: IMPLEMENTATION_MATERIAL_REPRESENTATION_ID,
        manifest_bytes: manifest,
        files: Object.freeze([Object.freeze({ relative_path: relativePath, bytes: fileBytes })]),
      });
    },
  }),
});
const recovered = await recoverP2ConsumerDependency(Object.freeze({
  receiving_domain_ref: receivingDomainRef,
  receiving_p1_binding: Object.freeze(receivingP1Binding),
  trace_id: "trace-restart-process",
  request_id: "request-restart-process",
}), persistence);
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
        Q_RECEIVING_P1_BINDING: JSON.stringify(input.receiving_p1_binding),
        Q_MANIFEST_B64: Buffer.from(input.manifest).toString("base64"),
        Q_FILE_PATH: input.installed_file.relative_path,
        Q_FILE_B64: Buffer.from(input.installed_file.bytes).toString("base64"),
      },
      maxBuffer: 1024 * 1024,
    },
  );
  return asObject(JSON.parse(stdout), "recovered");
}

test(
  "P2 V0128 dependency realization survives a real process restart through exact durable recovery",
  async (t) => {
    const repositoryRoot = await mkdtemp(join(tmpdir(), "q-p2-dependency-restart-"));
    t.after(async () => {
      await rm(repositoryRoot, { recursive: true, force: true });
    });

    const receivingDomainRef = "Q.RECEIVER.CONTRACT.DOMAIN@V0100";
    const providerContractRef = "Q.PROVIDER.CONTRACT.CAPABILITY.EXAMPLE@V0100";
    const exactInterfaceRef = `${providerContractRef}#/interfaces/run_invoke`;
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
    const publication = Object.freeze({
      immutable: true,
      capability_contract_ref: providerContractRef,
      capability_contract_hash: `sha256:${"c".repeat(64)}`,
      provider_interface_refs: Object.freeze([exactInterfaceRef]),
      publication_hash: `sha256:${"b".repeat(64)}`,
      publication_artifact_binding: Object.freeze({
        immutable: true,
        artifact_ref: `${packageRef}#/implementation_material`,
        content_hash: shaBytes(manifest),
        entry_symbol_ref: publicEntryRef,
        provider_neutral_locator_binding: Object.freeze({ kind: "test" }),
      }),
    });
    const receivingP1Binding = Object.freeze({
      exact_owner_capability_ref: "Q.RECEIVER.CONTRACT.CAPABILITY.EXAMPLE@V0100",
      exact_receiving_operation_ref:
        "Q.RECEIVER.CONTRACT.CAPABILITY.EXAMPLE@V0100#/operations/use_provider",
      exact_local_dependency_ref:
        "Q.RECEIVER.CONTRACT.CAPABILITY.EXAMPLE@V0100#/dependencies/provider",
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
    const persistence = createOwnerLocalP2DurablePersistence({
      repository_root: repositoryRoot,
      material_read_port: materialReadPort,
    });

    const created = await realizeP2ConsumerDependency(Object.freeze({
      publication,
      verification: Object.freeze({
        integrity_verified: true,
        local_material_binding_ref: "local:mounted-provider:example",
      }),
      receiving_domain_ref: receivingDomainRef,
      receiving_p1_binding: receivingP1Binding,
      trace_id: "trace-create-process",
      request_id: "request-create-process",
    }), persistence);

    const recovered = await recoverInFreshNodeProcess({
      repository_root: repositoryRoot,
      receiving_domain_ref: receivingDomainRef,
      receiving_p1_binding: receivingP1Binding,
      manifest,
      installed_file: installedFile,
    });

    const recoveredDependency = asObject(
      recovered.dependency_realization_binding,
      "recovered.dependency_realization_binding",
    );
    const recoveredOperationUse = asObject(
      recovered.operation_use_binding,
      "recovered.operation_use_binding",
    );
    assert.equal(
      asObject(recovered.active_mount_set, "recovered.active_mount_set").mount_set_hash,
      created.active_mount_set.mount_set_hash,
    );
    assert.equal(
      recoveredDependency.binding_hash,
      created.dependency_realization_binding.binding_hash,
    );
    assert.equal(
      recoveredDependency.exact_local_dependency_ref,
      receivingP1Binding.exact_local_dependency_ref,
    );
    assert.equal(
      recoveredOperationUse.exact_receiving_operation_ref,
      receivingP1Binding.exact_receiving_operation_ref,
    );
    assert.equal(
      recoveredOperationUse.exact_local_dependency_ref,
      receivingP1Binding.exact_local_dependency_ref,
    );
  },
);
