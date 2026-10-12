import { createHash } from "node:crypto";

export const CAPABILITY_PACKAGE_CONTRACT_REF =
  "Q.SS.STD.META.CONTRACT.CAPABILITY_PACKAGE@V0115" as const;
export const IMPLEMENTATION_MATERIAL_REPRESENTATION_ID =
  "Q_CAPABILITY_PACKAGE_IMPLEMENTATION_MATERIAL_SET_V0100" as const;

const PACKAGE_REF_PATTERN = /^Q\.CAPABILITY_PACKAGE\.[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*\.[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*@V[0-9]{4}$/;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;

export interface ResolvedImplementationBinding {
  readonly publication_hash: string;
  readonly implementation_artifact_ref: string;
  readonly implementation_artifact_hash: string;
  readonly entry_symbol_ref: string;
  readonly local_material_binding_ref: string;
  readonly binding_hash: string;
  readonly verified: true;
}

export interface InstalledImplementationMaterialFile {
  readonly relative_path: string;
  readonly bytes: Uint8Array;
}

export interface InstalledImplementationMaterialReadResult {
  readonly representation_id: typeof IMPLEMENTATION_MATERIAL_REPRESENTATION_ID;
  readonly manifest_bytes: Uint8Array;
  readonly files: readonly InstalledImplementationMaterialFile[];
}

export interface LocalImplementationMaterialReadPort {
  readExact(input: Readonly<{
    local_material_binding_ref: string;
    implementation_artifact_ref: string;
    implementation_artifact_hash: string;
  }>): Promise<InstalledImplementationMaterialReadResult>;
}

export interface VerifiedInstalledImplementationMaterial {
  readonly representation_id: typeof IMPLEMENTATION_MATERIAL_REPRESENTATION_ID;
  readonly package_ref: string;
  readonly package_content_hash: string;
  readonly public_entry_ref: string;
  readonly implementation_artifact_ref: string;
  readonly implementation_artifact_hash: string;
  readonly local_material_binding_ref: string;
  readonly files: readonly Readonly<{
    relative_path: string;
    content_hash: string;
    bytes: Uint8Array;
  }>[];
}

export class ImplementationMaterialRuntimeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ImplementationMaterialRuntimeError";
    this.code = code;
  }
}

function sha256ExactBytes(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function stableClone(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableClone);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) out[key] = stableClone(source[key]);
    return out;
  }
  return value;
}

function sha256Json(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(stableClone(value)), "utf8").digest("hex")}`;
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ImplementationMaterialRuntimeError("IMPLEMENTATION_MATERIAL_BINDING_INVALID", `${field} must be a non-empty string`);
  }
  return value;
}

function sha256Value(value: unknown, field: string): string {
  const text = nonEmptyString(value, field);
  if (!SHA256_PATTERN.test(text)) {
    throw new ImplementationMaterialRuntimeError("IMPLEMENTATION_MATERIAL_BINDING_INVALID", `${field} must be an exact sha256 binding`);
  }
  return text;
}

function verifyResolverBinding(binding: ResolvedImplementationBinding): void {
  if (binding.verified !== true) {
    throw new ImplementationMaterialRuntimeError("IMPLEMENTATION_MATERIAL_BINDING_INVALID", "verified resolver binding required");
  }
  const publication_hash = sha256Value(binding.publication_hash, "publication_hash");
  const implementation_artifact_ref = nonEmptyString(binding.implementation_artifact_ref, "implementation_artifact_ref");
  const implementation_artifact_hash = sha256Value(binding.implementation_artifact_hash, "implementation_artifact_hash");
  const entry_symbol_ref = nonEmptyString(binding.entry_symbol_ref, "entry_symbol_ref");
  const local_material_binding_ref = nonEmptyString(binding.local_material_binding_ref, "local_material_binding_ref");
  const binding_hash = sha256Value(binding.binding_hash, "binding_hash");
  const expected = sha256Json({
    publication_hash,
    implementation_artifact_ref,
    implementation_artifact_hash,
    entry_symbol_ref,
    local_material_binding_ref,
  });
  if (binding_hash !== expected) {
    throw new ImplementationMaterialRuntimeError("IMPLEMENTATION_MATERIAL_BINDING_HASH_MISMATCH", "resolver binding_hash does not match exact implementation material identity");
  }
}

class ByteCursor {
  readonly #bytes: Buffer;
  #offset = 0;

  constructor(bytes: Uint8Array) {
    this.#bytes = Buffer.from(bytes);
  }

  get eof(): boolean {
    return this.#offset === this.#bytes.byteLength;
  }

  literal(value: string): void {
    const expected = Buffer.from(value, "ascii");
    const actual = this.#bytes.subarray(this.#offset, this.#offset + expected.byteLength);
    if (!actual.equals(expected)) {
      throw new ImplementationMaterialRuntimeError("IMPLEMENTATION_MATERIAL_MANIFEST_INVALID", `expected literal ${JSON.stringify(value)}`);
    }
    this.#offset += expected.byteLength;
  }

  unsignedDecimalUntilColon(field: string): number {
    const start = this.#offset;
    while (this.#offset < this.#bytes.byteLength && this.#bytes[this.#offset] !== 0x3a) this.#offset += 1;
    if (this.#offset >= this.#bytes.byteLength) {
      throw new ImplementationMaterialRuntimeError("IMPLEMENTATION_MATERIAL_MANIFEST_INVALID", `${field} length terminator missing`);
    }
    const text = this.#bytes.subarray(start, this.#offset).toString("ascii");
    if (!/^(0|[1-9][0-9]*)$/.test(text)) {
      throw new ImplementationMaterialRuntimeError("IMPLEMENTATION_MATERIAL_MANIFEST_INVALID", `${field} length is not base-10 unsigned integer text`);
    }
    this.#offset += 1;
    const length = Number(text);
    if (!Number.isSafeInteger(length)) {
      throw new ImplementationMaterialRuntimeError("IMPLEMENTATION_MATERIAL_MANIFEST_INVALID", `${field} length exceeds safe integer range`);
    }
    return length;
  }

  utf8Bytes(length: number, field: string): string {
    if (this.#offset + length > this.#bytes.byteLength) {
      throw new ImplementationMaterialRuntimeError("IMPLEMENTATION_MATERIAL_MANIFEST_INVALID", `${field} exceeds manifest bytes`);
    }
    const value = this.#bytes.subarray(this.#offset, this.#offset + length);
    this.#offset += length;
    const text = value.toString("utf8");
    if (!Buffer.from(text, "utf8").equals(value)) {
      throw new ImplementationMaterialRuntimeError("IMPLEMENTATION_MATERIAL_MANIFEST_INVALID", `${field} is not exact UTF-8`);
    }
    return text;
  }

  lineRemainder(field: string): string {
    const newline = this.#bytes.indexOf(0x0a, this.#offset);
    if (newline < 0) {
      throw new ImplementationMaterialRuntimeError("IMPLEMENTATION_MATERIAL_MANIFEST_INVALID", `${field} LF terminator missing`);
    }
    const value = this.#bytes.subarray(this.#offset, newline).toString("ascii");
    this.#offset = newline + 1;
    return value;
  }
}

function field(cursor: ByteCursor, name: string): string {
  cursor.literal(`${name}:`);
  const length = cursor.unsignedDecimalUntilColon(name);
  const value = cursor.utf8Bytes(length, name);
  cursor.literal("\n");
  return value;
}

function parseManifest(manifestBytes: Uint8Array): Readonly<{
  package_ref: string;
  package_content_hash: string;
  public_entry_ref: string;
  files: readonly Readonly<{ relative_path: string; content_hash: string }>[];
}> {
  const cursor = new ByteCursor(manifestBytes);
  cursor.literal("QCPIM1\n");
  const package_ref = field(cursor, "package_ref");
  const package_content_hash = field(cursor, "package_content_hash");
  const public_entry_ref = field(cursor, "public_entry_ref");
  const fileCountText = field(cursor, "file_count");

  if (!PACKAGE_REF_PATTERN.test(package_ref)) {
    throw new ImplementationMaterialRuntimeError("IMPLEMENTATION_MATERIAL_MANIFEST_INVALID", "package_ref is not an exact Capability Package ref");
  }
  if (!SHA256_PATTERN.test(package_content_hash)) {
    throw new ImplementationMaterialRuntimeError("IMPLEMENTATION_MATERIAL_MANIFEST_INVALID", "package_content_hash must be exact sha256");
  }
  if (public_entry_ref.length === 0) {
    throw new ImplementationMaterialRuntimeError("IMPLEMENTATION_MATERIAL_MANIFEST_INVALID", "public_entry_ref is required");
  }
  if (!/^(0|[1-9][0-9]*)$/.test(fileCountText)) {
    throw new ImplementationMaterialRuntimeError("IMPLEMENTATION_MATERIAL_MANIFEST_INVALID", "file_count must be base-10 unsigned integer text");
  }
  const fileCount = Number(fileCountText);
  if (!Number.isSafeInteger(fileCount) || fileCount <= 0) {
    throw new ImplementationMaterialRuntimeError("IMPLEMENTATION_MATERIAL_MANIFEST_INVALID", "installable implementation material must contain at least one file");
  }

  const files: Array<Readonly<{ relative_path: string; content_hash: string }>> = [];
  const seen = new Set<string>();
  for (let index = 0; index < fileCount; index += 1) {
    cursor.literal("F:");
    const pathLength = cursor.unsignedDecimalUntilColon(`file[${index}].relative_path`);
    const relative_path = cursor.utf8Bytes(pathLength, `file[${index}].relative_path`);
    cursor.literal(":");
    const content_hash = cursor.lineRemainder(`file[${index}].content_hash`);
    if (relative_path.length === 0 || relative_path.includes("\u0000") || seen.has(relative_path)) {
      throw new ImplementationMaterialRuntimeError("IMPLEMENTATION_MATERIAL_MANIFEST_INVALID", "implementation material file paths must be unique non-empty UTF-8 text");
    }
    if (!SHA256_PATTERN.test(content_hash)) {
      throw new ImplementationMaterialRuntimeError("IMPLEMENTATION_MATERIAL_MANIFEST_INVALID", "implementation material file content_hash must be exact sha256");
    }
    seen.add(relative_path);
    files.push(Object.freeze({ relative_path, content_hash }));
  }
  if (!cursor.eof) {
    throw new ImplementationMaterialRuntimeError("IMPLEMENTATION_MATERIAL_MANIFEST_INVALID", "unexpected trailing manifest bytes");
  }

  return Object.freeze({ package_ref, package_content_hash, public_entry_ref, files: Object.freeze(files) });
}

export async function readAndVerifyInstalledImplementationMaterial(
  binding: ResolvedImplementationBinding,
  port: LocalImplementationMaterialReadPort,
): Promise<VerifiedInstalledImplementationMaterial> {
  verifyResolverBinding(binding);
  const readBack = await port.readExact(Object.freeze({
    local_material_binding_ref: binding.local_material_binding_ref,
    implementation_artifact_ref: binding.implementation_artifact_ref,
    implementation_artifact_hash: binding.implementation_artifact_hash,
  }));
  if (readBack.representation_id !== IMPLEMENTATION_MATERIAL_REPRESENTATION_ID) {
    throw new ImplementationMaterialRuntimeError("IMPLEMENTATION_MATERIAL_REPRESENTATION_MISMATCH", "installed implementation material representation is not QCPIM1");
  }
  if (sha256ExactBytes(readBack.manifest_bytes) !== binding.implementation_artifact_hash) {
    throw new ImplementationMaterialRuntimeError("IMPLEMENTATION_MATERIAL_HASH_MISMATCH", "installed QCPIM1 manifest hash does not match resolver_state");
  }

  const manifest = parseManifest(readBack.manifest_bytes);
  if (`${manifest.package_ref}#/implementation_material` !== binding.implementation_artifact_ref) {
    throw new ImplementationMaterialRuntimeError("IMPLEMENTATION_MATERIAL_ARTIFACT_REF_MISMATCH", "QCPIM1 package_ref does not derive the exact implementation_artifact_ref");
  }
  if (manifest.public_entry_ref !== binding.entry_symbol_ref) {
    throw new ImplementationMaterialRuntimeError("IMPLEMENTATION_MATERIAL_ENTRY_MISMATCH", "QCPIM1 public_entry_ref does not match resolver_state entry_symbol_ref");
  }
  if (readBack.files.length !== manifest.files.length) {
    throw new ImplementationMaterialRuntimeError("IMPLEMENTATION_MATERIAL_FILE_SET_MISMATCH", "installed implementation material file count does not match QCPIM1 manifest");
  }

  const actualByPath = new Map<string, InstalledImplementationMaterialFile>();
  for (const file of readBack.files) {
    if (actualByPath.has(file.relative_path)) {
      throw new ImplementationMaterialRuntimeError("IMPLEMENTATION_MATERIAL_FILE_SET_MISMATCH", "installed implementation material contains duplicate file paths");
    }
    actualByPath.set(file.relative_path, file);
  }

  const verifiedFiles = manifest.files.map((expected) => {
    const actual = actualByPath.get(expected.relative_path);
    if (actual === undefined || sha256ExactBytes(actual.bytes) !== expected.content_hash) {
      throw new ImplementationMaterialRuntimeError("IMPLEMENTATION_MATERIAL_FILE_HASH_MISMATCH", `installed file does not match QCPIM1 hash: ${expected.relative_path}`);
    }
    return Object.freeze({
      relative_path: expected.relative_path,
      content_hash: expected.content_hash,
      bytes: Buffer.from(actual.bytes),
    });
  });

  return Object.freeze({
    representation_id: IMPLEMENTATION_MATERIAL_REPRESENTATION_ID,
    package_ref: manifest.package_ref,
    package_content_hash: manifest.package_content_hash,
    public_entry_ref: manifest.public_entry_ref,
    implementation_artifact_ref: binding.implementation_artifact_ref,
    implementation_artifact_hash: binding.implementation_artifact_hash,
    local_material_binding_ref: binding.local_material_binding_ref,
    files: Object.freeze(verifiedFiles),
  });
}
