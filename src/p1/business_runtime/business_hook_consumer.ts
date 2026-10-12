import { deep_freeze } from "../../p0/runtime_contract.ts";

// The fixed P1 framework owns no concrete business Hook consumer.
// Concrete Capability hook values, when declared, enter only through governed overlay slots.
export const business_hook_consumers = deep_freeze([] as const);
