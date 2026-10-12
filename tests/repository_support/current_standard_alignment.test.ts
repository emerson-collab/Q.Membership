import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

import {
  P1_CAPABILITY_MATERIALIZATION_HASH,
  P1_CAPABILITY_MATERIALIZATION_REF,
  P2_CONTRACT_HASH,
  P2_CONTRACT_REF,
  REPOSITORY_SKELETON_HASH,
  REPOSITORY_SKELETON_REF,
} from "../../runtime/governed_data_provider_realization.ts";
import {
  P1_CAPABILITY_GENERAL_SLOT_IDS,
  P1_CONTRACT_HASH,
  P1_CONTRACT_REF,
  P1_FRAMEWORK_ANCHOR_CROSSWALK,
} from "../../src/p1/business_runtime/stage_extension_contract.ts";

const ROOT = process.cwd();
const TEXT_EXTENSIONS = new Set([".json", ".md", ".qconfig", ".qcon", ".qreg", ".ts", ".txt", ".yaml"]);

function filesBelow(root: string): string[] {
  const output: string[] = [];
  for (const entry of readdirSync(root)) {
    if (entry === ".git" || entry === "node_modules") continue;
    const path = join(root, entry);
    if (statSync(path).isDirectory()) output.push(...filesBelow(path));
    else output.push(path);
  }
  return output;
}

test("CURRENT authority refs and source hashes are pinned exactly", () => {
  assert.equal(REPOSITORY_SKELETON_REF, "Q.SS.STD.META.CONTRACT.REPOSITORY_DIRECTORY_SKELETON@V0152");
  assert.equal(REPOSITORY_SKELETON_HASH, "sha256:0d8b2a5fb33b657db9eff3d379969b8c26e541f9ff5827d443bd8d2aa8fe60c9");
  assert.equal(P1_CAPABILITY_MATERIALIZATION_REF, "Q.SS.STD.META.CONTRACT.P1_CAPABILITY_MATERIALIZATION@V0116");
  assert.equal(P1_CAPABILITY_MATERIALIZATION_HASH, "sha256:59dce7f2b10d04fe6053a28d9f2af09d961746befd10795e874b3226aefaf036");
  assert.equal(P1_CONTRACT_REF, "Q.SS.STD.P1.CONTRACT.BUSINESS_RUNTIME@V0186");
  assert.equal(P1_CONTRACT_HASH, "sha256:4637e7370406d558514f8ff3e076336b0e557e5b002e8a7123fa51db4d68dbc3");
  assert.equal(P2_CONTRACT_REF, "Q.SS.STD.P2.CONTRACT.CROSS_DOMAIN_REALIZATION@V0128");
  assert.equal(P2_CONTRACT_HASH, "sha256:15549a6a4a0c005ccbeddb0c7b40b4f4918f336c731b7c2017f05e2926bbb71d");
});

test("V0116 and V0186 preserve the exact GENERAL-slot and framework-anchor boundaries", () => {
  assert.equal(P1_CAPABILITY_GENERAL_SLOT_IDS.length, 13);
  assert.deepEqual(P1_CAPABILITY_GENERAL_SLOT_IDS, [
    "capability_ref",
    "capability_id",
    "capability_version",
    "capability_contract_ref",
    "capability_contract_content_hash",
    "stage_contract_ref",
    "runtime_contract_ref",
    "operation_id",
    "operation_ref",
    "interface_ref",
    "surface",
    "kind",
    "method_ref",
  ]);
  assert.equal(Object.keys(P1_FRAMEWORK_ANCHOR_CROSSWALK).length, 8);
  const interfaceProjection = JSON.parse(
    readFileSync(join(ROOT, "spec/p1/business_runtime/interface/business_interfaces.json"), "utf8"),
  ) as { interfaces: Record<string, unknown> };
  const interfaceRegistry = JSON.parse(
    readFileSync(join(ROOT, "spec/p1/business_runtime/qreg/business_runtime.qreg"), "utf8"),
  ) as { interfaces: string[] };
  assert.equal(Object.keys(interfaceProjection.interfaces).length, 10);
  assert.equal(interfaceRegistry.interfaces.length, 10);
});

test("V0128 DRT projects the exact 56-path Provider/Consumer closure", () => {
  const drtPath = join(ROOT, "standards/authority/stages/p2/drt/P2.DRT.V0128.txt");
  const lines = readFileSync(drtPath, "utf8").split(/\r?\n/);
  const paths = lines.filter((line) => /^(standards|spec|src|tests)\//.test(line));
  assert.equal(paths.length, 56);
  assert.equal(new Set(paths).size, 56);
  for (const path of paths) assert.equal(existsSync(join(ROOT, path)), true, `missing V0128 path: ${path}`);

  const handlers = filesBelow(join(ROOT, "src/p2"))
    .filter((path) => path.endsWith("handler.ts"));
  assert.equal(handlers.length, 17);
  const operationIds = new Set<string>();
  for (const handler of handlers) {
    const content = readFileSync(handler, "utf8");
    assert.match(content, /Q\.SS\.STD\.P2\.CONTRACT\.CROSS_DOMAIN_REALIZATION@V0128/);
    const match = content.match(/OPERATION_ID\s*=\s*"([^"]+)"/);
    const operationId = match?.[1];
    assert.ok(operationId, `missing OPERATION_ID: ${relative(ROOT, handler)}`);
    operationIds.add(operationId);
  }
  assert.equal(operationIds.size, 17);
});

test("active repository material contains no superseded CURRENT bindings", () => {
  const forbidden = [
    "P1_CAPABILITY_MATERIALIZATION@" + "V01" + "11",
    "BUSINESS_RUNTIME@" + "V01" + "84",
    "CROSS_DOMAIN_REALIZATION@" + "V01" + "25",
    "governed_data_json_triad_" + "projection_contract",
    "ce9c826ced37c73213a2900c2fdc3944" + "8ac885ed846ff43ed15ca85c4fef1b5a",
    "f4e2be97bf39b322863fb2ddedebe96bb" + "e312dbaeba23a8087d2d88b8cf51a13",
    "f5ef222443b0f575f679a147d2b1ede9" + "84096cd120701758ed085cbf5e54a11f",
  ];
  const violations: string[] = [];
  for (const path of filesBelow(ROOT)) {
    const extension = path.slice(path.lastIndexOf("."));
    if (!TEXT_EXTENSIONS.has(extension)) continue;
    const content = readFileSync(path, "utf8");
    for (const token of forbidden) {
      if (content.includes(token)) violations.push(`${relative(ROOT, path)}: ${token}`);
    }
  }
  assert.deepEqual(violations, []);
});
