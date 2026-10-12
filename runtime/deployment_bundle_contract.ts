export const DEPLOYMENT_BUNDLE_REQUIRED_REPOSITORY_PATHS = Object.freeze([
  "src/**",
  "runtime/**",
  "spec/p1/**",
] as const);

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;

export class DeploymentBundleContractError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DeploymentBundleContractError";
    this.code = code;
  }
}

export function deploymentBundleIncludePatterns(repositoryPrefix = ""): readonly string[] {
  return Object.freeze(
    DEPLOYMENT_BUNDLE_REQUIRED_REPOSITORY_PATHS.map((path) => `${repositoryPrefix}${path}`),
  );
}

export function assertDeploymentBundleCoverage(
  includePatterns: readonly string[],
  repositoryPrefix = "",
): void {
  const required = deploymentBundleIncludePatterns(repositoryPrefix);
  const missing = required.filter((pattern) => !includePatterns.includes(pattern));
  if (missing.length > 0) {
    throw new DeploymentBundleContractError(
      "RUNTIME_DEPLOYMENT_BUNDLE_INCOMPLETE",
      `deployment bundle is missing fixed repository runtime paths: ${missing.join(", ")}`,
    );
  }
}

export interface MountedImplementationMaterialRequirement {
  readonly implementation_artifact_ref: string;
  readonly implementation_artifact_hash: string;
  readonly entry_symbol_ref: string;
  readonly local_material_binding_ref: string;
}

export interface InstalledImplementationMaterialInventoryEntry extends MountedImplementationMaterialRequirement {
  readonly verified: true;
}

function requirementIdentity(value: MountedImplementationMaterialRequirement): string {
  if (
    typeof value.implementation_artifact_ref !== "string" || value.implementation_artifact_ref.length === 0
    || typeof value.entry_symbol_ref !== "string" || value.entry_symbol_ref.length === 0
    || typeof value.local_material_binding_ref !== "string" || value.local_material_binding_ref.length === 0
    || !SHA256_PATTERN.test(value.implementation_artifact_hash)
  ) {
    throw new DeploymentBundleContractError("RUNTIME_MOUNTED_MATERIAL_IDENTITY_INVALID", "mounted implementation material requires exact artifact/hash/entry/local binding identity");
  }
  return [
    value.local_material_binding_ref,
    value.implementation_artifact_ref,
    value.implementation_artifact_hash,
    value.entry_symbol_ref,
  ].join("\n");
}

/**
 * Deployment support does not select providers or infer paths. It only proves
 * that every exact mounted local_material_binding_ref required by the deployment
 * has a verified installed implementation-material inventory entry with the same
 * artifact/hash/entry identity.
 */
export function assertMountedImplementationMaterialCoverage(
  requirements: readonly MountedImplementationMaterialRequirement[],
  installedInventory: readonly InstalledImplementationMaterialInventoryEntry[],
): void {
  const installed = new Map<string, InstalledImplementationMaterialInventoryEntry>();
  for (const entry of installedInventory) {
    if (entry.verified !== true) {
      throw new DeploymentBundleContractError("RUNTIME_MOUNTED_MATERIAL_NOT_VERIFIED", "installed mounted implementation material must be verified before deployment activation");
    }
    const identity = requirementIdentity(entry);
    if (installed.has(identity)) {
      throw new DeploymentBundleContractError("RUNTIME_MOUNTED_MATERIAL_DUPLICATE", "duplicate exact installed implementation material identity is forbidden");
    }
    installed.set(identity, entry);
  }

  const seenRequirements = new Set<string>();
  for (const requirement of requirements) {
    const identity = requirementIdentity(requirement);
    if (seenRequirements.has(identity)) {
      throw new DeploymentBundleContractError("RUNTIME_MOUNTED_MATERIAL_DUPLICATE", "duplicate mounted implementation material requirement is forbidden");
    }
    seenRequirements.add(identity);
    if (!installed.has(identity)) {
      throw new DeploymentBundleContractError(
        "RUNTIME_MOUNTED_MATERIAL_MISSING",
        `deployment bundle is missing exact verified mounted implementation material for local binding: ${requirement.local_material_binding_ref}`,
      );
    }
  }
}
