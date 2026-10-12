import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  P0_BIND_INTERFACE_REF,
  P0_CONTRACT_REF,
  P0_EVALUATE_INTERFACE_REF,
  P0_PROVIDER_SYMBOL_REF,
  StableRuntimeError,
  deep_freeze,
  exact_ref,
  stage_role_is_allowed,
} from "../../src/p0/runtime_contract.ts";
import type {
  HookBinding,
  HookDecisionValue,
  HookPointRef,
  RuntimeContext,
  RuntimeInvokeRequest,
  StageExtensionContract,
} from "../../src/p0/runtime_contract.ts";
import { probe_runtime, runtime_provider } from "../../src/p0/stage_handler.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repository_root = resolve(here, "../..");

function exact(name: string): string {
  return `Q.TEST.${name.toUpperCase()}@V0100`;
}

function stage_extension(
  hook_binding_refs: readonly string[] = [],
  overrides: Partial<StageExtensionContract> = {},
): StageExtensionContract {
  return {
    stage_id: "P1",
    stage_role: "NONE",
    stage_contract_ref: exact("p1.contract"),
    implementation_ref: exact("p1.implementation"),
    provided_interface_refs: [],
    consumed_interface_refs: [P0_CONTRACT_REF + "#/interfaces/runtime_execution_invoke"],
    hook_consumer_refs: [],
    hook_binding_refs,
    port_refs: [],
    upstream_runtime_ref: P0_CONTRACT_REF,
    runtime_provider_symbol_ref: P0_PROVIDER_SYMBOL_REF,
    status: "active",
    rule_version_ref: exact("rule"),
    ...overrides,
  };
}

function context(overrides: Partial<RuntimeContext> = {}): RuntimeContext {
  return {
    stage_contract_ref: exact("p1.contract"),
    operation_ref: exact("operation"),
    trace_id: "trace-1",
    request_id: "request-1",
    invocation_id: "invocation-1",
    binding_set_ref: exact("binding.set"),
    attributes: { tenant: "test" },
    ...overrides,
  };
}

let binding_counter = 0;
function binding(
  point: HookPointRef,
  decision: HookDecisionValue,
  order = 0,
  on_evaluate?: () => void,
): HookBinding {
  binding_counter += 1;
  const id = binding_counter;
  const binding_ref = `Q.TEST.BINDING_${id}@V0100`;
  const consumer_ref = `Q.TEST.CONSUMER_${id}@V0100`;
  return {
    binding_ref,
    canonical_name: `binding_${id}`,
    hook_point_ref: point,
    consumer_ref,
    consumer_contract_ref: `Q.TEST.CONSUMER_CONTRACT_${id}@V0100`,
    provider_bind_interface_ref: P0_BIND_INTERFACE_REF,
    provider_evaluate_interface_ref: P0_EVALUATE_INTERFACE_REF,
    allowed_decision_subset: [decision],
    order,
    enabled_rule_ref: `Q.TEST.ENABLED_RULE_${id}@V0100`,
    enabled: true,
    status: "active",
    rule_version_ref: `Q.TEST.RULE_${id}@V0100`,
    consumer: {
      consumer_ref,
      evaluate() {
        on_evaluate?.();
        return { decision };
      },
    },
  };
}

function invoke_request<TInput, TOutput>(
  input: TInput,
  operation: RuntimeInvokeRequest<TInput, TOutput>["operation"],
  bindings: readonly HookBinding[] = [],
  ctx = context(),
): RuntimeInvokeRequest<TInput, TOutput> {
  return {
    stage_extension: stage_extension(bindings.map((item) => item.binding_ref)),
    runtime_context: ctx,
    input,
    operation,
    hook_binding_set: bindings,
  };
}

function repository_files(root: string): string[] {
  const excluded = new Set([".git", "node_modules", "dist", "coverage"]);
  const out: string[] = [];
  function walk(dir: string): void {
    for (const name of readdirSync(dir)) {
      if (excluded.has(name)) continue;
      const path = join(dir, name);
      const info = statSync(path);
      if (info.isDirectory()) walk(path);
      else out.push(relative(root, path).replaceAll("\\", "/"));
    }
  }
  walk(root);
  return out.sort();
}

test("P0 smoke: singleton runtime provider is ready and non-persistent", () => {
  const probe = probe_runtime();
  assert.deepEqual(probe, {
    status: "ready",
    contract_ref: P0_CONTRACT_REF,
    runtime_provider_count: 1,
    runtime_pipeline_count: 1,
    hook_anchor_count: 1,
    persistence: "NONE",
  });
  assert.equal(Object.isFrozen(runtime_provider), true);
});

test("P0 uses exactly five Stage identities and P2 role profiles", () => {
  assert.equal(stage_role_is_allowed("P0", "NONE"), true);
  assert.equal(stage_role_is_allowed("P1", "NONE"), true);
  assert.equal(stage_role_is_allowed("P2", "NONE"), true);
  assert.equal(stage_role_is_allowed("P2", "PROVIDER"), true);
  assert.equal(stage_role_is_allowed("P2", "CONSUMER"), true);
  assert.equal(stage_role_is_allowed("P3", "NONE"), true);
  assert.equal(stage_role_is_allowed("P4", "NONE"), true);
  assert.equal(stage_role_is_allowed("P1", "PROVIDER"), false);
  assert.equal(stage_role_is_allowed("P4", "CONSUMER"), false);
});

test("exact formal references require an exact V#### authority", () => {
  assert.equal(exact_ref("Q.TEST.CONTRACT@V0100"), true);
  assert.equal(exact_ref("Q.TEST.CONTRACT@V0100#/interfaces/example"), true);
  assert.equal(exact_ref("Q.TEST.CONTRACT@${CURRENT}"), false);
  assert.equal(exact_ref("Q.TEST.CONTRACT"), false);
});

test("runtime freezes its invocation context and never mutates caller input", async () => {
  const caller = context({ attributes: { tenant: "before" } });
  let observed: RuntimeContext | undefined;
  const result = await runtime_provider.invoke(
    invoke_request({ value: 1 }, (_input, runtime_context) => {
      observed = runtime_context;
      return { ok: true };
    }, [], caller),
  );
  assert.equal(result.outcome, "success");
  assert.ok(observed);
  assert.equal(Object.isFrozen(observed), true);
  assert.equal(Object.isFrozen(observed.attributes), true);
  assert.equal(caller.attributes?.tenant, "before");
});

test("before_process deny executes the Operation zero times", async () => {
  let attempts = 0;
  const deny = binding("before_process", "deny");
  const result = await runtime_provider.invoke(
    invoke_request("input", () => {
      attempts += 1;
      return "never";
    }, [deny]),
  );
  assert.equal(result.outcome, "denied");
  assert.equal(result.operation_attempts, 0);
  assert.equal(attempts, 0);
});

test("hook order is deterministic by order, consumer_ref, then binding_ref", async () => {
  const order: string[] = [];
  const later = binding("before_process", "continue", 20, () => order.push("later"));
  const early = binding("before_process", "continue", 10, () => order.push("early"));
  const result = await runtime_provider.invoke(
    invoke_request("input", () => "ok", [later, early]),
  );
  assert.equal(result.outcome, "success");
  assert.deepEqual(order, ["early", "later"]);
});

test("after_process recompute never re-executes the Operation", async () => {
  let attempts = 0;
  const recompute = binding("after_process", "recompute");
  const result = await runtime_provider.invoke(
    invoke_request("input", () => {
      attempts += 1;
      return { value: attempts };
    }, [recompute]),
  );
  assert.equal(result.outcome, "success");
  if (result.outcome === "success") {
    assert.equal(result.recompute_requested, true);
    assert.deepEqual(result.value, { value: 1 });
  }
  assert.equal(attempts, 1);
});

test("on_error hook failures cannot replace the normalized primary error", async () => {
  const error_binding = binding("on_error", "continue");
  const failing: HookBinding = {
    ...error_binding,
    consumer: {
      consumer_ref: error_binding.consumer_ref,
      evaluate() {
        throw new StableRuntimeError("SECONDARY", "secondary hook failure");
      },
    },
  };
  const result = await runtime_provider.invoke(
    invoke_request("input", () => {
      throw new StableRuntimeError("PRIMARY", "primary operation failure");
    }, [failing]),
  );
  assert.equal(result.outcome, "error");
  if (result.outcome === "error") {
    assert.equal(result.error.code, "PRIMARY");
    assert.equal(result.error.message, "primary operation failure");
  }
  assert.equal(
    result.hook_evidence.some((item) => item.error?.code === "SECONDARY"),
    true,
  );
});

test("M2 validates binding but does not create a persistent binding registry", () => {
  const candidate = binding("before_process", "continue");
  const first = runtime_provider.bind({ binding: candidate });
  const second = runtime_provider.bind({ binding: candidate });
  assert.equal(first.outcome, "validated");
  assert.equal(first.content_hash, second.content_hash);
  assert.match(first.content_hash, /^[0-9a-f]{64}$/);
});

test("P0 has no invented numeric hook timeout", () => {
  const source = readFileSync(join(repository_root, "src/p0/hook_anchor.ts"), "utf8");
  assert.equal(source.includes("setTimeout("), false);
  const config = readFileSync(
    join(repository_root, "spec/p0/qconfig/runtime_core.qconfig"),
    "utf8",
  );
  assert.match(config, /numeric_duration_defined_by_p0: false/);
});

test("runtime interface projection contains exactly M1 M2 M3 and three layers", () => {
  const projection = JSON.parse(
    readFileSync(
      join(repository_root, "spec/p0/interface/runtime_interfaces.json"),
      "utf8",
    ),
  ) as {
    interfaces: Record<string, {
      kind_code: string;
      path: string[];
      static_mount: string[];
      dynamic_mount: string[];
    }>;
  };
  assert.deepEqual(Object.keys(projection.interfaces).sort(), [
    "runtime_execution_invoke",
    "runtime_hook_bind",
    "runtime_hook_evaluate",
  ]);
  assert.deepEqual(
    Object.values(projection.interfaces).map((item) => item.kind_code).sort(),
    ["M1", "M2", "M3"],
  );
  for (const item of Object.values(projection.interfaces)) {
    assert.ok(item.path.length > 0);
    assert.ok(item.static_mount.length > 0);
    assert.ok(item.dynamic_mount.length > 0);
    assert.equal(
      new Set([...item.path, ...item.static_mount, ...item.dynamic_mount]).size,
      item.path.length + item.static_mount.length + item.dynamic_mount.length,
    );
  }
});

test("P0 root toolchain keeps stage-neutral TypeScript globs and module alias", () => {
  const config = JSON.parse(readFileSync(join(repository_root, "tsconfig.json"), "utf8")) as {
    include?: string[];
    compilerOptions?: { paths?: Record<string, string[]> };
  };
  assert.ok(config.include?.includes("src/**/*.ts"));
  assert.ok(config.include?.includes("tests/**/*.ts"));
  assert.deepEqual(config.compilerOptions?.paths?.["#q/*"], ["src/*"]);
});

test("P0 verification execution is routed through Q.Workflow with no local launcher", () => {
  const files = repository_files(repository_root);
  assert.equal(files.some((path) => /^\.github\/workflows\/.*verify.*\.ya?ml$/.test(path)), false);
  const qcon = readFileSync(join(repository_root, "spec/p0/qcon/runtime_core.qcon.yaml"), "utf8");
  assert.match(qcon, /execution_owner: Q\.WORKFLOW/);
  assert.match(qcon, /Q\.WORKFLOW\.CONTRACT\.DOMAIN@V0116#\/system_interface_declarations\/workflow_execution_invoke/);
  assert.match(qcon, /workflow_success_is_not_gate_pass: true/);
});

test("P0 exact initial baseline contains 14 files and no later-stage placeholders", () => {
  const files = repository_files(repository_root);
  const expected = [
    ".gitignore",
    "README.md",
    "package-lock.json",
    "package.json",
    "spec/p0/interface/runtime_interfaces.json",
    "spec/p0/qconfig/runtime_core.qconfig",
    "spec/p0/qcon/runtime_core.qcon.yaml",
    "spec/p0/qreg/runtime_core.qreg",
    "src/p0/hook_anchor.ts",
    "src/p0/runtime_contract.ts",
    "src/p0/runtime_pipeline.ts",
    "src/p0/stage_handler.ts",
    "tests/p0/p0_runtime_core.test.ts",
    "tsconfig.json",
  ].sort();
  for (const path of expected) assert.equal(files.includes(path), true, `missing P0 baseline path: ${path}`);
  assert.equal(files.some((path) => path.startsWith("tools/p0/")), false);
  const later_stage_content = files.some((path) => /^(?:spec|src|tests)\/p[1-4]\//.test(path));
  if (!later_stage_content) assert.deepEqual(files, expected);
});


test("P0 preserves stable runtime error across physical runtime replicas", async () => {
  class ForeignStableRuntimeError extends Error {
    readonly code = "FOREIGN_STABLE_ERROR";
    readonly details = { provider: "foreign_replica" } as const;

    constructor() {
      super("foreign stable error");
    }
  }

  const result = await runtime_provider.invoke(
    invoke_request("input", () => {
      throw new ForeignStableRuntimeError();
    }),
  );

  assert.equal(result.outcome, "error");

  if (result.outcome === "error") {
    assert.equal(result.error.code, "FOREIGN_STABLE_ERROR");
    assert.equal(result.error.message, "foreign stable error");
    assert.deepEqual(
      result.error.details,
      { provider: "foreign_replica" },
    );
  }
});

