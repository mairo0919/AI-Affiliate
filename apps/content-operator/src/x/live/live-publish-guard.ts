import { XPublishError } from "../types.js";

export interface LivePublishArgs {
  publicationId?: string;
  accountId?: string;
  confirmAccount?: string;
  confirmTextHash?: string;
  live?: boolean;
  actor?: string;
  reason?: string;
}

/**
 * ALLOWLIST first live publish requires explicit CLI confirmations.
 * Never prompts interactively.
 */
export function assertLivePublishArgs(
  args: LivePublishArgs,
  options?: { requireInitialConfirmations?: boolean },
): asserts args is Required<
  Pick<
    LivePublishArgs,
    | "publicationId"
    | "accountId"
    | "confirmAccount"
    | "confirmTextHash"
    | "live"
    | "actor"
    | "reason"
  >
> &
  LivePublishArgs {
  if (!args.live) {
    throw new XPublishError("ALLOWLIST live publish requires --live", "Configuration", {
      retryable: false,
    });
  }
  if (!args.publicationId) {
    throw new XPublishError("--publication-id is required", "Validation", {
      retryable: false,
    });
  }
  if (!args.accountId) {
    throw new XPublishError("--account-id is required", "Validation", {
      retryable: false,
    });
  }
  if (!args.actor) {
    throw new XPublishError("--actor is required", "Validation", {
      retryable: false,
    });
  }
  if (!args.reason || args.reason.trim().length < 3) {
    throw new XPublishError("--reason is required", "Validation", {
      retryable: false,
    });
  }
  if (options?.requireInitialConfirmations !== false) {
    if (!args.confirmAccount || !args.confirmAccount.startsWith("@")) {
      throw new XPublishError(
        "--confirm-account=@username is required",
        "Validation",
        { retryable: false },
      );
    }
    if (!args.confirmTextHash || args.confirmTextHash.length < 16) {
      throw new XPublishError(
        "--confirm-text-hash is required",
        "Validation",
        { retryable: false },
      );
    }
  }
}
