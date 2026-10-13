/**
 * Directly runnable P1CM V0117 source-bound smoke checks.
 * These checks DO NOT issue a production whitelist or Q.Gate verdict.
 * Run: node --experimental-transform-types --test tests/p1/export/member/v0117_boundary.node.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stableError, trustedEntryAuthorizer, preserveExactProviderStableError } from '../../../../src/p1/export/member/contracts.ts';

test('V0117: caller-attested actor identity and wildcard are never default authorization', () => {
  const authorized = trustedEntryAuthorizer.authorize({
    operation_id: 'create_member',
    request: {},
    context: {
      request_id: 'test-request',
      trace_id: 'test-trace',
      authorization: {
        actor_ref: 'self-attested-actor',
        issued_by: 'self-attested-issuer',
        allowed_operations: ['*'],
      },
    },
  });
  assert.equal(authorized, false);
});

test('V0117: stable error must belong to the exact Operation', () => {
  assert.equal(stableError('create_member', 'MEMBER_DUPLICATE_REGISTRATION').code,
    'MEMBER_DUPLICATE_REGISTRATION');
  assert.throws(
    () => stableError('create_member', 'MEMBERSHIP_NOT_FOUND' as never),
    /Undeclared stable error for exact Operation create_member/,
  );
});

test('V0117: unadmitted Provider errors may not widen Member StableError carrier', () => {
  assert.throws(
    () => preserveExactProviderStableError('create_membership', {
      code: 'UNDECLARED_PROVIDER_ERROR',
      message: 'opaque',
    }),
    /outside exact Member Operation create_membership/,
  );
  assert.equal(
    preserveExactProviderStableError('create_membership', {
      code: 'MEMBERSHIP_PLAN_NOT_FOUND',
      message: 'exact declared code',
    }).code,
    'MEMBERSHIP_PLAN_NOT_FOUND',
  );
});

test('V0117: candidate external interface projection excludes internal resolution', () => {
  const text = readFileSync(
    new URL('../../../../spec/p1/member/capability_interfaces.json', import.meta.url),
    'utf8',
  );
  const source = JSON.parse(text) as {
    interface_inventory: {
      specification_interface_refs: string[];
      internal_interface_refs: string[];
      payload_contract_refs: string[];
    };
    external_provider_surface: { mode: string; provider_interface_refs: string[] };
  };
  const inventory = source.interface_inventory;
  const published = source.external_provider_surface.provider_interface_refs;
  assert.equal(inventory.specification_interface_refs.length, 8);
  assert.equal(inventory.internal_interface_refs.length, 1);
  assert.equal(inventory.payload_contract_refs.length, 27);
  assert.equal(source.external_provider_surface.mode, 'PUBLICATION_ELIGIBLE');
  assert.deepEqual(published, inventory.specification_interface_refs);
  assert.equal(new Set(published).size, 8);
  for (const internalRef of inventory.internal_interface_refs) {
    assert.equal(published.includes(internalRef), false);
  }
});

test('V0117: candidate spec projects structured owner rule/permission/relation sections', () => {
  const policy = readFileSync(
    new URL('../../../../spec/p1/member/capability_policy.qconfig', import.meta.url), 'utf8',
  );
  const profile = readFileSync(
    new URL('../../../../spec/p1/member/capability_profile.qcon.yaml', import.meta.url), 'utf8',
  );
  for (const key of ['permission_model', 'capability_rules', 'rule_bindings', 'operational_relations']) {
    assert.match(policy, new RegExp('^' + key + ':', 'm'));
  }
  for (const key of ['state_model', 'dependencies', 'p2_handoff', 'interface_inventory']) {
    assert.match(profile, new RegExp('^' + key + ':', 'm'));
  }
  assert.doesNotMatch(policy, /^rules:/m);
  assert.doesNotMatch(profile, /^state_machines:/m);
});
