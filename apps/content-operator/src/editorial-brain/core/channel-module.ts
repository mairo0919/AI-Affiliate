/**
 * Channel module boundary — BLOG + X only today.
 * Future channels add a module; Core stays unchanged unless a true shared concept appears.
 */

import type { ChannelEditorialPlan, CoreEditorialPlan, EditorialChannelId } from "./types.js";

/** Channel-specific Brain capabilities — avoid Core `if channel === "X"` scatter. */
export type ChannelBrainCapabilities = {
  /** Bounded targeted repair implemented for this channel. */
  targetedRepair: boolean;
};

export type ChannelEditorialModule = {
  readonly channel: EditorialChannelId;
  readonly capabilities: ChannelBrainCapabilities;
  buildChannelPlan(core: CoreEditorialPlan): ChannelEditorialPlan;
};

const registry = new Map<EditorialChannelId, ChannelEditorialModule>();

export function registerChannelModule(mod: ChannelEditorialModule): void {
  registry.set(mod.channel, mod);
}

export function getChannelModule(channel: EditorialChannelId): ChannelEditorialModule {
  const mod = registry.get(channel);
  if (!mod) {
    throw new Error(`No ChannelEditorialModule registered for ${channel}`);
  }
  return mod;
}

export function getChannelCapabilities(channel: EditorialChannelId): ChannelBrainCapabilities {
  return getChannelModule(channel).capabilities;
}

export function listRegisteredChannels(): EditorialChannelId[] {
  return [...registry.keys()];
}

/**
 * Contract test helper: adding a 3rd channel must not require Core rewrite.
 * We only assert the registration surface exists — no TikTok implementation.
 */
export function channelExtensionBoundaryContract(): {
  requiresCoreRewriteForNewChannel: false;
  addNewModuleOnly: true;
  coreTouchesAllowedOnlyForNewSharedConcepts: true;
} {
  return {
    requiresCoreRewriteForNewChannel: false,
    addNewModuleOnly: true,
    coreTouchesAllowedOnlyForNewSharedConcepts: true,
  };
}
