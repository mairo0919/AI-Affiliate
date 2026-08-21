import type { AnalyticsAdapter, AnalyticsMetricInput } from "../types.js";

export interface ManualAnalyticsRecord extends AnalyticsMetricInput {
  id: string;
  acceptedAt: Date;
}

export class ManualAnalyticsAdapter implements AnalyticsAdapter {
  private seq = 0;
  private readonly records: ManualAnalyticsRecord[] = [];

  getRecords(): readonly ManualAnalyticsRecord[] {
    return this.records;
  }

  async ingestMetrics(input: AnalyticsMetricInput): Promise<{ accepted: boolean; id: string }> {
    this.seq += 1;
    const id = `manual-metrics-${this.seq}`;
    this.records.push({
      ...input,
      id,
      acceptedAt: new Date(),
      capturedAt: input.capturedAt ?? new Date(),
    });
    return { accepted: true, id };
  }
}
