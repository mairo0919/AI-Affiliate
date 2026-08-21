import { assertSafeOutboundUrl } from "./ssrf.js";

export interface SafeFetchOptions extends RequestInit {
  timeoutMs?: number;
  maxBytes?: number;
}

/**
 * Fetch a remote URL after SSRF checks. For Research source retrieval etc.
 * Does not follow redirects to private hosts (redirect target is re-checked).
 */
export async function safeFetch(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<Response> {
  const url = assertSafeOutboundUrl(rawUrl);
  const timeoutMs = options.timeoutMs ?? 15_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      redirect: "manual",
      signal: options.signal ?? controller.signal,
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new Error("Redirect without Location");
      }
      const next = new URL(location, url);
      assertSafeOutboundUrl(next.toString());
      return safeFetch(next.toString(), { ...options, redirect: "manual" });
    }
    return response;
  } finally {
    clearTimeout(timer);
  }
}
