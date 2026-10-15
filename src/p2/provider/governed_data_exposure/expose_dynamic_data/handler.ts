export type JsonObject=Readonly<Record<string,unknown>>;export interface P2OperationRequest{readonly input:JsonObject;readonly runtime_context:JsonObject;readonly trace_id:string;readonly request_id:string;}export interface P2OperationResponse{readonly outcome_type:"response";readonly runtime_result:JsonObject;readonly trace_id:string;readonly request_id:string;}export class P2StableError extends Error{readonly code:string;constructor(code:string,message:string){super(message);this.name="P2StableError";this.code=code;}}function objectValue(value:unknown,field:string):JsonObject{if(value===null||typeof value!=="object"||Array.isArray(value))throw new P2StableError("P2_INVALID_INPUT",`${field} must be an object`);return value as JsonObject;}function stringValue(value:unknown,field:string):string{if(typeof value!=="string"||!value)throw new P2StableError("P2_INVALID_INPUT",`${field} must be a non-empty string`);return value;}function sha256Value(value:unknown,field:string):string{const t=stringValue(value,field);if(!/^sha256:[0-9a-f]{64}$/.test(t))throw new P2StableError("P2_INTEGRITY_BINDING_INVALID",`${field} must be an exact sha256 binding`);return t;}function stableClone(value:unknown):unknown{if(Array.isArray(value))return Object.freeze(value.map(stableClone));if(value!==null&&typeof value==="object"){const s=value as Record<string,unknown>;const o:Record<string,unknown>={};for(const k of Object.keys(s).sort())o[k]=stableClone(s[k]);return Object.freeze(o);}return value;}function success(request:P2OperationRequest,runtime_result:JsonObject):P2OperationResponse{return Object.freeze({outcome_type:"response" as const,runtime_result:Object.freeze({...runtime_result}),trace_id:request.trace_id,request_id:request.request_id});}
export const STAGE_CONTRACT_REF="Q.SS.STD.P2.CONTRACT.CROSS_DOMAIN_REALIZATION@V0128" as const;export const ROLE="provider" as const;export const CAPABILITY_ID="governed_data_exposure" as const;export const OPERATION_ID="expose_dynamic_data" as const;const DATA_CATEGORY="DYNAMIC" as const;const REPRESENTATION_MODES=Object.freeze(["INLINE_FACT_SET","ARTIFACT_SNAPSHOT","ARTIFACT_CHUNKED_SNAPSHOT"] as const);
function validateExposureRequest(value:unknown):JsonObject{const r=objectValue(value,"authorized_exposure_request");stringValue(r.subject_ref,"authorized_exposure_request.subject_ref");const requested=stringValue(r.requested_representation,"authorized_exposure_request.requested_representation");if(!(REPRESENTATION_MODES as readonly string[]).includes(requested))throw new P2StableError("P2_GOVERNED_DATA_REPRESENTATION_INVALID","requested_representation is not CURRENT Governed Data Material representation");objectValue(r.selection_spec,"authorized_exposure_request.selection_spec");return r;}function validateMaterialEnvelope(value:unknown,request:JsonObject):JsonObject{const e=objectValue(value,"material_envelope");stringValue(e.material_ref,"material_envelope.material_ref");if(stringValue(e.subject_ref,"material_envelope.subject_ref")!==request.subject_ref)throw new P2StableError("P2_GOVERNED_DATA_BINDING_MISMATCH","material envelope subject_ref must match authorized exposure request");stringValue(e.owner_ref,"material_envelope.owner_ref");stringValue(e.source_ref,"material_envelope.source_ref");const mode=stringValue(e.representation_mode,"material_envelope.representation_mode");if(!(REPRESENTATION_MODES as readonly string[]).includes(mode)||mode!==request.requested_representation)throw new P2StableError("P2_GOVERNED_DATA_BINDING_MISMATCH","material envelope representation_mode must match authorized request");sha256Value(e.content_hash,"material_envelope.content_hash");stringValue(e.integrity_profile_ref,"material_envelope.integrity_profile_ref");return e;}

/**
 * P2 does not inspect P1 implementation. A trusted, already-bound source
 * Interface/Anchor reader supplies source-owned facts; P2 owns materialization.
 * The binding values must come from exact frozen source authority, not a
 * category inferred from a P1 PATH/STATIC_MOUNT/DYNAMIC_MOUNT field name.
 */
export interface GovernedDataExposureDependencies {
  read_authorized_anchor_facts(input: Readonly<{
    data_category: typeof DATA_CATEGORY;
    authorized_exposure_request: JsonObject;
    exact_source_authority: JsonObject;
    governed_access_binding: JsonObject;
    source_provenance: JsonObject;
    source_fact_authority: string;
    trace_id: string;
    request_id: string;
  }>): Promise<JsonObject>;

  materialize_governed_data(input: Readonly<{
    data_category: typeof DATA_CATEGORY;
    authorized_exposure_request: JsonObject;
    exact_source_authority: JsonObject;
    owning_persistence_contract: JsonObject;
    integrity_profile: JsonObject;
    artifact_store_binding: JsonObject;
    authorized_anchor_facts: JsonObject;
  }>): Promise<JsonObject>;
}

export async function handler(
  request: P2OperationRequest,
  dependencies: GovernedDataExposureDependencies,
): Promise<P2OperationResponse> {
  
  const source_domain_identity = stringValue(request.input.source_domain_identity, "source_domain_identity");
  const subject_identity = stringValue(request.input.subject_identity, "subject_identity");
  const source_provenance = objectValue(request.input.source_provenance, "source_provenance");
  const source_fact_authority = stringValue(request.input.source_fact_authority, "source_fact_authority");
  const governed_access_binding = objectValue(request.input.governed_access_binding, "governed_access_binding");
  const integrity_binding = objectValue(request.input.integrity_binding, "integrity_binding");
  const authorized_exposure_request = validateExposureRequest(request.input.authorized_exposure_request);
  const exact_source_authority = objectValue(request.input.exact_source_authority, "exact_source_authority");
  const owning_persistence_contract = objectValue(request.input.owning_persistence_contract, "owning_persistence_contract");
  const integrity_profile = objectValue(request.input.integrity_profile, "integrity_profile");
  const artifact_store_binding = objectValue(request.input.artifact_store_binding, "artifact_store_binding");

  // All fields are in the exact V0117 declared governed-data source binding.
  const binding_ref = stringValue(exact_source_authority.binding_ref, "exact_source_authority.binding_ref");
  const category = stringValue(exact_source_authority.data_category, "exact_source_authority.data_category");
  const source_operation_ref = stringValue(exact_source_authority.source_operation_ref, "exact_source_authority.source_operation_ref");
  const source_interface_ref = stringValue(exact_source_authority.source_interface_ref, "exact_source_authority.source_interface_ref");
  const source_access_kind = stringValue(exact_source_authority.source_access_kind, "exact_source_authority.source_access_kind");
  const source_access_ref = stringValue(exact_source_authority.source_access_ref, "exact_source_authority.source_access_ref");
  if (
    category !== DATA_CATEGORY
    || !(["DECLARED_Q_INTERFACE_SOURCE_FACT","AUTHORIZED_GOVERNED_STATE_OR_REGISTRY_FACT"] as readonly string[]).includes(source_access_kind)
  ) {
    throw new P2StableError("P2_GOVERNED_DATA_BINDING_MISMATCH", "Exact governed-data category and declared P1 source kind must match");
  }
  if (
    typeof dependencies.read_authorized_anchor_facts !== "function"
    || typeof dependencies.materialize_governed_data !== "function"
  ) {
    throw new P2StableError("P2_GOVERNED_DATA_BINDING_MISMATCH", "Trusted Anchor reader and P2 materializer must be bound");
  }

  // The reader is bound by the authorized source owner to existing P1
  // Registry/Q Interface/produced runtime facts, not to a new P1 expose API.
  const authorized_anchor_facts = objectValue(
    await dependencies.read_authorized_anchor_facts(Object.freeze({
      data_category: DATA_CATEGORY,
      authorized_exposure_request,
      exact_source_authority,
      governed_access_binding,
      source_provenance,
      source_fact_authority,
      trace_id: request.trace_id,
      request_id: request.request_id,
    })),
    "authorized_anchor_facts",
  );
  const exact_match: Readonly<Record<string, string>> = Object.freeze({
    data_category: DATA_CATEGORY,
    binding_ref,
    source_operation_ref,
    source_interface_ref,
    source_access_ref,
    source_fact_ref: stringValue(source_provenance.source_ref, "source_provenance.source_ref"),
    source_fact_authority_ref: source_fact_authority,
  });
  for (const [field, expected] of Object.entries(exact_match)) {
    if (authorized_anchor_facts[field] !== expected) {
      throw new P2StableError("P2_GOVERNED_DATA_BINDING_MISMATCH", `Anchor facts must preserve exact ${field}`);
    }
  }
  if (!Object.hasOwn(authorized_anchor_facts, "facts") || authorized_anchor_facts.facts === undefined) {
    throw new P2StableError("P2_GOVERNED_DATA_BINDING_MISMATCH", "Authorized Anchor fact payload is missing");
  }

  const material_envelope = validateMaterialEnvelope(
    await dependencies.materialize_governed_data(Object.freeze({
      data_category: DATA_CATEGORY,
      authorized_exposure_request,
      exact_source_authority,
      owning_persistence_contract,
      integrity_profile,
      artifact_store_binding,
      authorized_anchor_facts: stableClone(authorized_anchor_facts) as JsonObject,
    })),
    authorized_exposure_request,
  );
  return success(request, {
    result_kind: "GOVERNED_DATA_EXPOSURE",
    data_category: DATA_CATEGORY,
    source_domain_identity,
    subject_identity,
    source_provenance: stableClone(source_provenance),
    source_fact_authority,
    governed_access_binding: stableClone(governed_access_binding),
    integrity_binding: stableClone(integrity_binding),
    material_envelope: stableClone(material_envelope),
  });
}
