export { AnalysisEngine } from "./analysis-engine.js";
export type { AnalysisEngineDeps, AnalysisRunOptions, AnalysisRunResult } from "./analysis-engine.js";
export { evaluateEligibility } from "./eligibility.js";
export {
  scorePopularity,
  scoreTrend,
  scoreReview,
  scorePrice,
  scoreFreshness,
  scoreDataQuality,
} from "./scoring.js";
export { computeTotalScore } from "./total-score.js";
export { selectCandidates } from "./selection.js";
export {
  SCORING_VERSION,
  ELIGIBILITY_VERSION,
  SELECTION_VERSION,
  DEFAULT_SCORE_WEIGHTS,
  buildMetricIndex,
  buildTagIndex,
} from "./types.js";
