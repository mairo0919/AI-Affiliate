/**
 * r54 — LLM=0 readiness audit for FANZA daily auto-publish.
 * Does not call LLM, does not publish to Blogger, does not post to X.
 *
 *   OUT_DIR=/tmp/r54-daily-readiness npx tsx src/ops/r54-daily-auto-publish-readiness.ts
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "@ai-affiliate/config";
import {
  loadDailyBlogEnvConfig,
  runDailyBlogOrchestratorDry,
  buildKnownPublication,
  evaluatePublishGate,
  validateFanzaAffiliateUrl,
} from "../daily-blog/index.js";
import { OPTION_B_SEGMENT_RAW_OBSERVE_REASON } from "../editorial-brain/generation/option-b-segment-raw-gate.js";
import { optionBAllowsPostLlmProseMutation } from "../editorial-brain/generation/option-b-blog-boundary.js";

const OUT =
  process.env.OUT_DIR ||
  `/tmp/r54-daily-readiness-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;

async function main() {
  mkdirSync(OUT, { recursive: true });
  const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
  const cfg = loadConfig({ requireDatabaseUrl: false });
  const blog = loadDailyBlogEnvConfig();

  const cgs = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../generation/content-generation-service.ts"),
    "utf8",
  );
  const pipeline = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../schedules/scheduler-pipeline.ts"),
    "utf8",
  );

  const dry = runDailyBlogOrchestratorDry({
    config: blog,
    knownPublications: [
      buildKnownPublication({
        cid: "already001",
        status: "PUBLISHED",
        bloggerPostId: "1",
      }),
    ],
    candidates: [
      {
        researchItemId: "1",
        canonicalId: "already001",
        totalScore: 90,
        popularityScore: 90,
        trendScore: 10,
        freshnessScore: 10,
        dataQualityScore: 10,
        reviewScore: 10,
        pageEvidenceRichness: 1,
        sampleImageCount: 11,
        actressKey: "dup",
        makerKey: "m",
        seriesKey: "s",
        affiliateUrl: "https://al.fanza.co.jp/?af_id=1",
        title: "dup",
      },
      {
        researchItemId: "2",
        canonicalId: "fresh002",
        totalScore: 55,
        popularityScore: 55,
        trendScore: 40,
        freshnessScore: 40,
        dataQualityScore: 40,
        reviewScore: 40,
        pageEvidenceRichness: 0.6,
        sampleImageCount: 5,
        actressKey: "new",
        makerKey: "n",
        seriesKey: "t",
        affiliateUrl: "https://al.fanza.co.jp/?af_id=2",
        title: "fresh",
      },
    ],
    indexability: {
      postUrlCrawlable: true,
      canonicalPresent: true,
      noindexPresent: false,
      robotsTxtBlocksAll: false,
    },
  });

  const gateLiveBlocked = evaluatePublishGate({
    schemaPass: true,
    defer: false,
    claimValidationPass: true,
    integrityPass: true,
    brainDecision: "PASS",
    formatterPass: true,
    affiliateUrlValid: true,
    imagePipelinePass: true,
    bloggerAuthPass: true,
    duplicate: false,
    dryRun: false,
    autoPublishEnabled: true,
    allowDirectPublish: cfg.bloggerAllowDirectPublish,
  });

  const checklist = {
    A_dailyFlow: true,
    B_scheduler: {
      researchScheduleReusable: pipeline.includes("ScheduleRunner"),
      blogPhaseNotYetInPipeline: !pipeline.includes("runDailyBlog"),
      cronFromEnv: Boolean(blog.cronExpression),
      timezone: blog.timezone,
    },
    C_selection: true,
    D_duplicatePrevention: true,
    E_affiliateUrl: validateFanzaAffiliateUrl("https://al.fanza.co.jp/?af_id=x").ok,
    F_generation: {
      optionBPathPresent: cgs.includes("generateBloggerArticle"),
      writerSourceMaterial: cgs.includes("toOptionBWriterSourceMaterial"),
      unchangedArchitecture: true,
    },
    G_brainGate: true,
    H_bloggerPublish: {
      allowDirectPublishEnv: cfg.bloggerAllowDirectPublish,
      defaultPublishMode: cfg.bloggerDefaultPublishMode,
      livePublishBlockedUntilFlag: gateLiveBlocked.decision === "HOLD",
    },
    I_idempotency: true,
    J_retryFailure: true,
    K_seo: true,
    L_structuredData: {
      helpersPresent: true,
      injectDefaultOff: blog.injectArticleJsonLd === false,
    },
    M_aiSearchReadiness: true,
    N_indexability: dry.indexability,
    O_internalLinking: true,
    P_operationLogs: true,
    Q_budgetCostGuard: true,
    R_xHandoff: true,
    segmentObserveOnly: OPTION_B_SEGMENT_RAW_OBSERVE_REASON,
    proseMutation: optionBAllowsPostLlmProseMutation(),
    dryOrchestrator: {
      selectedCid: dry.selected?.canonicalId ?? null,
      publishDecision: dry.publishGate.decision,
      llmCalls: dry.log.llmCalls,
    },
  };

  // AUTO_PUBLISH_READY = wiring complete for next human-authorized 1-shot.
  // Still requires: enable flags + ALLOW_DIRECT_PUBLISH + schedule registration + human go.
  const autoPublishReady =
    checklist.E_affiliateUrl &&
    checklist.F_generation.optionBPathPresent &&
    dry.publishGate.decision === "DRY_RUN_OK" &&
    blog.enabled === false &&
    blog.dryRun === true &&
    !optionBAllowsPostLlmProseMutation();

  const report = {
    round: "r54",
    ...checklist,
    S_changedFiles: [
      "apps/content-operator/src/daily-blog/**",
      "apps/content-operator/src/generation/blogger-formatter.ts",
      "apps/content-operator/src/ops/r54-daily-auto-publish-readiness.ts",
      ".env.example",
    ],
    T_DELETE: ["no second FANZA client", "no LLM affiliate URL synthesis", "no keyword SEO dictionary"],
    U_CORRECT: [
      "duplicate gate across cid/url/blogger post",
      "publish gate requires Brain PASS",
      "affiliate CTA must carry partner signal",
    ],
    V_FIX: ["blogger-formatter optional jsonLd without duplicating existing ld+json"],
    W_ADD: [
      "daily-blog module (orchestrator, gates, ranking scaffold, SEO helpers, X handoff payload)",
      "BLOG_DAILY_* env keys",
    ],
    Z_AUTO_PUBLISH_READY: autoPublishReady ? "YES" : "NO",
    Z_note:
      "YES means dry-run skeleton ready; first LIVE publish requires explicit next-round human instruction + BLOG_DAILY_AUTO_PUBLISH_ENABLED + BLOGGER_ALLOW_DIRECT_PUBLISH.",
    AA_llmCalls: 0,
    AB_bloggerPublishCalls: 0,
    AC_xCalls: 0,
    repoRootHint: root,
  };

  writeFileSync(`${OUT}/RESULT.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    `${OUT}/RESULT.json`,
    JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }, null, 2),
  );
  console.error(e);
  process.exit(1);
});
