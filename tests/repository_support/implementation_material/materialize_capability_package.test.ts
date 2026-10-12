import assert from "node:assert/strict";
import test from "node:test";

import {
  ImplementationMaterialError,
  IMPLEMENTATION_MATERIAL_REPRESENTATION_ID,
  materializeCapabilityPackageImplementation,
  type CapabilityPackageFile,
  type GovernedArtifactReadRequest,
  type GovernedArtifactStore,
  type GovernedArtifactWriteRequest,
} from "../../../tools/implementation_material/materialize_capability_package.ts";

class MemoryStore implements GovernedArtifactStore {
  lastWrite?: GovernedArtifactWriteRequest;
  tamperManifest = false;
  tamperFile = false;
  reverseReadback = false;

  async writeImmutable(request: GovernedArtifactWriteRequest) {
    this.lastWrite = {
      ...request,
      manifest_bytes: Buffer.from(request.manifest_bytes),
      files: request.files.map((file) => ({ relative_path: file.relative_path, bytes: Buffer.from(file.bytes) })),
    };
    return { provider_neutral_locator_binding: Object.freeze({ object_key: "immutable-test-object" }) };
  }

  async readImmutable(_request: GovernedArtifactReadRequest) {
    assert.ok(this.lastWrite);
    const manifest = Buffer.from(this.lastWrite.manifest_bytes);
    if (this.tamperManifest) manifest[0] = 0x58;
    const files = this.lastWrite.files.map((file, index) => {
      const bytes = Buffer.from(file.bytes);
      if (this.tamperFile && index === 0 && bytes.length > 0) bytes[0] = (bytes[0] ?? 0) ^ 0xff;
      return { relative_path: file.relative_path, bytes };
    });
    if (this.reverseReadback) files.reverse();
    return { manifest_bytes: manifest, files };
  }
}

const packageManifest = Object.freeze({
  package_ref: "Q.CAPABILITY_PACKAGE.SEARCH.SEARCH_RUNTIME@V0100",
  package_content_hash: `sha256:${"a".repeat(64)}`,
  public_entry_ref: "entry/search.ts#entry",
  extraction_mode: "SOURCE_INSTALLABLE" as const,
});

const files: readonly CapabilityPackageFile[] = Object.freeze([
  Object.freeze({ relative_path: "entry/search.ts", bytes: Buffer.from("export const entry = 1;\n", "utf8") }),
  Object.freeze({ relative_path: "package_manifest.qcon.yaml", bytes: Buffer.from("package: search\n", "utf8") }),
]);

test("materializer creates deterministic exact immutable P2 binding after read-back verification", async () => {
  const firstStore = new MemoryStore();
  const first = await materializeCapabilityPackageImplementation(packageManifest, files, firstStore);
  const secondStore = new MemoryStore();
  const second = await materializeCapabilityPackageImplementation(packageManifest, files, secondStore);

  assert.deepEqual(first, second);
  assert.equal(first.artifact_ref, `${packageManifest.package_ref}#/implementation_material`);
  assert.match(first.content_hash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(first.entry_symbol_ref, packageManifest.public_entry_ref);
  assert.equal(first.immutable, true);
  assert.equal(firstStore.lastWrite?.representation_id, IMPLEMENTATION_MATERIAL_REPRESENTATION_ID);
  assert.equal(Buffer.from(firstStore.lastWrite?.manifest_bytes ?? []).subarray(0, 7).toString("ascii"), "QCPIM1\n");
});

test("materializer verifies the exact file set independent of artifact-store read-back ordering", async () => {
  const store = new MemoryStore();
  store.reverseReadback = true;
  const binding = await materializeCapabilityPackageImplementation(packageManifest, files, store);
  assert.equal(binding.immutable, true);
});

test("materializer fails closed when governed artifact read-back changes bytes", async () => {
  const store = new MemoryStore();
  store.tamperFile = true;
  await assert.rejects(
    () => materializeCapabilityPackageImplementation(packageManifest, files, store),
    (error: unknown) => error instanceof ImplementationMaterialError
      && error.code === "IMPLEMENTATION_MATERIAL_READBACK_MISMATCH",
  );
});

test("materializer rejects non-installable package modes", async () => {
  const store = new MemoryStore();
  await assert.rejects(
    () => materializeCapabilityPackageImplementation(
      { ...packageManifest, extraction_mode: "LOCAL_ONLY" as never },
      files,
      store,
    ),
    (error: unknown) => error instanceof ImplementationMaterialError
      && error.code === "IMPLEMENTATION_MATERIAL_INVALID",
  );
});
