import { getEventListeners } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_REQUEST_TIMEOUT_MS, describeImage, describeImages } from "../src/index";

/**
 * Contract cover for the retry loop (`fetchWithRetry`, `MAX_ATTEMPTS = 3`,
 * `RETRY_BASE_DELAY_MS = 500`) and the user-facing error mapping
 * (`explainHttpError`, `explainFetchError`, `readErrorBody`) documented in
 * docs/usage.md: "Transient failures (408, 409, 425, 429, and 5xx) are retried
 * up to 3 total attempts with exponential backoff (500ms, then 1000ms).
 * Authentication, model-access, invalid JSON, and empty-response failures
 * return clear glm-vision error messages while preserving the original image
 * content."
 *
 * Only `tests/index.test.ts` covered the "every attempt returns HTTP 500" path
 * before this file, so a refactor of the retry loop or the message text could
 * silently change what users see when Z.AI misbehaves.
 *
 * All backoff runs on fake timers: `advanceTimersByTimeAsync` drives the
 * `sleep()` between attempts and `Date.now()` reports the fake clock, which
 * pins the 500ms/1000ms schedule without waiting for real delays.
 */

const MODEL = "glm-4.6v";
const PROMPT = "describe it";
const API_KEY = "secret";
const IMAGES = [{ base64: "YWJj", mediaType: "image/png", index: 1, label: "Image 1" }];

type FetchLike = (url: string, init: RequestInit) => any;

function okResponse(content: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
    text: async () => JSON.stringify({ choices: [{ message: { content } }] }),
  };
}

function errorResponse(status: number, body: string) {
  return {
    ok: false,
    status,
    json: async () => JSON.parse(body),
    text: async () => body,
  };
}

/** Stub global fetch and record the fake-clock timestamp of every attempt. */
function stubFetch(handler: FetchLike) {
  const callTimes: number[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    callTimes.push(Date.now());
    return handler(url, init);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, callTimes };
}

/** Round-trip a status sequence; the last entry repeats once exhausted. */
function stubStatusSequence(statuses: number[], body = "upstream failure") {
  let index = 0;
  return stubFetch(() => {
    const status = statuses[Math.min(index, statuses.length - 1)];
    index += 1;
    return status === 200 ? okResponse("image description") : errorResponse(status, body);
  });
}

/**
 * Pump fake timers until the promise settles. Vitest flushes microtasks
 * between timer ticks, so each backoff timer is exercised but no wall-clock
 * time is spent. The outcome is recorded inside synchronous handlers so a
 * rejection never escapes as an unhandled rejection.
 */
async function settle<T>(promise: Promise<T>, stepMs = 500): Promise<T> {
  const outcome: { done: boolean; error?: Error; value?: T } = { done: false };
  promise.then(
    (value) => {
      outcome.done = true;
      outcome.value = value;
    },
    (error: Error) => {
      outcome.done = true;
      outcome.error = error;
    },
  );

  for (let i = 0; i < 400 && !outcome.done; i += 1) {
    await vi.advanceTimersByTimeAsync(stepMs);
  }

  expect(outcome.done).toBe(true);
  if (outcome.error) throw outcome.error;
  return outcome.value as T;
}

async function runDescribe(options: { signal?: AbortSignal; requestTimeoutMs?: number } = {}) {
  return settle(
    describeImages(
      IMAGES,
      MODEL,
      PROMPT,
      API_KEY,
      0,
      options.signal,
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    ),
  );
}

async function captureError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected the promise to reject");
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("retryable statuses", () => {
  it.each([429, 503])("retries HTTP %i once and returns the description", async (status) => {
    const { fetchMock, callTimes } = stubStatusSequence([status, 200]);

    const description = await runDescribe();

    expect(description).toBe("image description");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Backoff before the second attempt is RETRY_BASE_DELAY_MS (500ms).
    expect(callTimes[1] - callTimes[0]).toBe(500);
  });

  it.each([
    [408, "Z.AI request failed (HTTP 408): upstream failure"],
    [409, "Z.AI request failed (HTTP 409): upstream failure"],
    [425, "Z.AI request failed (HTTP 425): upstream failure"],
    [429, "Z.AI rate limited the request (HTTP 429). Try again later: upstream failure"],
    [500, "Z.AI service error (HTTP 500). Retried automatically; try again later if it persists: upstream failure"],
    [502, "Z.AI service error (HTTP 502). Retried automatically; try again later if it persists: upstream failure"],
    [503, "Z.AI service error (HTTP 503). Retried automatically; try again later if it persists: upstream failure"],
  ])("retries HTTP %i three times, then surfaces the mapped error", async (status, expected) => {
    const { fetchMock, callTimes } = stubStatusSequence([status]);

    const error = await captureError(runDescribe());

    expect(fetchMock).toHaveBeenCalledTimes(3);
    // Exponential backoff: 500ms between attempt 1 and 2, 1000ms between 2 and 3.
    expect(callTimes[1] - callTimes[0]).toBe(500);
    expect(callTimes[2] - callTimes[1]).toBe(1000);
    expect(error.message).toBe(expected);
  });
});

describe("non-retryable statuses", () => {
  it.each([401, 403])("does not retry HTTP %i and reports the API key", async (status) => {
    const { fetchMock } = stubStatusSequence([status], "unauthorized");

    const error = await captureError(runDescribe());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(error.message).toBe(
      `Z.AI rejected the zai API key (HTTP ${status}). Reauthenticate or update the zai provider API key in Pi: unauthorized`,
    );
  });

  it.each([400, 404])("does not retry HTTP %i and names the model with a switch hint", async (status) => {
    const { fetchMock } = stubStatusSequence([status], "no such model");

    const error = await captureError(runDescribe());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(error.message).toContain(`Z.AI rejected model "${MODEL}" (HTTP ${status})`);
    // Every available model is offered as a `/glm-vision:<model>` colon command.
    expect(error.message).toContain("/glm-vision:glm-4.6v");
    expect(error.message).toContain("/glm-vision:glm-4.6v-flash");
    expect(error.message).toContain("/glm-vision:glm-5v-turbo");
    expect(error.message).toContain("check your Coding Plan access");
    expect(error.message).toContain("no such model");
  });
});

describe("error body parsing", () => {
  it("prefers error.message from a JSON body over the raw text", async () => {
    const { fetchMock } = stubStatusSequence([401], JSON.stringify({ error: { message: "API key revoked" } }));

    const error = await captureError(runDescribe());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(error.message).toBe(
      "Z.AI rejected the zai API key (HTTP 401). Reauthenticate or update the zai provider API key in Pi: API key revoked",
    );
    expect(error.message).not.toContain('{"error"');
  });

  it("falls back to message then to the raw body text", async () => {
    const topLevel = await captureError(
      (() => {
        stubStatusSequence([400], JSON.stringify({ message: "model not enabled" }));
        return runDescribe();
      })(),
    );
    expect(topLevel.message).toContain(": model not enabled");
    expect(topLevel.message).not.toContain('{"message"');

    const raw = await captureError(
      (() => {
        stubStatusSequence([400], "plain text failure");
        return runDescribe();
      })(),
    );
    expect(raw.message).toContain(": plain text failure");
  });

  it("truncates very long error bodies to 500 characters", async () => {
    const longBody = "x".repeat(900);
    const { fetchMock } = stubStatusSequence([400], longBody);

    const error = await captureError(runDescribe());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(error.message).toContain(`: ${"x".repeat(500)}`);
    expect(error.message).not.toContain("x".repeat(501));
  });
});

describe("timeout and cancellation", () => {
  it("maps a fetch AbortError rejection to the timeout message", async () => {
    const abortError = new Error("This operation was aborted");
    abortError.name = "AbortError";
    const { fetchMock } = stubFetch(() => Promise.reject(abortError));

    const error = await captureError(runDescribe({ requestTimeoutMs: 5_000 }));

    // `requestTimeoutMs` is what the message reports, rounded to seconds.
    expect(error.message).toContain("Z.AI request timed out after 5s");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("aborts a hanging request after the per-attempt timeout", async () => {
    const { fetchMock, callTimes } = stubFetch(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          const signal = init.signal!;
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    );

    const error = await captureError(runDescribe({ requestTimeoutMs: 30_000 }));

    expect(error.message).toContain("Z.AI request timed out after 30s");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // Each attempt burns its own 30s timeout, then waits 500ms / 1000ms.
    expect(callTimes[1] - callTimes[0]).toBe(30_000 + 500);
    expect(callTimes[2] - callTimes[1]).toBe(30_000 + 1_000);
  });

  it("recovers from one timed-out attempt with a fresh signal", async () => {
    const requestTimeoutMs = 2_000;
    const attempts: { signal: AbortSignal; abortedAtStart: boolean }[] = [];
    const { fetchMock, callTimes } = stubFetch((_url, init) => {
      const signal = init.signal!;
      attempts.push({ signal, abortedAtStart: signal.aborted });
      if (attempts.length === 1) {
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      }
      return okResponse("recovered image description");
    });

    await expect(runDescribe({ requestTimeoutMs })).resolves.toBe("recovered image description");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(callTimes[1] - callTimes[0]).toBe(requestTimeoutMs + 500);
    expect(attempts[0].abortedAtStart).toBe(false);
    expect(attempts[0].signal.aborted).toBe(true);
    expect(attempts[1].signal).not.toBe(attempts[0].signal);
    expect(attempts[1].abortedAtStart).toBe(false);
  });

  it("does not retry an already-aborted caller signal and reports cancellation", async () => {
    const caller = new AbortController();
    caller.abort();
    const abortError = new Error("This operation was aborted");
    abortError.name = "AbortError";
    const { fetchMock } = stubFetch(() => Promise.reject(abortError));

    const error = await captureError(runDescribe({ signal: caller.signal }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    // A caller abort must not be reported as a timeout, even though both
    // surface as an AbortError.
    expect(error.message).toBe("Z.AI request was cancelled");
  });

  it("removes completed backoff listeners from the caller signal", async () => {
    const caller = new AbortController();
    const { fetchMock } = stubStatusSequence([503, 503, 200]);
    const description = describeImages(IMAGES, MODEL, PROMPT, API_KEY, 0, caller.signal);

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getEventListeners(caller.signal, "abort")).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(500);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Only the second backoff should still be listening.
    expect(getEventListeners(caller.signal, "abort")).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1000);
    await expect(description).resolves.toBe("image description");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(getEventListeners(caller.signal, "abort")).toHaveLength(0);
  });

  it("reports cancellation and stops retrying when the caller aborts during backoff", async () => {
    const caller = new AbortController();
    const { fetchMock } = stubStatusSequence([503]);

    // Call describeImages directly so the first backoff timer does not fire
    // before the abort below.
    const promise = describeImages(IMAGES, MODEL, PROMPT, API_KEY, 0, caller.signal);
    const settled = captureError(promise);

    // Let the first attempt finish and enter its 500ms backoff.
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    caller.abort();

    expect(vi.getTimerCount()).toBe(0);
    expect(getEventListeners(caller.signal, "abort")).toHaveLength(0);
    expect((await settled).message).toBe("Z.AI request was cancelled");

    await vi.advanceTimersByTimeAsync(1500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries generic network failures and surfaces the last message", async () => {
    const { fetchMock } = stubFetch(() => Promise.reject(new Error("socket hang up")));

    const error = await captureError(runDescribe());

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(error.message).toContain("Z.AI network request failed: socket hang up");
  });
});

describe("response body handling", () => {
  it.each(["", "   "])("raises the empty-response error for content %j", async (content) => {
    const { fetchMock } = stubFetch(() => okResponse(content));

    const error = await captureError(runDescribe());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(error.message).toBe(
      "Z.AI returned an empty response. The original image was left attached; try again or switch models with colon commands (e.g. /glm-vision:glm-4.6v).",
    );
  });

  it("keeps describeImage on the same retry contract", async () => {
    const { fetchMock } = stubStatusSequence([429, 200]);

    await expect(
      settle(describeImage({ base64: "YWJj", mediaType: "image/png" }, MODEL, PROMPT, API_KEY)),
    ).resolves.toBe("image description");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
