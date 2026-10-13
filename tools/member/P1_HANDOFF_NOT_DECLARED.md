# Member V0104 P1 governed-data Handoff

This is the explicit **P1 only** preflight; it does not involve Q.Workflow,
Q.Prompt, GitHub Actions, or Google Drive write operations.

Authoritative Member V0104 Source (exact SHA256) declares:

- governed_data_exposure.mode = NONE
- governed_data_exposure.bindings = []

To inspect without side effects:

    npm run inspect:member:p1-handoff

To require exposure readiness before any triad generation:

    npm run check:member:triad-ready

The latter **exits 2** while Owner Source is unapproved or has no declared
authorized bindings. The current Owner Contract and registered hash MUST NOT
be silently rewritten; the report's reason is RDS_GOVERNED_DATA_NOT_DECLARED,
not a failed Google Drive upload. A later DECLARED mode alone is insufficient:
binding source authority and frozen execution evidence still require independent
verification. No production activation or Q.Gate pass is asserted.

Run the targeted regression tests locally (no GitHub CI):

    npm run test:member:handoff
