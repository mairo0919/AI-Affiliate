export {
  XContentFeatureExtractor,
  computeOptimizationScore,
  ratesFromSnapshot,
  stableSegmentKey,
  tokyoParts,
  postingTimeBucket,
  bandScore,
  bandCount,
  classifyDensity,
  OPTIMIZATION_METRICS_VERSION,
  VARIANT_VERSION,
  WEEKDAYS,
} from "./feature-extractor.js";
export type {
  XContentFeatures,
  ContentAngle,
  InformationDensity,
} from "./feature-extractor.js";
export { XOptimizationEngine } from "./optimization-engine.js";
export type {
  XOptimizationEngineDeps,
  OptimizationRunResult,
} from "./optimization-engine.js";
export { XContentOptimizer } from "./content-optimizer.js";
export type {
  XContentOptimizerDeps,
  OptimizeApplyResult,
} from "./content-optimizer.js";
export { XOptimizationImpactEvaluator } from "./impact-evaluator.js";
export type {
  XOptimizationImpactEvaluatorDeps,
  ImpactEvaluationResult,
  ImpactResultLabel,
} from "./impact-evaluator.js";
export { XOptimizationRecommendationService } from "./recommendation-service.js";
export type { XOptimizationRecommendationServiceDeps } from "./recommendation-service.js";
export { XOptimizationValidator } from "./optimization-validator.js";
