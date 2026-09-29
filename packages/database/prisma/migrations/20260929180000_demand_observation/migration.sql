-- Append-only FANZA demand observations (candidate priority only).
CREATE TABLE "DemandObservation" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'video',
    "contentId" TEXT,
    "keyword" TEXT,
    "rank" INTEGER NOT NULL,
    "semanticType" TEXT,
    "provenance" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DemandObservation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DemandObservation_source_observedAt_idx" ON "DemandObservation"("source", "observedAt");
CREATE INDEX "DemandObservation_contentId_observedAt_idx" ON "DemandObservation"("contentId", "observedAt");
CREATE INDEX "DemandObservation_keyword_observedAt_idx" ON "DemandObservation"("keyword", "observedAt");
