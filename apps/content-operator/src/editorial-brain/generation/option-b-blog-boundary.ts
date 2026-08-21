/**
 * OPTION B BLOG generation boundary — authority inventory + post-LLM policy.
 *
 * OPTION B SSOT: FACTUAL > EVIDENCE_PACK > WRITING_SKELETON > CHANNEL > MINIMAL_STYLE
 * Article shape: natural FANZA product intro (short, readable) — not a complex editorial engine.
 * Legacy SEGMENT_CONTRACTS / reservation / safeRedact are NOT authoritative here.
 *
 * Classification of legacy post-generation controls (BLOG OPTION B path):
 *
 * | Control                         | Class | Notes |
 * |---------------------------------|-------|-------|
 * | schema / required fields        | A     | KEEP hard |
 * | EvidencePack外事実 / claims     | A     | KEEP hard |
 * | URL / policy / safety           | A     | KEEP hard |
 * | grammatical integrity           | A     | KEEP hard (no rewrite) |
 * | near-copy                       | A/B   | KEEP hard |
 * | provenance shape                | B     | KEEP hard |
 * | WritingSkeleton progression     | B→Brain | OBSERVE |
 * | repetition / catalog / generic  | B→Brain | OBSERVE |
 * | SEGMENT_CONTRACTS               | C     | non-authoritative metadata |
 * | RESERVED_FOR_LATER              | C/D   | not authoritative; must not mutate |
 * | FORBIDDEN_CONSUMED              | C     | Brain/structural observe |
 * | contribution reservation        | C     | legacy only |
 * | safeRedactReservedLead          | D     | FORBIDDEN mutation on OPTION B |
 * | safeRedactLeadConsumedFromBody  | D     | FORBIDDEN mutation on OPTION B |
 * | stripEvaluative rewrite/drop    | D     | no prose mutation on OPTION B |
 * | claimUsagePlan role allocation  | C     | advisory; not post-LLM mutator |
 * | segmentExecution legacy RAW     | C     | skip as blocking on OPTION B |
 * | X path SEGMENT controls         | E     | unchanged |
 */

export type OptionBControlClass =
  | "A_HARD_FACTUAL_SAFETY"
  | "B_VALIDATOR_OR_BRAIN"
  | "C_OPTION_B_UNNEEDED"
  | "D_OPTION_B_DANGEROUS_MUTATION"
  | "E_LEGACY_OR_X_ONLY";

export const OPTION_B_LEGACY_CONTROL_INVENTORY: Array<{
  control: string;
  classification: OptionBControlClass;
}> = [
  { control: "SEGMENT_CONTRACTS", classification: "C_OPTION_B_UNNEEDED" },
  { control: "RESERVED_FOR_LATER", classification: "D_OPTION_B_DANGEROUS_MUTATION" },
  { control: "FORBIDDEN_CONSUMED", classification: "C_OPTION_B_UNNEEDED" },
  { control: "contribution_reservation", classification: "C_OPTION_B_UNNEEDED" },
  { control: "safeRedactReservedLead", classification: "D_OPTION_B_DANGEROUS_MUTATION" },
  { control: "safeRedactLeadConsumedFromBody", classification: "D_OPTION_B_DANGEROUS_MUTATION" },
  { control: "lead_redaction_mutation", classification: "D_OPTION_B_DANGEROUS_MUTATION" },
  { control: "segmentExecution_legacy_RAW_blocking", classification: "C_OPTION_B_UNNEEDED" },
  { control: "claimUsagePlan_role_allocation", classification: "C_OPTION_B_UNNEEDED" },
  { control: "stripUnsupportedEvaluativePadding_mutation", classification: "D_OPTION_B_DANGEROUS_MUTATION" },
  { control: "schema_provenance_url_policy_grammar", classification: "A_HARD_FACTUAL_SAFETY" },
  { control: "generic_prose_catalog_observe", classification: "B_VALIDATOR_OR_BRAIN" },
  { control: "X_SEGMENT_controls", classification: "E_LEGACY_OR_X_ONLY" },
];

export function isOptionBGenerationMode(
  contract: Record<string, unknown> | null | undefined,
): boolean {
  if (!contract) return false;
  if (contract.mode === "OPTION_B") return true;
  const layers =
    typeof contract.layers === "object" && contract.layers
      ? (contract.layers as Record<string, unknown>)
      : {};
  return Boolean(contract.writingSkeleton || layers.WRITING_SKELETON) &&
    Boolean(contract.evidencePack || layers.EVIDENCE_PACK);
}

/** OPTION B: never mutate generated prose with reservation / strip rewriters. */
export function optionBAllowsPostLlmProseMutation(): false {
  return false;
}
