import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { assessMemberP1Handoff, inspectMemberP1Handoff } from '../../../../tools/member/inspect_p1_handoff.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const source = readFileSync(join(root, 'spec/p1/member/source_snapshot/Q.MEMBERSHIP.CONTRACT.CAPABILITY.MEMBER.V0104.yaml'));
const projection = readFileSync(join(root, 'spec/p1/member/capability_profile.qcon.yaml'), 'utf8');
const checklist = JSON.parse(readFileSync(join(root, 'tests/p1/member/fixtures/member_v0104_compact_whitelist.unresolved.json'), 'utf8'));

test('exact Member V0104 P1 handoff forbids triad materialization while NONE', () => {
  const r = inspectMemberP1Handoff(root);
  assert.equal(r.actual_source_hash, checklist.source_hash);
  assert.equal(r.governed_data_exposure_mode, 'NONE');
  assert.equal(r.binding_count, 0);
  assert.equal(r.reason_code, 'RDS_GOVERNED_DATA_NOT_DECLARED');
  assert.equal(r.ready_for_triad_materialization, false);
  assert.equal(r.drive_writes_attempted, false);
  assert.equal(r.database_writes_attempted, false);
});

test('forged DECLARED projection cannot override Owner Source', () => {
  const changed = projection.replace('    mode: NONE\n    bindings: []', '    mode: DECLARED\n    bindings: []');
  const r = assessMemberP1Handoff({sourceBytes: source, projection: changed, whitelist: checklist});
  assert.equal(r.reason_code, 'P1_SOURCE_PROJECTION_INCOMPLETE_OR_MISMATCH');
  assert.equal(r.ready_for_triad_materialization, false);
});

test('unregistered Owner Source modification fails exact hash check', () => {
  const changed = Buffer.from(source.toString('utf8').replace('    mode: NONE\n    bindings: []', '    mode: DECLARED\n    bindings: []'));
  const r = assessMemberP1Handoff({sourceBytes: changed, projection, whitelist: checklist});
  assert.equal(r.reason_code, 'SOURCE_IDENTITY_OR_HASH_MISMATCH');
  assert.equal(r.ready_for_triad_materialization, false);
});

test('unrecognized mode is not silently treated as authorized', () => {
  const changed = Buffer.from(source.toString('utf8').replace('    mode: NONE\n    bindings: []', '    mode: IMPLICIT\n    bindings: []'));
  const digest = 'sha256:' + createHash('sha256').update(changed).digest('hex');
  const r = assessMemberP1Handoff({sourceBytes: changed, projection: changed.toString('utf8'), whitelist: {...checklist, source_hash: digest}});
  assert.equal(r.reason_code, 'P1_SOURCE_PROJECTION_INCOMPLETE_OR_MISMATCH');
  assert.equal(r.ready_for_triad_materialization, false);
});
