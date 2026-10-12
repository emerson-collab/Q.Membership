import assert from "node:assert/strict";
import test from "node:test";
import {
  assertDeploymentBundleCoverage,
  assertMountedImplementationMaterialCoverage,
  deploymentBundleIncludePatterns,
} from "../../../runtime/deployment_bundle_contract.ts";

const requiredMaterial = Object.freeze({
  implementation_artifact_ref: "Q.CAPABILITY_PACKAGE.PROVIDER.EXAMPLE@V0100#/implementation_material",
  implementation_artifact_hash: `sha256:${"a".repeat(64)}`,
  entry_symbol_ref: "entry/example.ts#entry",
  local_material_binding_ref: "local:mounted-provider:example",
});

test("deployment bundle requires src runtime and P1 spec roots", () => {
  assert.deepEqual(
    deploymentBundleIncludePatterns("../"),
    ["../src/**", "../runtime/**", "../spec/p1/**"],
  );
  assert.doesNotThrow(() => assertDeploymentBundleCoverage(
    ["../src/**", "../runtime/**", "../spec/p1/**"],
    "../",
  ));
});

test("deployment bundle fails closed when fixed runtime root is omitted", () => {
  assert.throws(
    () => assertDeploymentBundleCoverage(["../src/**", "../spec/p1/**"], "../"),
    /deployment bundle is missing fixed repository runtime paths/,
  );
});

test("deployment activation requires exact verified installed material for every mounted binding", () => {
  assert.doesNotThrow(() => assertMountedImplementationMaterialCoverage(
    [requiredMaterial],
    [Object.freeze({ ...requiredMaterial, verified: true as const })],
  ));
  assert.throws(
    () => assertMountedImplementationMaterialCoverage(
      [requiredMaterial],
      [Object.freeze({ ...requiredMaterial, implementation_artifact_hash: `sha256:${"b".repeat(64)}`, verified: true as const })],
    ),
    /missing exact verified mounted implementation material/,
  );
});
