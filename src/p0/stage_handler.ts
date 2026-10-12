import { HookAnchor } from "./hook_anchor.ts";
import { RuntimePipeline } from "./runtime_pipeline.ts";
import {
  P0_CONTRACT_REF,
  deep_freeze,
} from "./runtime_contract.ts";
import type {
  HookBindRequest,
  HookBindResult,
  RuntimeInvokeRequest,
  RuntimeInvokeResult,
  RuntimeProbe,
  RuntimeProvider,
} from "./runtime_contract.ts";

const hook_anchor = new HookAnchor();
const runtime_pipeline = new RuntimePipeline(hook_anchor);

class RuntimeProviderImpl implements RuntimeProvider {
  async invoke<TInput = unknown, TOutput = unknown>(
    request: RuntimeInvokeRequest<TInput, TOutput>,
  ): Promise<RuntimeInvokeResult<TOutput>> {
    return runtime_pipeline.invoke(request);
  }

  bind(request: HookBindRequest): HookBindResult {
    return hook_anchor.bind(request);
  }

  probe(): RuntimeProbe {
    return probe_runtime();
  }


}

export const runtime_provider: RuntimeProvider = deep_freeze(new RuntimeProviderImpl());

export function probe_runtime(): RuntimeProbe {
  return deep_freeze({
    status: "ready",
    contract_ref: P0_CONTRACT_REF,
    runtime_provider_count: 1,
    runtime_pipeline_count: 1,
    hook_anchor_count: 1,
    persistence: "NONE",
  });
}
