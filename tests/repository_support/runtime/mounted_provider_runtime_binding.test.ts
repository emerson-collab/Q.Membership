import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  P0_CONTRACT_REF,
  P0_PROVIDER_SYMBOL_REF,
  deep_freeze,
} from "../../../src/p0/runtime_contract.ts";
import {
  IMPLEMENTATION_MATERIAL_REPRESENTATION_ID,
} from "../../../runtime/implementation_material_runtime.ts";
import {
  MountedProviderRuntimeBindingError,
  createMountedProviderLocalP0Invoker,
} from "../../../runtime/mounted_provider_runtime_binding.ts";

function shaBytes(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, stable((value as Record<string, unknown>)[key])]));
  return value;
}
function shaJson(value: unknown): string { return `sha256:${createHash("sha256").update(JSON.stringify(stable(value)), "utf8").digest("hex")}`; }
function field(name: string, value: string): string { return `${name}:${Buffer.byteLength(value, "utf8")}:${value}\n`; }

function fixture() {
  const exact_interface_ref = "Q.PROVIDER.CONTRACT.CAPABILITY.EXAMPLE@V0100#/interfaces/run_invoke";
  const exact_operation_ref = "Q.PROVIDER.CONTRACT.CAPABILITY.EXAMPLE@V0100#/operations/run";
  const package_ref = "Q.CAPABILITY_PACKAGE.PROVIDER.EXAMPLE@V0100";
  const public_entry_ref = "entry/example.ts#entry";
  const file = Object.freeze({ relative_path: "entry/example.ts", bytes: Buffer.from("export const entry = {};\n", "utf8") });
  const manifest = Buffer.from(
    `QCPIM1\n${field("package_ref", package_ref)}${field("package_content_hash", `sha256:${"a".repeat(64)}`)}${field("public_entry_ref", public_entry_ref)}${field("file_count", "1")}F:${Buffer.byteLength(file.relative_path, "utf8")}:${file.relative_path}:${shaBytes(file.bytes)}\n`,
    "utf8",
  );
  const resolverPayload = {
    publication_hash: `sha256:${"b".repeat(64)}`,
    implementation_artifact_ref: `${package_ref}#/implementation_material`,
    implementation_artifact_hash: shaBytes(manifest),
    entry_symbol_ref: public_entry_ref,
    local_material_binding_ref: "local:mounted-provider:example",
  };
  const implementation_binding = Object.freeze({ ...resolverPayload, binding_hash: shaJson(resolverPayload), verified: true });
  const stage_extension = deep_freeze({
    stage_id: "P1" as const,
    stage_role: "NONE" as const,
    stage_contract_ref: "Q.SS.STD.P1.CONTRACT.BUSINESS_RUNTIME@V0186",
    implementation_ref: "Q.PROVIDER.CONTRACT.CAPABILITY.EXAMPLE@V0100",
    provided_interface_refs: [exact_interface_ref],
    consumed_interface_refs: [`${P0_CONTRACT_REF}#/interfaces/runtime_execution_invoke`],
    hook_consumer_refs: [],
    hook_binding_refs: [],
    port_refs: [],
    upstream_runtime_ref: P0_CONTRACT_REF,
    runtime_provider_symbol_ref: P0_PROVIDER_SYMBOL_REF,
    status: "active" as const,
    rule_version_ref: "Q.SS.STD.P1.CONTRACT.BUSINESS_RUNTIME@V0186",
  });
  return { exact_interface_ref, exact_operation_ref, file, manifest, implementation_binding, stage_extension };
}

test("mounted provider binding verifies local material then executes exact Operation through one P0 runtime", async () => {
  const f = fixture();
  let operationCalls = 0;
  const invoker = createMountedProviderLocalP0Invoker({
    material_read_port: {
      async readExact() {
        return { representation_id: IMPLEMENTATION_MATERIAL_REPRESENTATION_ID, manifest_bytes: f.manifest, files: [f.file] };
      },
    },
    prepared_operation_port: {
      async resolveExactPreparedOperation(input) {
        assert.equal(input.exact_interface_ref, f.exact_interface_ref);
        assert.equal(input.exact_operation_ref, f.exact_operation_ref);
        return {
          local_material_binding_ref: f.implementation_binding.local_material_binding_ref,
          implementation_artifact_ref: f.implementation_binding.implementation_artifact_ref,
          implementation_artifact_hash: f.implementation_binding.implementation_artifact_hash,
          entry_symbol_ref: f.implementation_binding.entry_symbol_ref,
          interface_ref: f.exact_interface_ref,
          operation_ref: f.exact_operation_ref,
          stage_extension: f.stage_extension,
          hook_binding_set: [],
          async operation(input, context) {
            operationCalls += 1;
            assert.equal(context.operation_ref, f.exact_operation_ref);
            assert.equal(context.stage_contract_ref, f.stage_extension.stage_contract_ref);
            return { ok: true, input };
          },
        };
      },
    },
  });

  const result = await invoker.invoke_local_p0({
    exact_interface_binding: { interface_ref: f.exact_interface_ref, operation_ref: f.exact_operation_ref },
    implementation_binding: f.implementation_binding,
    operation_input: { value: 1 },
    runtime_context: { invocation_id: "invoke-1", binding_set_ref: "binding-set-1" },
    trace_id: "trace-1",
    request_id: "request-1",
  });
  assert.equal(operationCalls, 1);
  assert.deepEqual(result, { ok: true, input: { value: 1 } });
});

test("mounted provider binding preserves caller-supplied runtime attributes without a P1 resolver layer", async () => {
  const f = fixture();
  const invoker = createMountedProviderLocalP0Invoker({
    material_read_port: {
      async readExact() {
        return { representation_id: IMPLEMENTATION_MATERIAL_REPRESENTATION_ID, manifest_bytes: f.manifest, files: [f.file] };
      },
    },
    prepared_operation_port: {
      async resolveExactPreparedOperation() {
        return {
          local_material_binding_ref: f.implementation_binding.local_material_binding_ref,
          implementation_artifact_ref: f.implementation_binding.implementation_artifact_ref,
          implementation_artifact_hash: f.implementation_binding.implementation_artifact_hash,
          entry_symbol_ref: f.implementation_binding.entry_symbol_ref,
          interface_ref: f.exact_interface_ref,
          operation_ref: f.exact_operation_ref,
          stage_extension: f.stage_extension,
          hook_binding_set: [],
          async operation(_input, context) {
            return context.attributes;
          },
        };
      },
    },
  });

  const result = await invoker.invoke_local_p0({
    exact_interface_binding: { interface_ref: f.exact_interface_ref, operation_ref: f.exact_operation_ref },
    implementation_binding: f.implementation_binding,
    operation_input: {},
    runtime_context: {
      invocation_id: "invoke-attributes",
      binding_set_ref: "binding-set-1",
      attributes: { exact_resource_ref: "resource:test" },
    },
    trace_id: "trace-attributes",
    request_id: "request-attributes",
  });

  assert.deepEqual(result, { exact_resource_ref: "resource:test" });
});

test("mounted provider binding refuses Interface-only execution when exact operation_ref is absent", async () => {
  const f = fixture();
  const invoker = createMountedProviderLocalP0Invoker({
    material_read_port: { async readExact() { return { representation_id: IMPLEMENTATION_MATERIAL_REPRESENTATION_ID, manifest_bytes: f.manifest, files: [f.file] }; } },
    prepared_operation_port: { async resolveExactPreparedOperation() { throw new Error("must not be reached"); } },
  });
  await assert.rejects(
    () => invoker.invoke_local_p0({
      exact_interface_binding: { interface_ref: f.exact_interface_ref },
      implementation_binding: f.implementation_binding,
      operation_input: {},
      runtime_context: { invocation_id: "invoke-1", binding_set_ref: "binding-set-1" },
      trace_id: "trace-1",
      request_id: "request-1",
    }),
    (error: unknown) => error instanceof MountedProviderRuntimeBindingError && error.code === "MOUNTED_PROVIDER_BINDING_INVALID",
  );
});


test("V0134 rejects any alternative P0 RuntimeProvider injection at the P2 receiving boundary", () => {
  const deps = {
    material_read_port: {
      async readExact() { throw new Error("must-not-read"); },
    },
    prepared_operation_port: {
      async resolveExactPreparedOperation() { throw new Error("must-not-prepare"); },
    },
    p0_runtime_provider: undefined,
  } as unknown as Parameters<typeof createMountedProviderLocalP0Invoker>[0];
  assert.throws(
    () => createMountedProviderLocalP0Invoker(deps),
    (error: unknown) => error instanceof MountedProviderRuntimeBindingError
      && error.code === "MOUNTED_PROVIDER_SECOND_RUNTIME_FORBIDDEN",
  );
});
