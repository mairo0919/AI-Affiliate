import type { JobRepository } from "@ai-affiliate/database";

export async function resolveJobFailureError(
  jobs: JobRepository,
  jobId: string | null | undefined,
  jobStatus: string,
): Promise<Error> {
  if (jobStatus === "CANCELLED") {
    return Object.assign(new Error("cancelled"), { name: "CancelledError" });
  }
  if (jobId) {
    const latest = await jobs.findLatestJobError(jobId);
    if (latest) {
      const name = latest.errorType.endsWith("Error")
        ? latest.errorType
        : `${latest.errorType}Error`;
      return Object.assign(new Error(latest.message), {
        name,
        retryable: latest.retryable,
      });
    }
  }
  return Object.assign(new Error(`job status ${jobStatus}`), {
    name: "NetworkError",
    retryable: true,
  });
}
