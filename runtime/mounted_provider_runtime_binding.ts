import {
  P0_CONTRACT_REF,
  P0_PROVIDER_SYMBOL_REF,
  StableRuntimeError,
  deep_freeze,
  exact_ref,
} from "../src/p0/runtime_contract.ts";
import type {
  HookBinding,
  RuntimeContext,
  RuntimeOperation,
  RuntimeProvider,
  StageExtensionContract,
} from "../src/p0/runtime_contract.ts";
import { runtime_provider } from "../src/p0/stage_handler.ts";
import {
  ImplementationMaterialRuntimeError,
  readAndVerifyInstalledImplementationMaterial,
} from "./implementation_material_runtime.ts";
import type {
  LocalImplementationMaterialReadPort,
  ResolvedImplementationBinding,
  VerifiedInstalledImplementationMaterial,
} from "./implementation_material_runtime.ts";

export type JsonObject = Readonly<Record<string, unknown>>;

export interface PreparedMountedProviderOperation {
  readonly local_material_binding_ref: string;
  readonly implementation_artifact_ref: string;
  readonly implementation_artifact_hash: string;
  readonly entry_symbol_ref: string;
  readonly interface_ref: string;
  readonly operation_ref: string;
  readonly stage_extension: StageExtensionContract;
  readonly hook_binding_set: readonly HookBinding[];
  readonly operation: RuntimeOperation<unknown, unknown>;
}

/**
 * Non-semantic receiving-side port produced by the installable Capability Package
 * receiving preparation. It may resolve only an already-installed, exact local
 * material binding and exact Interface/Operation identities; it may not infer,
 * translate, wrap, or re-own provider business semantics.
 */
export interface PreparedMountedProviderOperationPort {
  resolveExactPreparedOperation(input: Readonly<{
    verified_material: VerifiedInstalledImplementationMaterial;
    local_material_binding_ref: string;
    entry_symbol_ref: string;
    exact_interface_ref: string;
    exact_operation_ref: string;
  }>): Promise<PreparedMountedProviderOperation>;
}

export interface MountedProviderRuntimeBindingDependencies {
  readonly material_read_port: LocalImplementationMaterialReadPort;
  readonly prepared_operation_port: PreparedMountedProviderOperationPort;
  readonly p0_runtime_provider?: RuntimeProvider;
}

export interface MountedProviderLocalP0Invocation {
  readonly exact_interface_binding: JsonObject;
  readonly implementation_binding: JsonObject;
  readonly operation_input: unknown;
  readonly runtime_context: JsonObject;
  readonly trace_id: string;
  readonly request_id: string;
}

export interface MountedProviderLocalP0Invoker {
  invoke_local_p0(input: MountedProviderLocalP0Invocation): Promise<unknown>;
}

export class MountedProviderRuntimeBindingError extends StableRuntimeError {
  constructor(code: string, message: string, details?: Readonly<Record<string, unknown>>) {
    super(code, message, details);
    this.name = "MountedProviderRuntimeBindingError";
  }
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new MountedProviderRuntimeBindingError("MOUNTED_PROVIDER_BINDING_INVALID", `${field} must be a non-empty string`);
  }
  return value;
}

function objectValue(value: unknown, field: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new MountedProviderRuntimeBindingError("MOUNTED_PROVIDER_BINDING_INVALID", `${field} must be an object`);
  }
  return value as JsonObject;
}

function resolverBinding(value: JsonObject): ResolvedImplementationBinding {
  if (value.verified !== true) {
    throw new MountedProviderRuntimeBindingError("MOUNTED_PROVIDER_BINDING_INVALID", "verified implementation binding required");
  }
  return Object.freeze({
    publication_hash: nonEmptyString(value.publication_hash, "implementation_binding.publication_hash"),
    implementation_artifact_ref: nonEmptyString(value.implementation_artifact_ref, "implementation_binding.implementation_artifact_ref"),
    implementation_artifact_hash: nonEmptyString(value.implementation_artifact_hash, "implementation_binding.implementation_artifact_hash"),
    entry_symbol_ref: nonEmptyString(value.entry_symbol_ref, "implementation_binding.entry_symbol_ref"),
    local_material_binding_ref: nonEmptyString(value.local_material_binding_ref, "implementation_binding.local_material_binding_ref"),
    binding_hash: nonEmptyString(value.binding_hash, "implementation_binding.binding_hash"),
    verified: true,
  });
}

function exactInterfaceAndOperation(binding: JsonObject): Readonly<{ interface_ref: string; operation_ref: string }> {
  const interface_ref = nonEmptyString(binding.interface_ref, "exact_interface_binding.interface_ref");
  const operation_ref = nonEmptyString(binding.operation_ref, "exact_interface_binding.operation_ref");
  if (!exact_ref(interface_ref) || !exact_ref(operation_ref)) {
    throw new MountedProviderRuntimeBindingError("MOUNTED_PROVIDER_EXACT_IDENTITY_REQUIRED", "exact Interface and Operation refs are required; name-based inference is forbidden");
  }
  return Object.freeze({ interface_ref, operation_ref });
}

function providerRuntimeContext(
  source: JsonObject,
  stageExtension: StageExtensionContract,
  exactOperationRef: string,
  traceId: string,
  requestId: string,
): RuntimeContext {
  const invocation_id = nonEmptyString(source.invocation_id, "runtime_context.invocation_id");
  const binding_set_ref = nonEmptyString(source.binding_set_ref, "runtime_context.binding_set_ref");
  const attributes = source.attributes === undefined
    ? undefined
    : objectValue(source.attributes, "runtime_context.attributes");
  return deep_freeze({
    stage_contract_ref: stageExtension.stage_contract_ref,
    operation_ref: exactOperationRef,
    trace_id: traceId,
    request_id: requestId,
    invocation_id,
    binding_set_ref,
    ...(attributes === undefined ? {} : { attributes }),
  });
}

function verifyPreparedOperation(
  prepared: PreparedMountedProviderOperation,
  verifiedMaterial: VerifiedInstalledImplementationMaterial,
  exactInterfaceRef: string,
  exactOperationRef: string,
): void {
  if (
    prepared.local_material_binding_ref !== verifiedMaterial.local_material_binding_ref
    || prepared.implementation_artifact_ref !== verifiedMaterial.implementation_artifact_ref
    || prepared.implementation_artifact_hash !== verifiedMaterial.implementation_artifact_hash
    || prepared.entry_symbol_ref !== verifiedMaterial.public_entry_ref
  ) {
    throw new MountedProviderRuntimeBindingError("MOUNTED_PROVIDER_PREPARATION_MISMATCH", "prepared provider operation is not bound to the exact verified implementation material");
  }
  if (prepared.interface_ref !== exactInterfaceRef || prepared.operation_ref !== exactOperationRef) {
    throw new MountedProviderRuntimeBindingError("MOUNTED_PROVIDER_PREPARATION_MISMATCH", "prepared provider operation does not preserve exact Interface/Operation identity");
  }
  const extension = prepared.stage_extension;
  if (
    extension.stage_id !== "P1"
    || extension.stage_role !== "NONE"
    || extension.upstream_runtime_ref !== P0_CONTRACT_REF
    || extension.runtime_provider_symbol_ref !== P0_PROVIDER_SYMBOL_REF
    || extension.status !== "active"
    || !extension.provided_interface_refs.includes(exactInterfaceRef)
  ) {
    throw new MountedProviderRuntimeBindingError("MOUNTED_PROVIDER_STAGE_EXTENSION_INVALID", "prepared provider StageExtension is not bound to the receiving repository's single P0 runtime and exact Interface");
  }
}

export function createMountedProviderLocalP0Invoker(
  dependencies: MountedProviderRuntimeBindingDependencies,
): MountedProviderLocalP0Invoker {
  const p0 = dependencies.p0_runtime_provider ?? runtime_provider;
  const probe = p0.probe();
  if (probe.runtime_provider_count !== 1 || probe.runtime_pipeline_count !== 1) {
    throw new MountedProviderRuntimeBindingError("MOUNTED_PROVIDER_SECOND_RUNTIME_FORBIDDEN", "mounted provider execution requires the receiving repository's single P0 runtime");
  }

  return Object.freeze({
    async invoke_local_p0(input: MountedProviderLocalP0Invocation): Promise<unknown> {
      const exactBinding = exactInterfaceAndOperation(objectValue(input.exact_interface_binding, "exact_interface_binding"));
      const implementationBinding = resolverBinding(objectValue(input.implementation_binding, "implementation_binding"));
      let verifiedMaterial: VerifiedInstalledImplementationMaterial;
      try {
        verifiedMaterial = await readAndVerifyInstalledImplementationMaterial(
          implementationBinding,
          dependencies.material_read_port,
        );
      } catch (error) {
        if (error instanceof ImplementationMaterialRuntimeError) {
          throw new MountedProviderRuntimeBindingError(error.code, error.message);
        }
        throw error;
      }

      const prepared = await dependencies.prepared_operation_port.resolveExactPreparedOperation(Object.freeze({
        verified_material: verifiedMaterial,
        local_material_binding_ref: verifiedMaterial.local_material_binding_ref,
        entry_symbol_ref: verifiedMaterial.public_entry_ref,
        exact_interface_ref: exactBinding.interface_ref,
        exact_operation_ref: exactBinding.operation_ref,
      }));
      verifyPreparedOperation(prepared, verifiedMaterial, exactBinding.interface_ref, exactBinding.operation_ref);

      const context = providerRuntimeContext(
        objectValue(input.runtime_context, "runtime_context"),
        prepared.stage_extension,
        exactBinding.operation_ref,
        nonEmptyString(input.trace_id, "trace_id"),
        nonEmptyString(input.request_id, "request_id"),
      );

      const result = await p0.invoke({
        stage_extension: prepared.stage_extension,
        runtime_context: context,
        input: input.operation_input,
        operation: prepared.operation,
        hook_binding_set: prepared.hook_binding_set,
      });

      if (result.outcome === "success") return result.value;
      if (result.outcome === "error") {
        throw new MountedProviderRuntimeBindingError(result.error.code, result.error.message, result.error.details);
      }
      throw new MountedProviderRuntimeBindingError(
        "MOUNTED_PROVIDER_P0_DENIED",
        "receiving P0 denied mounted provider execution before the provider Operation ran",
        Object.freeze({ reason: result.reason }),
      );
    },
  });
}
