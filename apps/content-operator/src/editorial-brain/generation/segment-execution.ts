/**
 * Progressive contribution consumption model for Generator (1 LLM call, structured segments).
 * Atomic contribution identity — not string-fuzzy “same idea”.
 */

import type { BrainGenerationInputContract } from "./generation-input-contract.js";
import type { InformationalContribution } from "./informational-contribution.js";

export type SegmentExecutionSlot = {
  role: "lead" | "development" | "title" | "summary";
  segmentKey: string;
  paragraphIndex: number | null;
  requiredContributionIds: string[];
  forbiddenContributionIds: string[];
  allowedContributionIds: string[];
  requiredFacets: string[];
  forbiddenFacets: string[];
  instruction: string;
};

export type SegmentExecutionContract = {
  progressive: true;
  authority: "SEGMENT_CONTRACTS";
  rule: string;
  slots: SegmentExecutionSlot[];
  consumedAfterLeadIds: string[];
};

function ids(cs: InformationalContribution[]): string[] {
  return cs.map((c) => c.id);
}

function facets(cs: InformationalContribution[]): string[] {
  return cs.map((c) => c.facet);
}

/**
 * Build progressive consumption slots from BrainGenerationInputContract.
 * Lead consumes its required ids; body slots forbid those ids and require development contributions.
 */
export function buildSegmentExecutionContract(
  contract: BrainGenerationInputContract,
): SegmentExecutionContract {
  const lead = contract.segmentContracts.lead;
  const development = contract.segmentContracts.development;
  const leadRequired = lead.requiredContributions;
  const bodyRequired = development.requiredContributions;
  const bodyForbidden = development.forbiddenConsumedContributions;
  const reservedForLater = lead.reservedForLaterContributions ?? bodyRequired;
  const consumedAfterLeadIds = ids(leadRequired.length ? leadRequired : bodyForbidden);

  const slots: SegmentExecutionSlot[] = [
    {
      role: "lead",
      segmentKey: "lead",
      paragraphIndex: null,
      requiredContributionIds: ids(leadRequired),
      forbiddenContributionIds: ids([
        ...lead.forbiddenConsumedContributions,
        ...reservedForLater,
      ]),
      allowedContributionIds: ids(lead.allowedContributions),
      requiredFacets: facets(leadRequired),
      forbiddenFacets: facets([...lead.forbiddenConsumedContributions, ...reservedForLater]),
      instruction:
        "Open with required lead contributions only. RESERVED_FOR_LATER facets are forbidden in lead — do not preview body contributions.",
    },
  ];

  if (bodyRequired.length === 0) {
    slots.push({
      role: "development",
      segmentKey: "section:0",
      paragraphIndex: 0,
      requiredContributionIds: [],
      forbiddenContributionIds: [...consumedAfterLeadIds, ...ids(bodyForbidden)],
      allowedContributionIds: ids(development.allowedContributions),
      requiredFacets: [],
      forbiddenFacets: [...facets(leadRequired), ...facets(bodyForbidden)],
      instruction:
        "No new body substance required — keep a single short non-evaluative line; never restate lead facets.",
    });
  } else {
    bodyRequired.forEach((c, i) => {
      const priorBody = bodyRequired.slice(0, i);
      const forbidden = [
        ...consumedAfterLeadIds,
        ...ids(bodyForbidden),
        ...ids(priorBody),
      ];
      slots.push({
        role: "development",
        segmentKey: `section:${i}`,
        paragraphIndex: i,
        requiredContributionIds: [c.id],
        forbiddenContributionIds: [...new Set(forbidden)],
        allowedContributionIds: ids(development.allowedContributions).filter(
          (id) => !forbidden.includes(id) || id === c.id,
        ),
        requiredFacets: [c.facet],
        forbiddenFacets: [
          ...facets(leadRequired),
          ...facets(bodyForbidden),
          ...facets(priorBody),
        ],
        instruction: `Paragraph must introduce contribution ${c.id} (${c.facet}). Forbidden: already-consumed lead/prior body facets.`,
      });
    });
  }

  return {
    progressive: true,
    authority: "SEGMENT_CONTRACTS",
    rule: "Consume contributions in slot order. Once used in an earlier slot, that contribution id is forbidden in later slots (including paraphrases of the same facet).",
    slots,
    consumedAfterLeadIds,
  };
}
