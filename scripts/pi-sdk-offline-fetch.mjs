import { appendFileSync } from "node:fs";

const TARGET_URL = "https://api.z.ai/api/coding/paas/v4/chat/completions";
let originalFetch = globalThis.fetch.bind(globalThis);

const offlineFetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url !== TARGET_URL) {
    const hostname = new URL(url).hostname;
    if (hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]" || hostname === "::1") {
      return originalFetch(input, init);
    }
    throw new Error("Pi SDK offline smoke blocked an external network request");
  }

  const body = JSON.parse(String(init?.body ?? "{}"));
  const authorization = new Headers(init?.headers).get("authorization");
  const imageCount = Array.isArray(body.messages?.[0]?.content)
    ? body.messages[0].content.filter((part) => part.type === "image_url").length
    : 0;
  appendFileSync(
    process.env.PI_SMOKE_VISION_LOG,
    `${JSON.stringify({
      model: body.model,
      image_count: imageCount,
      fixture_mode: process.env.PI_SMOKE_VISION_MODE,
      authorization_configured: authorization === "Bearer offline-smoke-key",
    })}\n`,
  );

  if (process.env.PI_SMOKE_VISION_MODE === "error") {
    return new Response(JSON.stringify({ error: { message: "offline fixture failure" } }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({ choices: [{ message: { content: "SMOKE_VISION_DESCRIPTION" } }] }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
};

Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  enumerable: true,
  get() {
    return offlineFetch;
  },
  set(fetchImplementation) {
    if (fetchImplementation !== offlineFetch && typeof fetchImplementation === "function") {
      originalFetch = fetchImplementation.bind(globalThis);
    }
  },
});
