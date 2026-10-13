# Member V0117 source-only conformance

Run:
```bash
npm run test:member:source
npm run test:member:boundary
```

The source checker validates the user-provided 255 field candidates, 75
conditional constraints, nine Member schema/Operation closures, owner-scoped
business reference/temporal/Instance branches, and the candidate public boundary.

A passing source checker **does not** certify a production Scoped Whitelist:
exact owner/source hash Authority Lock, approved RESTRICTED actors, executable
materialization receipts and the final Gate verdict are separate prerequisites.
The output always declares `scoped_whitelist_status: UNRESOLVED` until those
authorities are supplied and independently verified.
