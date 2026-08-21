import type { AppConfig } from "@ai-affiliate/config";
import type { PrismaClient } from "@ai-affiliate/database";
import { XLiveRepository } from "@ai-affiliate/database";
import { XApiBudgetService } from "./budget-service.js";
import { XOAuthService } from "./oauth-service.js";
import { TokenEncryptionService } from "./token-encryption.js";
import { TokenRefreshService } from "./token-refresh-service.js";
import { XApiUsageService } from "./usage-service.js";
import { XApiHttpClient } from "./x-api-http-client.js";
import { XApiPublishingProvider } from "../providers/x-api-publishing-provider.js";

export interface LiveStackNotifications {
  emitXEvent?: (eventType: string, payload: Record<string, unknown>) => Promise<void>;
}

export interface CreateLiveStackOptions {
  config: AppConfig;
  prisma: PrismaClient;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  allowWrites?: boolean;
  notifications?: LiveStackNotifications;
}

export interface XLiveStack {
  live: XLiveRepository;
  encryption: TokenEncryptionService;
  http: XApiHttpClient;
  oauth: XOAuthService;
  tokens: TokenRefreshService;
  usage: XApiUsageService;
  budget: XApiBudgetService;
  provider: XApiPublishingProvider;
}

export function createLiveStack(options: CreateLiveStackOptions): XLiveStack {
  const live = new XLiveRepository(options.prisma);
  const encryption = new TokenEncryptionService({
    keyBase64: options.config.xTokenEncryptionKey,
    keyVersion: options.config.xTokenEncryptionKeyVersion,
  });
  const http = new XApiHttpClient({
    config: options.config,
    live,
    fetchImpl: options.fetchImpl,
    now: options.now,
    sleep: options.sleep,
  });
  const notify = options.notifications;

  const tokens = new TokenRefreshService({
    config: options.config,
    live,
    encryption,
    http,
    now: options.now,
    notifications: {
      emitXEvent: (eventType, payload) =>
        notify?.emitXEvent?.(eventType, payload) ?? Promise.resolve(),
    },
  });

  const usage = new XApiUsageService({
    config: options.config,
    live,
    http,
    now: options.now,
    notifications: {
      emitXEvent: (eventType, payload) =>
        notify?.emitXEvent?.(eventType, payload) ?? Promise.resolve(),
    },
  });

  const budget = new XApiBudgetService({
    config: options.config,
    live,
    usage,
    now: options.now,
    notifications: {
      emitXEvent: (eventType, payload) =>
        notify?.emitXEvent?.(eventType, payload) ?? Promise.resolve(),
    },
  });

  const oauth = new XOAuthService({
    config: options.config,
    live,
    encryption,
    http,
    now: options.now,
    notifications: {
      emitXEvent: (eventType, payload) =>
        notify?.emitXEvent?.(eventType, payload) ?? Promise.resolve(),
    },
  });

  const provider = new XApiPublishingProvider({
    config: options.config,
    http,
    tokens,
    usage,
    budget,
    now: options.now,
    sleep: options.sleep,
    allowWrites: options.allowWrites,
    notifications: {
      emitXEvent: (eventType, payload) =>
        notify?.emitXEvent?.(eventType, payload) ?? Promise.resolve(),
    },
  });

  return { live, encryption, http, oauth, tokens, usage, budget, provider };
}
