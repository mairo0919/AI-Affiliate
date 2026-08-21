import { z } from "zod";
import { FRESHNESS_DISCLAIMER } from "./freshness-disclaimer.js";

/**
 * Absence normalization for string arrays: null/undefined → [].
 * Does not coerce strings/objects — those remain validation failures.
 */
const stringArrayAbsentAsEmpty = z.preprocess(
  (value) => (value === null || value === undefined ? [] : value),
  z.array(z.string()),
);

/**
 * Section heading: non-empty string OR null.
 * Empty string "" / whitespace-only → null at the boundary (never persisted as "").
 * LLM structured-output may still list the field as required nullable.
 */
const sectionHeadingSchema = z.preprocess((value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  return value;
}, z.string().min(1).nullable());

export const bloggerArticleSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  lead: z.string().min(1),
  sections: z
    .array(
      z.object({
        heading: sectionHeadingSchema,
        paragraphs: z.array(z.string()).default([]),
        // Present lists → string[]; absent/null → [] (not optional null).
        lists: stringArrayAbsentAsEmpty,
      }),
    )
    .min(1),
  cta: z.object({
    label: z.string(),
    url: z.string().nullable(),
  }),
  sourceReferences: z.array(z.string()).default([]),
  seoTitle: z.string().min(1),
  metaDescription: z.string().min(1),
  labels: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
  usedClaimIds: z.array(z.string()).default([]),
  usedProductLinkIds: z.array(z.string()).default([]),
  articleFormat: z.string().optional(),
});

export type BloggerArticleStructured = z.infer<typeof bloggerArticleSchema>;

/**
 * Formal Structure Pattern → StructuredArticle destinations (code SSOT).
 *
 * - hook → lead (NOT sections[i]; naive block-index ↔ section-index mapping is forbidden)
 * - interest_development / editorial_angle / scene_or_feature_development / cue_list /
 *   cta_bridge / … → sections[] (in narrative order)
 * - article.cta ({label,url}) is the CTA *widget*, not a narrative-block destination.
 *   cta_bridge is bridge *prose* and still targets a section (unless omitted via
 *   allowOmitIfClaimsScarce).
 */
export type StructureBlockArticleTarget = "lead" | "section";

export function structureBlockArticleTarget(role: string): StructureBlockArticleTarget {
  if (role === "hook") return "lead";
  return "section";
}

/** Minimal structure-pattern shape needed for mapping + heading contract checks. */
export type StructurePatternHeadingContract = {
  blocks: Array<{
    role: string;
    heading: boolean;
    allowOmitIfClaimsScarce?: boolean;
    usesList?: boolean;
  }>;
};

export type StructurePatternValidationFinding = {
  code: "HEADING_REQUIRED" | "STRUCTURE_PATTERN_MAPPING_ERROR";
  message: string;
  path: string;
};

/** @deprecated Use StructurePatternValidationFinding */
export type SectionHeadingValidationFinding = StructurePatternValidationFinding;

export type StructureSectionBlockAlignment = {
  sectionIndex: number;
  blockIndex: number;
  role: string;
  heading: boolean;
  usesList: boolean;
};

function sectionLooksLikeListCue(section: {
  paragraphs: string[];
  lists: string[];
}): boolean {
  return section.lists.length > 0;
}

/**
 * Align article.sections to section-targeted Structure Pattern blocks.
 * Optional blocks (allowOmitIfClaimsScarce) may be skipped without shifting later roles
 * when the next section does not look like that optional block (e.g. cue_list without lists).
 * Extra sections or missing required blocks → STRUCTURE_PATTERN_MAPPING_ERROR
 * (never legacy "heading required").
 */
export function alignSectionsToStructureBlocks(
  article: Pick<BloggerArticleStructured, "sections">,
  structurePattern: StructurePatternHeadingContract,
): {
  ok: boolean;
  pairs: StructureSectionBlockAlignment[];
  findings: StructurePatternValidationFinding[];
} {
  const findings: StructurePatternValidationFinding[] = [];
  const sectionBlocks = structurePattern.blocks
    .map((block, blockIndex) => ({ block, blockIndex }))
    .filter(({ block }) => structureBlockArticleTarget(block.role) === "section");

  const pairs: StructureSectionBlockAlignment[] = [];
  let bi = 0;

  for (let si = 0; si < article.sections.length; si++) {
    const section = article.sections[si]!;

    while (bi < sectionBlocks.length) {
      const candidate = sectionBlocks[bi]!;
      const optional = candidate.block.allowOmitIfClaimsScarce === true;
      const listBlock = candidate.block.usesList === true;
      // Skip optional list cue when this section has no list (omitted cue_list).
      if (optional && listBlock && !sectionLooksLikeListCue(section)) {
        bi += 1;
        continue;
      }
      break;
    }

    if (bi >= sectionBlocks.length) {
      findings.push({
        code: "STRUCTURE_PATTERN_MAPPING_ERROR",
        path: `sections[${si}]`,
        message: `STRUCTURE_PATTERN_MAPPING_ERROR: sections[${si}] has no matching Structure Pattern block (hook→lead; do not emit one section per narrative block including hook)`,
      });
      continue;
    }

    const matched = sectionBlocks[bi]!;
    pairs.push({
      sectionIndex: si,
      blockIndex: matched.blockIndex,
      role: matched.block.role,
      heading: matched.block.heading,
      usesList: matched.block.usesList === true,
    });
    bi += 1;
  }

  while (bi < sectionBlocks.length) {
    const remaining = sectionBlocks[bi]!;
    if (remaining.block.allowOmitIfClaimsScarce !== true) {
      findings.push({
        code: "STRUCTURE_PATTERN_MAPPING_ERROR",
        path: "sections",
        message: `STRUCTURE_PATTERN_MAPPING_ERROR: missing required Structure Pattern section-block role=${remaining.block.role}`,
      });
    }
    bi += 1;
  }

  return { ok: findings.length === 0, pairs, findings };
}

/**
 * Structure Pattern is the only heading authority.
 * - No pattern: heading string|null per schema (legacy "all headings required" deleted; OPTION B natural_product_intro).
 * - With pattern: Article Output Contract cardinality first (maxArticleSections),
 *   then role alignment (hook→lead; others→sections).
 *   heading=true → non-empty; heading=false → null OK.
 * - Excess sections → STRUCTURE_PATTERN_MAPPING_ERROR (never legacy heading-required).
 */
export function validateSectionHeadingsAgainstStructurePattern(
  article: BloggerArticleStructured,
  structurePattern?: StructurePatternHeadingContract | null,
): { ok: boolean; findings: StructurePatternValidationFinding[] } {
  const findings: StructurePatternValidationFinding[] = [];

  if (!structurePattern?.blocks?.length) {
    // Schema already allows heading:null. Do not re-impose a legacy all-headings-required gate.
    return { ok: true, findings: [] };
  }

  const sectionBlocks = structurePattern.blocks.filter(
    (b) => structureBlockArticleTarget(b.role) === "section",
  );
  const maxArticleSections = sectionBlocks.length;
  const minArticleSections = Math.max(
    1,
    sectionBlocks.filter((b) => b.allowOmitIfClaimsScarce !== true).length,
  );
  const sectionRoles = sectionBlocks.map((b) => b.role).join(",");

  if (article.sections.length > maxArticleSections) {
    findings.push({
      code: "STRUCTURE_PATTERN_MAPPING_ERROR",
      path: `sections[${maxArticleSections}]`,
      message: `STRUCTURE_PATTERN_MAPPING_ERROR: article.sections.length=${article.sections.length} exceeds expectedMaxSections=${maxArticleSections} (sectionRoles=${sectionRoles}; hook→lead — do not emit one section per narrative block)`,
    });
  } else if (article.sections.length < minArticleSections) {
    findings.push({
      code: "STRUCTURE_PATTERN_MAPPING_ERROR",
      path: "sections",
      message: `STRUCTURE_PATTERN_MAPPING_ERROR: article.sections.length=${article.sections.length} below expectedMinSections=${minArticleSections}`,
    });
  }

  const alignment = alignSectionsToStructureBlocks(article, structurePattern);
  for (const f of alignment.findings) {
    if (article.sections.length > maxArticleSections && f.path.startsWith("sections[")) {
      continue;
    }
    findings.push(f);
  }

  for (const pair of alignment.pairs) {
    if (pair.sectionIndex >= maxArticleSections) continue;
    const heading = article.sections[pair.sectionIndex]?.heading;
    if (pair.heading === true && (!heading || !heading.trim())) {
      findings.push({
        code: "HEADING_REQUIRED",
        path: `sections[${pair.sectionIndex}].heading`,
        message: `sections[${pair.sectionIndex}].heading required for Structure Pattern block role=${pair.role} (heading=true)`,
      });
    }
  }

  return { ok: findings.length === 0, findings };
}

export function assertSectionHeadingsAgainstStructurePattern(
  article: BloggerArticleStructured,
  structurePattern?: StructurePatternHeadingContract | null,
): void {
  const result = validateSectionHeadingsAgainstStructurePattern(article, structurePattern);
  if (!result.ok) {
    throw new z.ZodError(
      result.findings.map((f) => {
        const headingIdx = /^sections\[(\d+)\]\.heading$/.exec(f.path);
        const sectionIdx = /^sections\[(\d+)\]$/.exec(f.path);
        if (headingIdx) {
          return {
            code: "custom" as const,
            path: ["sections", Number(headingIdx[1]), "heading"],
            message: f.message,
          };
        }
        if (sectionIdx) {
          return {
            code: "custom" as const,
            path: ["sections", Number(sectionIdx[1])],
            message: f.message,
          };
        }
        return {
          code: "custom" as const,
          path: ["sections"],
          message: f.message,
        };
      }),
    );
  }
}

export const xPostSchema = z.object({
  body: z.string().min(1),
  reply: z.string().nullable().optional(),
  usedClaimIds: z.array(z.string()).default([]),
  ctaUrl: z.string().nullable().optional(),
});

export type XPostStructured = z.infer<typeof xPostSchema>;

export const reviewOutputSchema = z.object({
  result: z.enum(["passed", "warning", "failed", "manual_review_required"]),
  score: z.number().optional(),
  findings: z
    .array(
      z.object({
        code: z.string(),
        message: z.string(),
        severity: z.string().optional(),
      }),
    )
    .default([]),
  requiredActions: z.array(z.string()).default([]),
  revisionRecommendation: z
    .enum([
      "no_change",
      "partial_revision",
      "full_regeneration",
      "additional_research_required",
      "strategy_change_required",
      "abandon",
    ])
    .optional(),
});

/** Required top-level keys for LLM contract (Zod required + defaults we still demand present). */
export const BLOGGER_ARTICLE_REQUIRED_KEYS = [
  "title",
  "summary",
  "lead",
  "sections",
  "cta",
  "seoTitle",
  "metaDescription",
  "sourceReferences",
  "labels",
  "warnings",
  "usedClaimIds",
  "usedProductLinkIds",
] as const;

/**
 * OPTION B LLM required keys only (r29 DELETE-FIRST).
 * summary/seo/labels/etc. are filled post-LLM for DB/Brain compat — not Generator-required.
 */
export const OPTION_B_LLM_REQUIRED_KEYS = ["title", "lead", "sections", "cta"] as const;

/** Fill persistence/Brain fields when OPTION B LLM omits them. */
export function fillOptionBArticleDefaults(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  const lead = typeof raw.lead === "string" ? raw.lead.trim() : "";
  const summaryRaw = typeof raw.summary === "string" ? raw.summary.trim() : "";
  const summary = summaryRaw || lead.slice(0, 120) || title || "商品紹介";
  const seoTitle =
    typeof raw.seoTitle === "string" && raw.seoTitle.trim()
      ? raw.seoTitle.trim()
      : title || summary;
  const metaDescription =
    typeof raw.metaDescription === "string" && raw.metaDescription.trim()
      ? raw.metaDescription.trim()
      : summary.slice(0, 160);
  return {
    ...raw,
    title: title || "商品紹介",
    lead: lead || summary,
    summary,
    seoTitle,
    metaDescription,
    labels: Array.isArray(raw.labels) ? raw.labels : [],
    sourceReferences: Array.isArray(raw.sourceReferences) ? raw.sourceReferences : [],
    warnings: Array.isArray(raw.warnings) ? raw.warnings : [],
    usedClaimIds: Array.isArray(raw.usedClaimIds) ? raw.usedClaimIds : [],
    usedProductLinkIds: Array.isArray(raw.usedProductLinkIds) ? raw.usedProductLinkIds : [],
  };
}

/** Slim JSON Schema for OPTION B Generator — display fields only. */
export function getOptionBBloggerArticleLlmJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: true,
    required: [...OPTION_B_LLM_REQUIRED_KEYS],
    properties: {
      title: { type: "string" },
      lead: { type: "string" },
      sections: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          properties: {
            heading: { type: ["string", "null"] },
            paragraphs: { type: "array", items: { type: "string" } },
            lists: { type: "array", items: { type: "string" } },
          },
          required: ["paragraphs"],
        },
      },
      cta: {
        type: "object",
        properties: {
          label: { type: "string" },
          url: { type: ["string", "null"] },
        },
        required: ["label", "url"],
      },
    },
  };
}

export function getOptionBBloggerArticleContractExample(): Record<string, unknown> {
  return {
    title: "出演者名のベスト作品集",
    lead: "出演者のシリーズ作品をまとめたベスト集です。",
    sections: [
      {
        heading: null,
        paragraphs: ["収録規模や具体的なシーン要素など、公開事実を自然に紹介する。"],
        lists: [],
      },
    ],
    cta: {
      label: "作品ページで詳細を確認",
      url: "https://example.invalid/product",
    },
  };
}

/**
 * Derive OpenAI-compatible JSON Schema from a Zod type (no hand-copied field list).
 * Walks the same Zod tree used by bloggerArticleSchema.
 */
export function zodToOpenAiJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  return convertZod(schema, { forceRequired: true });
}

function convertZod(
  schema: z.ZodTypeAny,
  opts: { forceRequired: boolean },
): Record<string, unknown> {
  const typeName = schema._def.typeName as string;

  if (typeName === "ZodOptional") {
    return convertZod(schema._def.innerType as z.ZodTypeAny, opts);
  }
  if (typeName === "ZodDefault") {
    return convertZod(schema._def.innerType as z.ZodTypeAny, opts);
  }
  if (typeName === "ZodNullable") {
    const inner = convertZod(schema._def.innerType as z.ZodTypeAny, opts);
    return mergeNullable(inner);
  }
  if (typeName === "ZodEffects") {
    return convertZod(schema._def.schema as z.ZodTypeAny, opts);
  }
  if (typeName === "ZodString") {
    return { type: "string" };
  }
  if (typeName === "ZodNumber") {
    return { type: "number" };
  }
  if (typeName === "ZodBoolean") {
    return { type: "boolean" };
  }
  if (typeName === "ZodArray") {
    return {
      type: "array",
      items: convertZod(schema._def.type as z.ZodTypeAny, opts),
    };
  }
  if (typeName === "ZodObject") {
    const shape = schema._def.shape() as Record<string, z.ZodTypeAny>;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      const tn = value._def.typeName as string;
      // OpenAI strict json_schema requires every property key to appear in `required`.
      // Optional Zod fields become nullable so the model can return null.
      if (opts.forceRequired && tn === "ZodOptional") {
        const inner = value._def.innerType as z.ZodTypeAny;
        properties[key] = mergeNullable(convertZod(inner, opts));
        required.push(key);
        continue;
      }
      properties[key] = convertZod(value, opts);
      if (opts.forceRequired) {
        required.push(key);
      } else if (tn !== "ZodOptional" && tn !== "ZodDefault") {
        required.push(key);
      }
    }
    return {
      type: "object",
      additionalProperties: false,
      properties,
      required,
    };
  }
  if (typeName === "ZodEnum") {
    return { type: "string", enum: schema._def.values as string[] };
  }
  if (typeName === "ZodLiteral") {
    const v = schema._def.value;
    return { type: typeof v, const: v };
  }
  return {};
}

function mergeNullable(inner: Record<string, unknown>): Record<string, unknown> {
  const t = inner.type;
  if (typeof t === "string") {
    return { ...inner, type: [t, "null"] };
  }
  if (Array.isArray(t)) {
    return { ...inner, type: [...new Set([...t, "null"])] };
  }
  return { anyOf: [inner, { type: "null" }] };
}

/** JSON Schema derived from bloggerArticleSchema (SSOT). Optionally cardinality-bound by Article Output Contract. */
export function getBloggerArticleLlmJsonSchema(
  articleOutputContract?: import("./article-output-contract.js").ArticleOutputContract | null,
): Record<string, unknown> {
  const base = zodToOpenAiJsonSchema(bloggerArticleSchema) as {
    properties?: Record<string, unknown>;
    required?: string[];
  };
  // Always express Zod .min(1) as minItems for sections when no contract
  const sections = base.properties?.sections as Record<string, unknown> | undefined;
  if (sections && typeof sections === "object" && sections.minItems == null) {
    sections.minItems = 1;
  }
  // Internal generation provenance (not part of public article Zod schema / formatter).
  base.properties = {
    ...(base.properties ?? {}),
    titleClaimIds: { type: "array", items: { type: "string" } },
    leadClaimIds: { type: "array", items: { type: "string" } },
    summaryClaimIds: { type: "array", items: { type: "string" } },
    sectionClaimIds: {
      type: "array",
      items: { type: "array", items: { type: "string" } },
    },
    segmentContributionProvenance: {
      type: "object",
      properties: {
        lead: {
          type: "object",
          properties: {
            requiredContributionIds: { type: "array", items: { type: "string" } },
            usedContributionIds: { type: "array", items: { type: "string" } },
            text: { type: "string" },
          },
        },
        sections: {
          type: "array",
          items: {
            type: "object",
            properties: {
              requiredContributionIds: { type: "array", items: { type: "string" } },
              usedContributionIds: { type: "array", items: { type: "string" } },
              text: { type: "string" },
            },
          },
        },
      },
    },
  };
  if (!articleOutputContract) return base;
  // Dynamic import avoided — patch inline to keep this module usable without cycle at type level
  sections!.minItems = articleOutputContract.minArticleSections;
  sections!.maxItems = articleOutputContract.maxArticleSections;
  return base;
}

/** Example object that validates against bloggerArticleSchema — used in prompts/tests/Mock. */
export function getBloggerArticleContractExample(): Record<string, unknown> {
  return {
    title: "公開情報に基づく商品概要",
    summary: "確認できた事実と購入導線を整理した概要。",
    lead: "公開ページで確認できる情報を先に示す。",
    sections: [
      {
        heading: "確認できる情報",
        paragraphs: ["SUPPORTED Claim に含まれる事実のみを記載する。"],
        lists: ["未観測の価格・発売日・評価は書かない"],
      },
    ],
    cta: {
      label: "作品ページで詳細を確認",
      url: "https://example.invalid/product",
    },
    sourceReferences: [],
    seoTitle: "公開情報に基づく商品概要",
    metaDescription: "確認できた事実のみをまとめた概要。",
    labels: ["catalog"],
    warnings: [],
    usedClaimIds: [],
    usedProductLinkIds: [],
    articleFormat: "new-release",
  };
}

export function buildMockBloggerArticleOutput(input: {
  productTitle: string;
  ctaUrl?: string | null;
  usedClaimIds?: string[];
  usedProductLinkIds?: string[];
  articleFormat?: string;
  /** When writingPolicy is present, emit editorial-improved mock (single product). */
  writingPolicy?: Record<string, unknown> | null;
  /**
   * When Structure Pattern is applied, emit sections that obey role→article mapping
   * (hook→lead; other roles→sections). Prevents mock drift vs production validation.
   */
  structurePattern?: StructurePatternHeadingContract | null;
  /**
   * When ClaimUsagePlan is present, honor omitCtaBridge / effectiveMaxArticleSections
   * so mock output stays within generation-time claim budget (not just Pattern max).
   */
  claimUsagePlan?: {
    omitCtaBridge?: boolean;
    omitInterestDevelopment?: boolean;
    effectiveMaxArticleSections?: number;
    hookClaimIds?: string[];
    developmentClaimIds?: string[];
  } | null;
  /** When present, embed required contribution facets so RAW plan compliance passes in mocks. */
  segmentContracts?: {
    lead?: { requiredContributions?: Array<{ id: string; facet: string }> };
    development?: { requiredContributions?: Array<{ id: string; facet: string }> };
  } | null;
}): Record<string, unknown> {
  const title = input.productTitle;
  const hookIds = input.claimUsagePlan?.hookClaimIds?.length
    ? input.claimUsagePlan.hookClaimIds
    : (input.usedClaimIds ?? []).slice(0, 1);
  const devIds = input.claimUsagePlan?.developmentClaimIds?.length
    ? input.claimUsagePlan.developmentClaimIds
    : (input.usedClaimIds ?? []).slice(1);
  const leadFacets = (input.segmentContracts?.lead?.requiredContributions ?? [])
    .map((c) => c.facet)
    .filter(Boolean);
  const bodyFacets = (input.segmentContracts?.development?.requiredContributions ?? [])
    .map((c) => c.facet)
    .filter(Boolean);
  const leadText =
    leadFacets.length > 0
      ? `${leadFacets.join("・")}が作品に含まれる。`
      : `${title.slice(0, 40)}を扱う。`;
  const bodyParas =
    bodyFacets.length > 0
      ? bodyFacets.map((f) => `さらに${f}という点がSUPPORTED事実として示されている。`)
      : ["SUPPORTED Claim に含まれる事実のみを記載する。"];
  const attachProvenance = (obj: Record<string, unknown>): Record<string, unknown> => {
    const sectionCount = Array.isArray(obj.sections) ? obj.sections.length : 1;
    const leadReq = (input.segmentContracts?.lead?.requiredContributions ?? []).map((c) => c.id);
    const bodyReq = (input.segmentContracts?.development?.requiredContributions ?? []).map(
      (c) => c.id,
    );
    const sectionsRaw = Array.isArray(obj.sections)
      ? (obj.sections as Array<Record<string, unknown>>)
      : [];
    const patchedSections =
      bodyFacets.length > 0
        ? (sectionsRaw.length
            ? sectionsRaw
            : [{ heading: null, paragraphs: [], lists: [] }]
          ).map((s, i) => ({
            ...s,
            paragraphs: [bodyParas[Math.min(i, bodyParas.length - 1)]!],
          }))
        : sectionsRaw;
    const patched = {
      ...obj,
      lead: leadFacets.length > 0 ? leadText : obj.lead,
      sections: patchedSections.length ? patchedSections : obj.sections,
    };
    const finalSectionCount = Array.isArray(patched.sections)
      ? patched.sections.length
      : sectionCount;
    return {
      ...patched,
      titleClaimIds: hookIds,
      leadClaimIds: hookIds,
      summaryClaimIds: [...new Set([...hookIds, ...devIds])].slice(0, 4),
      sectionClaimIds: Array.from({ length: Math.max(1, finalSectionCount) }, () => [...devIds]),
      segmentContributionProvenance: {
        lead: { requiredContributionIds: leadReq, usedContributionIds: leadReq },
        sections: Array.from({ length: Math.max(1, finalSectionCount) }, (_, i) => ({
          requiredContributionIds: bodyReq[i] ? [bodyReq[i]!] : bodyReq,
          usedContributionIds: bodyReq[i] ? [bodyReq[i]!] : bodyReq,
        })),
      },
    };
  };
  const patternBlocks = input.structurePattern?.blocks;
  const omitCta =
    input.claimUsagePlan?.omitCtaBridge === true ||
    (typeof input.claimUsagePlan?.effectiveMaxArticleSections === "number" &&
      input.claimUsagePlan.effectiveMaxArticleSections <= 1);
  const maxSections =
    typeof input.claimUsagePlan?.effectiveMaxArticleSections === "number"
      ? Math.max(1, input.claimUsagePlan.effectiveMaxArticleSections)
      : null;
  if (patternBlocks && patternBlocks.length > 0) {
    const sectionBlocks = patternBlocks.filter((b) => {
      if (structureBlockArticleTarget(b.role) !== "section") return false;
      if (omitCta && b.role === "cta_bridge") return false;
      return true;
    });
    let sections = sectionBlocks.map((block, idx) => {
      if (block.usesList) {
        return {
          heading: block.heading ? "判断の軸" : null,
          paragraphs: [] as string[],
          lists: ["公開されている系列情報を先に確認", "未確認の価格・評価は書かない"],
        };
      }
      if (block.role === "cta_bridge") {
        return {
          heading: block.heading ? "詳細確認" : null,
          paragraphs: [
            "系列やメーカーの好みが近い人の候補リストに入れやすいかを確認する段階、という位置づけにする。",
          ],
          lists: [] as string[],
        };
      }
      // interest / editorial body — dense, short (claim budget); no catalog dump / CTA pad
      return {
        heading: block.heading ? (idx === 0 ? "見どころの整理" : "公開事実の整理") : null,
        paragraphs: [
          input.claimUsagePlan?.omitInterestDevelopment
            ? "公開事実はリードで示し、ここでは候補判断の位置づけだけを残す。"
            : "公開事実上の差別化点を短く進め、評価や適性の断定は付けない。",
        ],
        lists: [] as string[],
      };
    });
    if (maxSections != null) sections = sections.slice(0, maxSections);
    const safeSections =
      sections.length > 0
        ? sections
        : [
            {
              heading: null as string | null,
              paragraphs: ["公開事実を選択材料として短く残す。"],
              lists: [] as string[],
            },
          ];
    return attachProvenance({
      title: `${title} を候補に入れる人向けの整理`,
      summary: "公開事実から読み取れる見どころを短くまとめた単商品メモ。",
      lead: "確認できる具体事実を先に置き、未確認の評価や舞台推測は書かない。",
      sections: safeSections,
      cta: {
        label: "作品ページで詳細を確認",
        url: input.ctaUrl ?? null,
      },
      sourceReferences: [],
      seoTitle: `${title} の選び方メモ`,
      metaDescription: `${title} の公開事実を選択材料として整理。`,
      labels: ["catalog", "editorial", "structure-pattern"],
      warnings: [],
      usedClaimIds: input.usedClaimIds ?? [],
      usedProductLinkIds: input.usedProductLinkIds ?? [],
      articleFormat: input.articleFormat ?? "new-release",
    });
  }

  const compactForClaimBudget =
    omitCta ||
    (maxSections != null && maxSections <= 1) ||
    input.claimUsagePlan?.omitInterestDevelopment === true;

  const improved = Boolean(input.writingPolicy && typeof input.writingPolicy === "object");
  if (improved) {
    if (compactForClaimBudget) {
      return attachProvenance({
        title: `${title} を候補に入れる人向けの整理`,
        summary: "公開事実から読み取れる見どころを短くまとめた単商品メモ。",
        lead: "確認できる具体事実を先に置き、未確認の評価や舞台推測は書かない。",
        sections: [
          {
            heading: "公開事実の整理",
            paragraphs: ["公開事実上の差別化点を短く進め、評価や適性の断定は付けない。"],
            lists: [] as string[],
          },
        ],
        cta: {
          label: "作品ページで詳細を確認",
          url: input.ctaUrl ?? null,
        },
        sourceReferences: [],
        seoTitle: `${title} の選び方メモ`,
        metaDescription: `${title} の公開事実を選択材料として整理。`,
        labels: ["catalog", "editorial"],
        warnings: [],
        usedClaimIds: input.usedClaimIds ?? [],
        usedProductLinkIds: input.usedProductLinkIds ?? [],
        articleFormat: input.articleFormat ?? "new-release",
      });
    }
    return attachProvenance({
      title: `${title} を候補に入れる人向けの整理`,
      summary:
        "公開事実を分類し、どんな読者が候補にしやすいかだけを編集的に整理した単商品メモ。",
      lead: "シリーズやメーカーの公開情報を、選ぶときの材料として先に整理する。体験談ではなく、確認できる事実から読み取れるポイントに絞る。",
      sections: [
        {
          heading: "選ぶときに見るポイント",
          paragraphs: [
            "出演・シリーズ・メーカーが公開されている場合、それらを判断材料として並べる。評価や順位は付けない。",
            "確認できない感想や「実際に見た」表現は使わない。",
          ],
          lists: ["公開されている系列情報を先に確認", "未確認の価格・評価は書かない"],
        },
        {
          heading: "公開事実の整理",
          paragraphs: [
            `${title} について、カタログ上で確認できた範囲の事実だけを短くまとめる。`,
            "同じ文の言い換えを避け、事実と編集上の整理を段落で分ける。",
          ],
          lists: [],
        },
        {
          heading: "詳細を見る前の位置づけ",
          paragraphs: [
            "系列やメーカーの好みが近い人の候補リストに入れやすいかを確認する段階、という位置づけにする。",
            "気になる場合のみ商品ページで最新の公開情報を確認する。",
          ],
          lists: [],
        },
      ],
      cta: {
        label: "作品ページで詳細を確認",
        url: input.ctaUrl ?? null,
      },
      sourceReferences: [],
      seoTitle: `${title} の選び方メモ`,
      metaDescription: `${title} の公開事実を選択材料として整理。`,
      labels: ["catalog", "editorial"],
      warnings: [],
      usedClaimIds: input.usedClaimIds ?? [],
      usedProductLinkIds: input.usedProductLinkIds ?? [],
      articleFormat: input.articleFormat ?? "new-release",
    });
  }
  if (compactForClaimBudget) {
    return attachProvenance({
      title: `${title} の公開情報まとめ`,
      summary: `${title} の確認できる事実を短く示したメモ。`,
      lead: `${title} は公開カタログ上で確認できる項目がある。`,
      sections: [
        {
          heading: "確認できる情報",
          paragraphs: [`${title} について、公開ページで確認できた事実だけを短く整理する。`],
          lists: [] as string[],
        },
      ],
      cta: {
        label: "作品ページで詳細を確認",
        url: input.ctaUrl ?? null,
      },
      sourceReferences: [],
      seoTitle: `${title} 概要`,
      metaDescription: `${title} の概要。`,
      labels: ["catalog", "overview"],
      warnings: [],
      usedClaimIds: input.usedClaimIds ?? [],
      usedProductLinkIds: input.usedProductLinkIds ?? [],
      articleFormat: input.articleFormat ?? "new-release",
    });
  }
  return attachProvenance({
    title: `${title} の公開情報まとめ`,
    summary: `${title} の確認できる事実と購入導線を整理。`,
    lead: `${title} は公開カタログ上で確認できる項目がある。`,
    sections: [
      {
        heading: "確認できる情報",
        paragraphs: [
          `${title} について、公開ページで確認できた事実だけを整理する。`,
          "確認できない内容は断定しない。価格・発売日・出演者などは根拠がある場合のみ記載する。",
        ],
        lists: ["公開情報を優先", "レビューと事実を区別"],
      },
      {
        heading: "注意",
        paragraphs: ["18歳未満は対象外です。アフィリエイト広告を含む場合があります。"],
        lists: [] as string[],
      },
    ],
    cta: {
      label: "作品ページで詳細を確認",
      url: input.ctaUrl ?? null,
    },
    sourceReferences: [],
    seoTitle: `${title} 概要`,
    metaDescription: `${title} の概要と注意点。`,
    labels: ["catalog", "overview"],
    warnings: [],
    usedClaimIds: input.usedClaimIds ?? [],
    usedProductLinkIds: input.usedProductLinkIds ?? [],
    articleFormat: input.articleFormat ?? "new-release",
  });
}

/** Safe Zod error summary — paths/codes only, no body text. */
export function summarizeBloggerSchemaValidationError(error: unknown): string {
  if (error instanceof z.ZodError) {
    const parts = error.issues.slice(0, 12).map((issue) => {
      const path = issue.path.length ? issue.path.join(".") : "(root)";
      return `${path}:${issue.code}`;
    });
    return `structured_output_schema_validation_failed (${parts.join("; ")})`;
  }
  if (error instanceof Error) {
    return `structured_output_schema_validation_failed (${error.name})`;
  }
  return "structured_output_schema_validation_failed";
}

export function parseBloggerArticle(output: Record<string, unknown>): BloggerArticleStructured {
  return bloggerArticleSchema.parse(output);
}

export function safeParseBloggerArticle(output: unknown) {
  return bloggerArticleSchema.safeParse(output);
}

export function parseXPost(output: Record<string, unknown>): XPostStructured {
  return xPostSchema.parse(output);
}

export function structuredToPlainBody(
  article: BloggerArticleStructured,
  options?: { images?: Array<{ role: string; sourceUrl: string; alt?: string }> },
): string {
  const parts: string[] = [];
  const hero = options?.images?.find((img) => img.role === "hero");
  if (hero?.sourceUrl) {
    parts.push(`![${hero.alt ?? "商品画像"}](${hero.sourceUrl})`, "");
  }
  parts.push(article.lead, "");
  for (let i = 0; i < article.sections.length; i++) {
    const section = article.sections[i]!;
    const heading = section.heading?.trim();
    if (heading) {
      parts.push(`## ${heading}`);
    }
    parts.push(...section.paragraphs, ...section.lists.map((item) => `- ${item}`), "");
    if (i === 0) {
      for (const aux of options?.images?.filter((img) => img.role === "auxiliary") ?? []) {
        if (aux.sourceUrl) parts.push(`![${aux.alt ?? "サンプル画像"}](${aux.sourceUrl})`, "");
      }
    }
  }
  if (article.cta.url) {
    parts.push(`${article.cta.label}: ${article.cta.url}`);
  } else {
    parts.push(`${article.cta.label}: （リンク準備中）`);
  }
  // Deterministic freshness note (not LLM). Once, immediately after CTA.
  parts.push("", FRESHNESS_DISCLAIMER);
  parts.push("", "本記事はアフィリエイト広告を含む場合があります。");
  return parts.join("\n").trim();
}

/** Prompt texts for blogger.generate — schema embedded from SSOT. */
export function buildBloggerGeneratePromptDefinition(): {
  body: string;
  systemInstruction: string;
  outputSchema: Record<string, unknown>;
} {
  const outputSchema = getBloggerArticleLlmJsonSchema();
  const example = getBloggerArticleContractExample();
  const required = BLOGGER_ARTICLE_REQUIRED_KEYS.join(", ");

  const systemInstruction = [
    "You are a careful Japanese adult-affiliate content operator for Blogger.",
    "Return ONLY one JSON object. No markdown code fences. No commentary. No schema explanation prose.",
    "Start with the topic in title/lead — no long preamble.",
    "Forbidden openers: 「今回は〜をご紹介します」「この記事では」「結論から言うと」「すぐに結論です」.",
    "Use ONLY facts from the provided SUPPORTED claims. Do not invent or fill in unobserved price, release date, cast, ranking, ratings, sale status, or detailed plot.",
    "Product title text may be used as the subject name, but do not treat unverified details inside a marketing title as confirmed facts unless a SUPPORTED claim covers them.",
    "Distinguish facts vs editorial framing. Never claim first-hand experience (体験した/実際に見た).",
    "When writingPolicy is present: follow roles/ratios/order — do NOT copy templates. Turn claims into selection criteria for readers (who might shortlist this), without inventing facts.",
    "Avoid generic AI praise and title-only paraphrase across lead/summary/body. Keep information density high; reduce repetition.",
    "Place a natural CTA using the provided product URL (normal store URL is OK; do not imply affiliate commission).",
    `Required top-level fields: ${required}.`,
    'cta MUST be an object {"label": string, "url": string|null} — never a bare string.',
    "sections MUST be a non-empty array. Each section has heading (string|null), paragraphs (string array), and lists (string array).",
    "heading: use null when the Structure Pattern block has heading=false (or continuous prose). Never use empty string \"\". When a block has heading=true (or no Structure Pattern), heading must be a non-empty string.",
    "If a section has no list items, set lists to [] — never null, never omit with a non-array value.",
    "seoTitle and metaDescription are required strings.",
    "sourceReferences, labels, warnings, usedClaimIds, usedProductLinkIds must be arrays (use [] when empty).",
    "articleFormat is optional string.",
    "Do NOT replace this contract with alternate keys such as content, tags, or schema.",
    "Priority: Policy > SUPPORTED Claims > ArticleFormat/writingPolicy > Learning preference.",
    "JSON Schema (authoritative):",
    JSON.stringify(outputSchema),
    "Example (shape only; replace with real grounded content):",
    JSON.stringify(example),
  ].join("\n");

  const body = [
    "Generate a structured Blogger article JSON for productTitle={{productTitle}}.",
    "CTA url to use in cta.url: {{ctaUrl}}",
    "articleFormat={{articleFormat}}",
    "formatSpec={{formatSpec}}",
    "writingPolicy={{writingPolicy}}",
    "SUPPORTED claims (only allowed fact sources): {{supportedClaims}}",
    "Return JSON that validates against the blogger article schema in the system instruction.",
    "Put usedClaimIds for every SUPPORTED claim id you relied on.",
    "Do not invent facts. Do not invent extra products to satisfy formatSpec. Claim/Policy outrank format.",
    "If writingPolicy.requireEditorialValue: include selection_criteria / editorial framing sections grounded only in claims.",
    "Do not output content/tags/schema alternate shapes.",
  ].join(" ");

  return { body, systemInstruction, outputSchema };
}
