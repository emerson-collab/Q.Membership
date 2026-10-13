# Member V0104 compact whitelist validation

The user-supplied `Q.MEMBERSHIP.MEMBER.V0104.WHITELIST.COMPACT.UNRESOLVED`
is the explicit field acceptance checklist. Use `npm run test:member:whitelist`.

The test checks the exact V0104 owner-source SHA-256, the 31 owner JSON
schemas (required, optional, forbidden, additionalProperties, references,
negative, branch and conditional rules), 9 Interface declarations, 2
relations, 9 field-target rule bindings, and default-deny permission
evidence. The YAML owner source is stored as an immutable **read-only**
evidence snapshot, not a second business authority.

The 42 scope/286 field-occurrence counts are documented source projections,
not 286 independently certified per-entry authority-lock decisions. The
uploaded checklist itself says `closure_status: UNRESOLVED` and
`default_effect: NO_AUTHORIZATION`; those facts remain unchanged.
