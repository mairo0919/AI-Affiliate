/**
 * Build segmentExecution rows connecting Evidence → segment → transformation operation.
 */

import type { ReferenceEvidenceMappingPlan } from "./reference-evidence-mapping.js";
import type { ReferenceEditorialBlueprint } from "./reference-editorial-blueprint.js";
import type {
  ReferenceEditorialTransformationBlueprint,
  SegmentTransformationOp,
} from "./reference-editorial-transformation.js";

export type SegmentExecutionRow = {
  segmentIndex: number;
  role: string;
  requiredContributions: string[];
  allowedContributions: string[];
  reservedForLater: string[];
  forbiddenConsumed: string[];
  referenceParagraphFunction: string | null;
  transformationOperation: {
    factLexicalization: string;
    clausePackaging: string;
    paragraphProgression: string;
    transitionStrategy: string;
    cutOffRule: string;
    catalogAvoidance: string[];
  } | null;
  primaryEvidence: string[];
  supportingEvidence: string[];
  cutOffRule: string;
};

function opFor(
  transform: ReferenceEditorialTransformationBlueprint | null,
  segmentIndex: number,
  role: string,
): SegmentTransformationOp | null {
  if (!transform) return null;
  return (
    transform.segmentOps.find((s) => s.segmentIndex === segmentIndex) ??
    transform.segmentOps.find((s) => s.role === role) ??
    null
  );
}

export function buildReferenceSegmentExecution(input: {
  blueprint: ReferenceEditorialBlueprint;
  mappingPlan: ReferenceEvidenceMappingPlan;
  transform: ReferenceEditorialTransformationBlueprint | null;
}): SegmentExecutionRow[] {
  const mapped = input.mappingPlan.mappings.filter((m) => m.status === "mapped");
  const leadFacts = mapped.filter((m) => m.role === "lead").flatMap((m) => m.assignedFacts);
  const bodyFacts = mapped.filter((m) => m.role === "development").flatMap((m) => m.assignedFacts);

  return mapped.map((m) => {
    const seg = input.blueprint.segments.find((s) => s.index === m.segmentIndex);
    const op = opFor(input.transform, m.segmentIndex, m.role);
    const primary = m.assignedFacts.slice(0, 1);
    const supporting = m.assignedFacts.slice(1);
    const reserved =
      m.role === "lead"
        ? bodyFacts
        : m.role === "development"
          ? leadFacts
          : [];
    const forbidden =
      m.role === "development"
        ? leadFacts
        : m.role === "lead"
          ? bodyFacts
          : [];

    return {
      segmentIndex: m.segmentIndex,
      role: m.role,
      requiredContributions: primary,
      allowedContributions: m.assignedFacts,
      reservedForLater: reserved,
      forbiddenConsumed: forbidden,
      referenceParagraphFunction: seg?.editorialFunction ?? m.editorialFunction ?? null,
      transformationOperation: op
        ? {
            factLexicalization: op.factLexicalization,
            clausePackaging: op.clausePackaging,
            paragraphProgression: op.paragraphProgression,
            transitionStrategy: op.transitionStrategy,
            cutOffRule: op.cutOffRule,
            catalogAvoidance: op.catalogAvoidance,
          }
        : null,
      primaryEvidence: primary,
      supportingEvidence: supporting,
      cutOffRule: op?.cutOffRule ?? "never_pad_with_generic_closing",
    };
  });
}
