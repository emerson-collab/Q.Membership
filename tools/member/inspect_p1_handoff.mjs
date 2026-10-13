/**
 * Member V0104 P1 handoff preflight: read-only and fail-closed.
 * Does not create P2 bindings, expose data, call Google Drive or claim Q.Gate approval.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SOURCE = 'spec/p1/member/source_snapshot/Q.MEMBERSHIP.CONTRACT.CAPABILITY.MEMBER.V0104.yaml';
const PROJECTION = 'spec/p1/member/capability_profile.qcon.yaml';
const CHECKLIST = 'tests/p1/member/fixtures/member_v0104_compact_whitelist.unresolved.json';

function topLevelSection(text, name) {
  const lines = text.split(/\r?\n/);
  const matches = lines.flatMap((line, i) => line === name + ':' ? [i] : []);
  if (matches.length !== 1) return null;
  let end = matches[0] + 1;
  while (end < lines.length && !/^[a-zA-Z_]\w*:/.test(lines[end])) end++;
  return lines.slice(matches[0], end);
}

function exposureSection(document) {
  const section = topLevelSection(document, 'p2_handoff');
  if (!section) return { valid: false, why: 'MISSING_OR_AMBIGUOUS_P1_HANDOFF' };
  const indices = section.flatMap((line, i) => line === '  governed_data_exposure:' ? [i] : []);
  if (indices.length !== 1) return { valid: false, why: 'MISSING_OR_AMBIGUOUS_EXPOSURE_DECLARATION' };
  const start = indices[0];
  let end = start + 1;
  while (end < section.length && (section[end].trim() === '' || /^ {4}/.test(section[end]))) end++;
  const lines = section.slice(start, end).filter(line => line.trim() !== '');
  const modes = lines.filter(line => /^ {4}mode:/.test(line));
  const bindings = lines.filter(line => /^ {4}bindings:/.test(line));
  if (modes.length !== 1 || bindings.length !== 1) {
    return { valid: false, why: 'MODE_OR_BINDINGS_FIELD_NOT_EXACT' };
  }
  const mode = modes[0].slice('    mode:'.length).trim();
  const literal = bindings[0].slice('    bindings:'.length).trim();
  if (mode !== 'NONE' && mode !== 'DECLARED') return { valid: false, why: 'UNRECOGNIZED_SOURCE_MODE' };
  if (mode === 'NONE' && literal !== '[]') return { valid: false, why: 'NONE_MUST_HAVE_EMPTY_BINDINGS' };
  if (mode === 'DECLARED' && literal === '[]') return { valid: false, why: 'DECLARED_REQUIRES_NONEMPTY_BINDINGS' };
  return { valid: true, mode, block: lines.join('\n') };
}

/**
 * Only verifies exact Owner P1 declaration consistency and eligibility.
 * Even DECLARED is NOT an approval: individual Owner fact lineage and
 * frozen authority must be verified separately before P2 execution.
 */
export function assessMemberP1Handoff({ sourceBytes, projection, whitelist }) {
  const source = Buffer.isBuffer(sourceBytes) ? sourceBytes.toString('utf8') : String(sourceBytes);
  const digest = 'sha256:' + createHash('sha256').update(sourceBytes).digest('hex');
  const report = {
    capability_contract_ref: 'Q.MEMBERSHIP.CONTRACT.CAPABILITY.MEMBER@V0104',
    actual_source_hash: digest,
    expected_source_hash: whitelist.source_hash,
    check_scope: 'P1_EXACT_OWNER_GOVERNED_DATA_HANDOFF_ONLY',
    requested_triad_categories: ['STATIC', 'DYNAMIC', 'RUNTIME'],
    ready_for_triad_materialization: false,
    status: 'BLOCKED',
    drive_writes_attempted: false,
    database_writes_attempted: false
  };
  if (whitelist.artifact_ref !== report.capability_contract_ref || digest !== whitelist.source_hash) {
    return { ...report, reason_code: 'SOURCE_IDENTITY_OR_HASH_MISMATCH' };
  }
  const exactHeader = "q_header: '1'\nq_id: Q.MEMBERSHIP.CONTRACT.CAPABILITY.MEMBER\nq_version: V0104\n";
  if (!source.startsWith(exactHeader)) return { ...report, reason_code: 'OWNER_SOURCE_IDENTITY_INVALID' };
  const sourceExposure = exposureSection(source);
  const projectedExposure = exposureSection(projection);
  if (!sourceExposure.valid || !projectedExposure.valid || sourceExposure.block !== projectedExposure.block) {
    return { ...report, reason_code: 'P1_SOURCE_PROJECTION_INCOMPLETE_OR_MISMATCH',
      source_parse_reason: sourceExposure.why ?? null,
      projection_parse_reason: projectedExposure.why ?? null };
  }
  if (sourceExposure.mode === 'NONE') {
    return { ...report, governed_data_exposure_mode: 'NONE', binding_count: 0,
      reason_code: 'RDS_GOVERNED_DATA_NOT_DECLARED',
      next_owner_action: 'Supply an exact approved Member Owner Source revision with authorized source bindings. Do not infer source_access_ref or source_fact_authority_ref.' };
  }
  return { ...report, governed_data_exposure_mode: 'DECLARED',
    reason_code: 'DECLARED_BINDINGS_REQUIRE_EXACT_SOURCE_AND_AUTHORITY_VERIFICATION',
    next_owner_action: 'Verify exact Operation/Interface/source access/member lineage with frozen Owner authority before executing P2.' };
}

export function inspectMemberP1Handoff(root = ROOT) {
  return assessMemberP1Handoff({
    sourceBytes: readFileSync(join(root, SOURCE)),
    projection: readFileSync(join(root, PROJECTION), 'utf8'),
    whitelist: JSON.parse(readFileSync(join(root, CHECKLIST), 'utf8'))
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = inspectMemberP1Handoff();
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (process.argv.includes('--require-ready') && !result.ready_for_triad_materialization) {
      process.exitCode = 2;
    }
  } catch (error) {
    process.stderr.write('MEMBER_P1_HANDOFF_INSPECTION_FAILED: ' + String(error) + '\n');
    process.exitCode = 2;
  }
}
