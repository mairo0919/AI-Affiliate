import { createHash } from "node:crypto";
import { assertSafeOutboundUrl, SsrfBlockedError } from "./ssrf.js";
import { safeFetch, type SafeFetchOptions } from "./safe-fetch.js";

const DEFAULT_UA =
  "AI-Affiliate-Factory/1.0 (+research; contact=ops-local; respectful-fetcher)";

export interface SafeFetchTextResult {
  requestedUrl: string;
  finalUrl: string;
  contentType: string;
  text: string;
  bytes: number;
  /** HTTP status when fetch succeeded (non-2xx throw before return). */
  status?: number;
}

export class SafeFetchError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "SafeFetchError";
    this.code = code;
  }
}

/**
 * Fetch text/HTML after SSRF checks. Does not return secrets.
 * Enforces content-type, size limit, User-Agent.
 */
export async function safeFetchText(
  rawUrl: string,
  options: SafeFetchOptions & { userAgent?: string } = {},
): Promise<SafeFetchTextResult> {
  const requested = assertSafeOutboundUrl(rawUrl);
  const maxBytes = options.maxBytes ?? 512_000;
  const headers = new Headers(options.headers);
  if (!headers.has("user-agent")) {
    headers.set("user-agent", options.userAgent ?? DEFAULT_UA);
  }
  if (!headers.has("accept")) {
    headers.set("accept", "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1");
  }

  let response: Response;
  try {
    response = await safeFetch(requested.toString(), {
      ...options,
      headers,
      maxBytes,
    });
  } catch (error) {
    if (error instanceof SsrfBlockedError) throw error;
    const msg = error instanceof Error ? error.message : "fetch failed";
    throw new SafeFetchError("FETCH_FAILED", sanitizeFetchError(msg));
  }

  if (!response.ok) {
    throw new SafeFetchError(
      "HTTP_ERROR",
      `Upstream returned ${response.status}`,
    );
  }

  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (
    contentType &&
    !contentType.includes("text/html") &&
    !contentType.includes("application/xhtml") &&
    !contentType.includes("text/plain")
  ) {
    throw new SafeFetchError(
      "UNSUPPORTED_CONTENT_TYPE",
      `Unsupported content-type: ${contentType.split(";")[0] ?? "unknown"}`,
    );
  }

  const buf = await readLimitedBody(response, maxBytes);
  const text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  const finalUrl = response.url && response.url.length > 0 ? response.url : requested.toString();

  return {
    requestedUrl: requested.toString(),
    finalUrl,
    contentType: contentType.split(";")[0] ?? "text/html",
    text,
    bytes: buf.byteLength,
    status: response.status,
  };
}

export function hashNormalizedContent(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function sanitizeFetchError(message: string): string {
  return message
    .replace(/https?:\/\/[^\s]+/gi, "[url]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .slice(0, 240);
}

async function readLimitedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) {
    const ab = await response.arrayBuffer();
    if (ab.byteLength > maxBytes) {
      throw new SafeFetchError("RESPONSE_TOO_LARGE", `Response exceeds ${maxBytes} bytes`);
    }
    return new Uint8Array(ab);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      throw new SafeFetchError("RESPONSE_TOO_LARGE", `Response exceeds ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}
