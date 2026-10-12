# Q.P0-P2 Skeleton

This repository is the reusable Q P0–P2 implementation skeleton. It contains the P0 Runtime Core, P1 Business Runtime, P2 Provider/Consumer realizations, and their shared support files.

## Authority boundary

Authoritative Contract bytes are resolved from Q Cloud Storage. Repository-side material preserves exact Contract refs and hashes without copying Contract authority bytes. The repository stable name is non-semantic and does not create a Domain Contract; concrete Capability Contract authority remains external.

## Current baseline

- Repository Skeleton: `Q.SS.STD.META.CONTRACT.REPOSITORY_DIRECTORY_SKELETON@V0152`
- Repository Skeleton SHA-256: `sha256:0d8b2a5fb33b657db9eff3d379969b8c26e541f9ff5827d443bd8d2aa8fe60c9`
- P1 Capability Materialization: `Q.SS.STD.META.CONTRACT.P1_CAPABILITY_MATERIALIZATION@V0116`
- P1 Capability Materialization SHA-256: `sha256:59dce7f2b10d04fe6053a28d9f2af09d961746befd10795e874b3226aefaf036`
- P1 Capability Materialization rule map: 57 mappings, snapshot `sha256:32ddcd72bb722e4c3e4f6fd4dd2abf8ac783e8eea7ea27fa49f9d6d3728619e6`
- Capability Package: `Q.SS.STD.META.CONTRACT.CAPABILITY_PACKAGE@V0115`
- P0 Runtime Core: `Q.SS.STD.P0.CONTRACT.RUNTIME_CORE@V0134`
- P1 Business Runtime: `Q.SS.STD.P1.CONTRACT.BUSINESS_RUNTIME@V0186`
- P1 Business Runtime SHA-256: `sha256:4637e7370406d558514f8ff3e076336b0e557e5b002e8a7123fa51db4d68dbc3`
- P2 Cross-Domain Realization: `Q.SS.STD.P2.CONTRACT.CROSS_DOMAIN_REALIZATION@V0128`
- P2 Cross-Domain Realization SHA-256: `sha256:15549a6a4a0c005ccbeddb0c7b40b4f4918f336c731b7c2017f05e2926bbb71d`
- Governed Data Material: `Q.SS.STD.META.CONTRACT.GOVERNED_DATA_MATERIAL@V0104`

## P1 fixed framework

P1 concrete Capability implementations remain direct overlays over the fixed P1 Business Runtime files. P1 V0186 keeps CALL, HOOK, EVENT and REGISTRY catalogs unchanged and owns the native EVENT framework registry, exact Interface-to-existing-Operation binding, and the fixed `publish_business_event` / `consume_business_event` dispatch.

Every concrete EVENT Interface must be preverified against its exact Capability Contract and existing Operation before dispatch. Transport, caller, channel, source-code discovery and payload content cannot select or override the business Operation. `EVENT_CONSUME` forwards the event input without semantic transformation to the exact existing Operation selected only by the registered Interface binding. `EVENT_PUBLISH` delivers only after the owning Operation has produced its authoritative fact/finalized outcome and never re-executes that Operation.

## P1 dynamic-variable overlay

Repository Skeleton V0152 declares the physical dynamic-variable boundary. Skeleton/template variables resolve from exactly one allowed governed source: an exact Capability Contract GENERAL fact, an exact Capability Instance parameter, or an exact Capability Instance binding. Structural `capability_id` and `operation_id` values are Contract GENERAL facts and fill only predeclared Skeleton paths. V0186 makes the P1 overlay machine-exact: Capability GENERAL values bind only to the 13 exact predeclared `CAPABILITY_GENERAL_SLOT` identities, while `route_key` remains a P1 runtime slot derived as the exact `operation_ref` bytes. The canonical Skeleton adds no runtime binder, adapter, bridge, wrapper, or second Runtime.

Dynamic-variable resolution belongs to governed repository/template materialization. After materialization, concrete P1 Capability code connects directly to the fixed P1 framework through the existing StageExtension, Operation registry and Interface registry slots. The canonical Skeleton does not add a runtime dynamic-variable resolver, owner-local P1 binding resolver, adapter, bridge or Capability-specific connection helper between the concrete Capability and the fixed P1 framework.

Capability-specific runtime support is not part of the canonical P1 connection path. When an exact Capability Contract and DRT explicitly authorize such runtime support, it may use the optional repository `runtime/` root without becoming Skeleton semantic authority.

## Listener-neutral runtime root

Repository Skeleton V0152 owns only the generic repository/runtime-root topology and predeclared path boundaries. It owns no listener semantics, persistent listener connection, reconnect loop, provider/channel lifecycle or listener bootstrap. P1 V0186 also owns none of those lifecycle semantics.

Persistent listener transport lifecycle may exist only when an exact Capability Contract explicitly declares that ownership. Such Capability-owned lifecycle remains inside the sole existing P0 Runtime. A second Runtime, P0 EVENT Surface expansion, runtime adapter, bridge, wrapper, listener wrapper Operation, business-specific event wrapper, polling substitute, or transport-selected Operation is forbidden.

The canonical Skeleton therefore contains no P1 runtime dynamic-variable resolver, P1 Capability connection helper, Q.Secret-specific resolver or deployment-provider identity implementation. Concrete provider, Secret, listener and deployment bindings remain outside the fixed P1 Skeleton unless explicitly authorized by the owning exact Contract/DRT.

## Governed-data JSON triad execution

Repository Skeleton V0152 closes the existing non-Stage repository-support execution boundary around the exact P1 Capability Materialization V0116 `governed_data_json_triad_obligation`.

For a DECLARED obligation, the canonical physical projection is exactly:

```text
STATIC  → static.json  → expose_static_data
DYNAMIC → dynamic.json → expose_dynamic_data
RUNTIME → runtime.json → expose_runtime_data
```

Only non-empty categories invoke the corresponding existing CURRENT P2 V0128 Provider exposure Operation. An empty category still materializes its required canonical JSON projection with `bindings: []` and `material_envelopes: []`, but invokes no P2 exposure Operation.

All three files must be durable and exact-hash read-back verified before the ordered triad-set hash is accepted and before any triad commit/current-pointer mutation. The exact implementing storage or persistence authority owns the `SHA256_CANONICAL_ORDERED_FILE_HASH_TUPLE` realization and mutable current-pointer semantics; a partial triad current pointer is forbidden and the pointer switch is atomic and last. Filenames remain physical projection identities, not semantic authority.

## P2 and verification boundaries

Capability Package V0115 preserves immutable implementation-material semantics. P2 V0128 owns cross-Domain Provider/Consumer realization and receiving-owner-local durable mount/dependency runtime facts; P1 and the repository Skeleton do not acquire P2 business semantics.

Q.Workflow remains the verification/workflow execution owner. Q.Gate remains the final Gate verdict authority. Workflow success, repository merge, standard registration, or activation state is not a substitute for Gate PASS.
