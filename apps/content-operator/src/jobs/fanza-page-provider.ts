import type { FanzaCollectOptions, FanzaResearchProvider } from "../providers/fanza/index.js";
import type { PageCollectionProvider } from "./collection-job-runner.js";

export class FanzaPageCollectionProvider implements PageCollectionProvider {
  readonly providerName = "fanza";

  constructor(
    private readonly provider: FanzaResearchProvider,
    private readonly baseOptions: FanzaCollectOptions = {},
  ) {}

  async collectPage(options: { offset: number; hits: number; [key: string]: unknown }) {
    return this.provider.collect({
      ...this.baseOptions,
      service: typeof options.service === "string" ? options.service : this.baseOptions.service,
      floor: typeof options.floor === "string" ? options.floor : this.baseOptions.floor,
      keyword: typeof options.keyword === "string" ? options.keyword : this.baseOptions.keyword,
      sort: typeof options.sort === "string" ? options.sort : this.baseOptions.sort,
      fromDate: typeof options.fromDate === "string" ? options.fromDate : this.baseOptions.fromDate,
      toDate: typeof options.toDate === "string" ? options.toDate : this.baseOptions.toDate,
      offset: options.offset,
      hits: options.hits,
    });
  }
}
