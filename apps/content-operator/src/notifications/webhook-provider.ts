import type {
  NotificationSendResult,
  PreparedResearchNotification,
  ResearchNotificationProvider,
} from "./types.js";

export interface WebhookNotificationProviderOptions {
  webhookUrl: string | undefined;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  random?: () => number;
  now?: () => Date;
}

export class WebhookNotificationProvider implements ResearchNotificationProvider {
  readonly channelType = "WEBHOOK" as const;
  private readonly webhookUrl: string | undefined;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleepImpl: (ms: number) => Promise<void>;
  private readonly maxAttempts: number;
  private readonly random: () => number;

  constructor(options: WebhookNotificationProviderOptions) {
    this.webhookUrl = options.webhookUrl;
    this.timeoutMs = options.timeoutMs;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleepImpl = options.sleepImpl ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.maxAttempts = options.maxAttempts ?? 3;
    this.random = options.random ?? Math.random;
  }

  async send(notification: PreparedResearchNotification): Promise<NotificationSendResult> {
    if (!this.webhookUrl || this.webhookUrl.trim() === "") {
      return {
        ok: false,
        skipped: true,
        errorType: "Configuration",
        errorMessage: "webhook URL not configured",
        retryable: false,
      };
    }

    let lastResult: NotificationSendResult = {
      ok: false,
      errorType: "Unknown",
      errorMessage: "webhook send failed",
      retryable: false,
    };

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      lastResult = await this.postOnce(notification);
      if (lastResult.ok || lastResult.skipped) {
        return lastResult;
      }
      if (!lastResult.retryable || attempt >= this.maxAttempts) {
        return lastResult;
      }
      const delayMs = Math.round(250 * 2 ** (attempt - 1) * (1 + (this.random() * 0.2 - 0.1)));
      await this.sleepImpl(delayMs);
    }
    return lastResult;
  }

  private async postOnce(
    notification: PreparedResearchNotification,
  ): Promise<NotificationSendResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.webhookUrl!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(notification.payload),
        signal: controller.signal,
      });
      // Never log URL or response body
      if (response.status >= 200 && response.status < 300) {
        return { ok: true, httpStatus: response.status };
      }
      if (response.status === 429 || response.status >= 500) {
        return {
          ok: false,
          httpStatus: response.status,
          errorType: "HttpError",
          errorMessage: `webhook HTTP ${response.status}`,
          retryable: true,
        };
      }
      return {
        ok: false,
        httpStatus: response.status,
        errorType: "HttpError",
        errorMessage: `webhook HTTP ${response.status}`,
        retryable: false,
      };
    } catch (error) {
      const name = error instanceof Error ? error.name : "Error";
      const retryable = name === "AbortError" || name === "TimeoutError" || name === "TypeError";
      return {
        ok: false,
        errorType: name === "AbortError" ? "Timeout" : "Network",
        errorMessage: "webhook request failed",
        retryable,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
