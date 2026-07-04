import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COLON_COMMAND_ALIASES,
  DEFAULT_CONFIG,
  createGlmVisionExtension,
  describeImage,
  extractImage,
  hasImageContent,
  loadConfig,
  saveConfig,
} from "../src/index";

const tempDirs: string[] = [];

function tempConfigPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "glm-vision-"));
  tempDirs.push(dir);
  return path.join(dir, "nested", "glm-vision.json");
}

function setupExtension(configPath = tempConfigPath()) {
  const handlers = new Map<string, (...args: any[]) => any>();
  const commands = new Map<string, any>();
  const pi = {
    on: vi.fn((event: string, handler: (...args: any[]) => any) => {
      handlers.set(event, handler);
    }),
    registerCommand: vi.fn((name: string, command: any) => {
      commands.set(name, command);
    }),
  };

  // Isolate the cache alongside the config so tests never read or write
  // the user's real ~/.pi/glm-vision-cache.json. Both files live under the
  // same temp dir, cleaned up by afterEach.
  const cachePath = path.join(path.dirname(configPath), "glm-vision-cache.json");
  createGlmVisionExtension({ configPath, cachePath })(pi as any);
  return { handlers, commands, configPath, cachePath };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("image extraction", () => {
  it("extracts Pi image blocks with source data", () => {
    expect(
      extractImage([
        { type: "text", text: "ignored" },
        { type: "image", source: { data: "abc", mediaType: "image/jpeg" } },
      ]),
    ).toEqual({ base64: "abc", mediaType: "image/jpeg" });
  });

  it("extracts legacy image blocks and data URLs", () => {
    expect(extractImage([{ type: "image", data: "xyz" }])).toEqual({
      base64: "xyz",
      mediaType: "image/png",
    });
    expect(
      extractImage([{ type: "image_url", image_url: { url: "data:image/webp;base64,webpdata" } }]),
    ).toEqual({ base64: "webpdata", mediaType: "image/webp" });
  });

  it("detects image-bearing content", () => {
    expect(hasImageContent([{ type: "text", text: "no image" }])).toBe(false);
    expect(hasImageContent([{ type: "image_url", image_url: { url: "https://example.com/a.png" } }])).toBe(
      true,
    );
  });
});

describe("config", () => {
  it("returns defaults when config is absent or invalid", () => {
    const configPath = tempConfigPath();
    expect(loadConfig(configPath)).toEqual(DEFAULT_CONFIG);

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, "not json");
    expect(loadConfig(configPath)).toEqual(DEFAULT_CONFIG);
  });

  it("reads and writes config while preserving defaults", () => {
    const configPath = tempConfigPath();
    saveConfig({ model: "glm-4.6v-flash", enabled: false }, configPath);

    expect(loadConfig(configPath)).toMatchObject({
      ...DEFAULT_CONFIG,
      model: "glm-4.6v-flash",
      enabled: false,
    });
  });
});

describe("vision API", () => {
  it("sends image data to GLM vision and returns text", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "image description" } }] }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      describeImage(
        { base64: "abc", mediaType: "image/png" },
        "glm-4.6v",
        "describe it",
        "secret",
      ),
    ).resolves.toBe("image description");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.z.ai/api/coding/paas/v4/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer secret" }),
      }),
    );
    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(requestInit.body as string);
    expect(body).toMatchObject({ model: "glm-4.6v", max_tokens: 4096 });
    expect(body.messages[0].content[2].image_url.url).toBe("data:image/png;base64,abc");
  });
});

describe("extension behavior", () => {
  it("falls back to original image when GLM API fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, text: async () => "upstream down" })),
    );
    const { handlers } = setupExtension();
    const imageBlock = { type: "image", data: "abc", mediaType: "image/png" };

    const result = await handlers.get("tool_result")?.(
      { toolName: "read", content: [imageBlock] },
      {
        model: { provider: "zai" },
        modelRegistry: { getApiKeyForProvider: vi.fn(async () => "secret") },
      },
    );

    expect(result.content).toEqual([
      {
        type: "text",
        text: "[glm-vision error: Z.AI service error (HTTP 500). Retried automatically; try again later if it persists: upstream down]",
      },
      imageBlock,
    ]);
  });

  it("does not intercept non-zai models", async () => {
    const { handlers } = setupExtension();

    await expect(
      handlers.get("tool_result")?.(
        { toolName: "read", content: [{ type: "image", data: "abc" }] },
        { model: { provider: "openai" } },
      ),
    ).resolves.toBeUndefined();
  });

  it("handles command status, toggles, model switching, and completions", async () => {
    const { commands, configPath } = setupExtension();
    const command = commands.get("glm-vision");
    const notify = vi.fn();
    const ctx = { ui: { notify } };

    expect(command.getArgumentCompletions("glm-4.6v-f")).toEqual([
      { value: "glm-4.6v-flash", label: "glm-4.6v-flash" },
      { value: "glm-4.6v-flashx", label: "glm-4.6v-flashx" },
    ]);

    await command.handler("", ctx);
    expect(notify.mock.lastCall?.[0]).toContain("glm-vision: ON");
    expect(notify.mock.lastCall?.[0]).toContain("prompt: default");
    expect(notify.mock.lastCall?.[0]).toContain("cache: ON");
    expect(notify.mock.lastCall?.[1]).toBe("info");

    await command.handler("off", ctx);
    expect(loadConfig(configPath).enabled).toBe(false);
    expect(notify).toHaveBeenLastCalledWith("glm-vision: OFF", "info");

    await command.handler("glm-4.6v-flash", ctx);
    expect(loadConfig(configPath)).toMatchObject({ model: "glm-4.6v-flash", enabled: true });
    expect(notify).toHaveBeenLastCalledWith("glm-vision model -> glm-4.6v-flash", "info");

    await command.handler("ocr", ctx);
    expect(loadConfig(configPath)).toMatchObject({ promptMode: "ocr" });
    expect(loadConfig(configPath)).not.toHaveProperty("prompt");
    expect(notify).toHaveBeenLastCalledWith("glm-vision prompt mode -> ocr", "info");

    await command.handler("cache off", ctx);
    expect(loadConfig(configPath).cacheEnabled).toBe(false);
    expect(notify).toHaveBeenLastCalledWith("glm-vision cache: OFF", "info");

    await command.handler("unknown", ctx);
    expect(notify).toHaveBeenLastCalledWith(
      "Unknown command: unknown. Try /glm-vision:model, /glm-vision:mode, or /glm-vision:status.",
      "error",
    );
  });

  it("registers colon flat commands and delegates to the shared handler", async () => {
    const { commands, configPath } = setupExtension();
    const notify = vi.fn();
    const ctx = { ui: { notify } };

    for (const alias of COLON_COMMAND_ALIASES) {
      expect(commands.has(alias.name)).toBe(true);
      expect(commands.get(alias.name)?.description).toContain(alias.description);
    }

    await commands.get("glm-vision:off")?.handler("", ctx);
    expect(loadConfig(configPath).enabled).toBe(false);
    expect(notify).toHaveBeenLastCalledWith("glm-vision: OFF", "info");

    await commands.get("glm-vision:ocr")?.handler("", ctx);
    expect(loadConfig(configPath).promptMode).toBe("ocr");

    await commands.get("glm-vision:prompt-set")?.handler("Describe UI layout", ctx);
    expect(loadConfig(configPath)).toMatchObject({
      promptMode: "custom",
      prompt: "Describe UI layout",
    });

    await commands.get("glm-vision:cache-max")?.handler("42", ctx);
    expect(loadConfig(configPath).cacheMaxEntries).toBe(42);
    expect(notify).toHaveBeenLastCalledWith("glm-vision cache max -> 42", "info");
  });

  it("selects model and prompt mode via colon commands when TUI is available", async () => {
    const { commands, configPath } = setupExtension();
    const notify = vi.fn();
    const select = vi.fn();
    const ctx = { ui: { notify, select }, hasUI: true };

    select.mockResolvedValueOnce("glm-4.6v-flash");
    await commands.get("glm-vision:model")?.handler("", ctx);
    expect(select).toHaveBeenCalledWith("Select vision model", [
      "glm-4.6v",
      "glm-4.6v-flash",
      "glm-4.6v-flashx",
      "glm-5v-turbo",
    ], { signal: undefined });
    expect(loadConfig(configPath)).toMatchObject({ model: "glm-4.6v-flash", enabled: true });
    expect(notify).toHaveBeenLastCalledWith("glm-vision model -> glm-4.6v-flash", "info");

    select.mockResolvedValueOnce("ocr");
    await commands.get("glm-vision:mode")?.handler("", ctx);
    expect(select).toHaveBeenCalledWith("Select prompt preset", [
      "default",
      "ocr",
      "ui",
      "code",
      "diagram",
      "brief",
    ], { signal: undefined });
    expect(loadConfig(configPath)).toMatchObject({ promptMode: "ocr" });
    expect(loadConfig(configPath)).not.toHaveProperty("prompt");
    expect(notify).toHaveBeenLastCalledWith("glm-vision prompt mode -> ocr", "info");
  });

  it("does not collide multi-image cache entries sharing the same first image", async () => {
    // Regression: cache key was derived from images[0] only. Two reads
    // sharing image[0] but differing in image[1] collided, returning the
    // first description for the second request. Key must cover all images.
    const callDescriptions = ["first pair description", "second pair description"];
    let callIndex = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ choices: [{ message: { content: callDescriptions[callIndex++] } }] }),
      })),
    );
    const { handlers } = setupExtension();
    const ctx = {
      model: { provider: "zai" },
      modelRegistry: { getApiKeyForProvider: vi.fn(async () => "secret") },
    };

    // Pair A: shared image, then "a".
    const resultA = await handlers.get("tool_result")?.(
      {
        toolName: "read",
        content: [
          { type: "image", data: "c2hhcmVkLWJ5dGVz", mediaType: "image/png" },
          { type: "image", data: "cGl4ZWxzLWE=", mediaType: "image/png" },
        ],
      },
      ctx,
    );
    expect(resultA.content[0].text).toContain("first pair description");

    // Pair B: SAME first image, different second image "b".
    const resultB = await handlers.get("tool_result")?.(
      {
        toolName: "read",
        content: [
          { type: "image", data: "c2hhcmVkLWJ5dGVz", mediaType: "image/png" },
          { type: "image", data: "cGl4ZWxzLWI=", mediaType: "image/png" },
        ],
      },
      ctx,
    );
    expect(resultB.content[0].text).toContain("second pair description");
    expect(resultB.content[0].text).not.toContain("cache hit");
  });

  it("requires TUI for selection-driven model and mode colon commands", async () => {
    const { commands } = setupExtension();
    const notify = vi.fn();
    const select = vi.fn();
    const ctx = { ui: { notify, select }, hasUI: false };

    await commands.get("glm-vision:model")?.handler("", ctx);
    expect(select).not.toHaveBeenCalled();
    expect(notify).toHaveBeenLastCalledWith(
      "glm-vision:model requires the Pi TUI. In non-interactive mode use /glm-vision <model>.",
      "warning",
    );

    await commands.get("glm-vision:mode")?.handler("", ctx);
    expect(notify).toHaveBeenLastCalledWith(
      "glm-vision:mode requires the Pi TUI. In non-interactive mode use /glm-vision mode <preset>.",
      "warning",
    );
  });
});
