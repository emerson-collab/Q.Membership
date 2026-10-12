import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  IMPLEMENTATION_MATERIAL_REPRESENTATION_ID,
  ImplementationMaterialRuntimeError,
  readAndVerifyInstalledImplementationMaterial,
} from "../../../runtime/implementation_material_runtime.ts";

function shaBytes(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, stable((value as Record<string, unknown>)[key])]));
  }
  return value;
}

function shaJson(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(stable(value)), "utf8").digest("hex")}`;
}

function qcpim(files: readonly Readonly<{ relative_path: string; bytes: Uint8Array }>[]) {
  const package_ref = "Q.CAPABILITY_PACKAGE.PROVIDER.EXAMPLE@V0100";
  const package_content_hash = `sha256:${"a".repeat(64)}`;
  const public_entry_ref = "entry/example.ts#entry";
  const field = (name: string, value: string) => `${name}:${Buffer.byteLength(value, "utf8")}:${value}\n`;
  const records = files.map((file) => `F:${Buffer.byteLength(file.relative_path, "utf8")}:${file.relative_path}:${shaBytes(file.bytes)}\n`).join("");
  const manifest_bytes = Buffer.from(
    `QCPIM1\n${field("package_ref", package_ref)}${field("package_content_hash", package_content_hash)}${field("public_entry_ref", public_entry_ref)}${field("file_count", String(files.length))}${records}`,
    "utf8",
  );
  return { package_ref, package_content_hash, public_entry_ref, manifest_bytes };
}

function fixture() {
  const files = Object.freeze([
    Object.freeze({ relative_path: "entry/example.ts", bytes: Buffer.from("export const entry = 1;\n", "utf8") }),
    Object.freeze({ relative_path: "src/example.ts", bytes: Buffer.from("export const value = 2;\n", "utf8") }),
  ]);
  const material = qcpim(files);
  const payload = {
    publication_hash: `sha256:${"b".repeat(64)}`,
    implementation_artifact_ref: `${material.package_ref}#/implementation_material`,
    implementation_artifact_hash: shaBytes(material.manifest_bytes),
    entry_symbol_ref: material.public_entry_ref,
    local_material_binding_ref: "local:mounted-provider:example",
  };
  const binding = Object.freeze({ ...payload, binding_hash: shaJson(payload), verified: true as const });
  return { files, material, binding };
}

test("installed QCPIM1 material is byte/hash/readback verified from exact local binding", async () => {
  const { files, material, binding } = fixture();
  const verified = await readAndVerifyInstalledImplementationMaterial(binding, {
    async readExact(input) {
      assert.equal(input.local_material_binding_ref, binding.local_material_binding_ref);
      return {
        representation_id: IMPLEMENTATION_MATERIAL_REPRESENTATION_ID,
        manifest_bytes: material.manifest_bytes,
        files,
      };
    },
  });
  assert.equal(verified.implementation_artifact_hash, binding.implementation_artifact_hash);
  assert.equal(verified.public_entry_ref, binding.entry_symbol_ref);
  assert.deepEqual(verified.files.map((file) => file.relative_path), files.map((file) => file.relative_path));
});

test("installed material fails closed on exact file-byte mismatch", async () => {
  const { files, material, binding } = fixture();
  const tampered = [
    files[0]!,
    Object.freeze({ relative_path: files[1]!.relative_path, bytes: Buffer.from("tampered\n", "utf8") }),
  ];
  await assert.rejects(
    () => readAndVerifyInstalledImplementationMaterial(binding, {
      async readExact() {
        return {
          representation_id: IMPLEMENTATION_MATERIAL_REPRESENTATION_ID,
          manifest_bytes: material.manifest_bytes,
          files: tampered,
        };
      },
    }),
    (error: unknown) => error instanceof ImplementationMaterialRuntimeError && error.code === "IMPLEMENTATION_MATERIAL_FILE_HASH_MISMATCH",
  );
});

test("installed material fails closed when resolver entry does not equal QCPIM1 public entry", async () => {
  const { files, material, binding } = fixture();
  const payload = {
    publication_hash: binding.publication_hash,
    implementation_artifact_ref: binding.implementation_artifact_ref,
    implementation_artifact_hash: binding.implementation_artifact_hash,
    entry_symbol_ref: "entry/other.ts#entry",
    local_material_binding_ref: binding.local_material_binding_ref,
  };
  const wrong = Object.freeze({ ...payload, binding_hash: shaJson(payload), verified: true as const });
  await assert.rejects(
    () => readAndVerifyInstalledImplementationMaterial(wrong, {
      async readExact() {
        return {
          representation_id: IMPLEMENTATION_MATERIAL_REPRESENTATION_ID,
          manifest_bytes: material.manifest_bytes,
          files,
        };
      },
    }),
    (error: unknown) => error instanceof ImplementationMaterialRuntimeError && error.code === "IMPLEMENTATION_MATERIAL_ENTRY_MISMATCH",
  );
});
