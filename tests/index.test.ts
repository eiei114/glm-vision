import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
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

  createGlmVisionExtension({ configPath })(pi as any);
  return { handlers, commands, configPath };
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
      model: "glm-4.6v-flash",
      enabled: false,
      prompt: DEFAULT_CONFIG.prompt,
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
    expect(body.messages[0].content[1].image_url.url).toBe("data:image/png;base64,abc");
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
    ]);

    await command.handler("", ctx);
    expect(notify).toHaveBeenLastCalledWith("glm-vision [ON]: glm-4.6v", "info");

    await command.handler("off", ctx);
    expect(loadConfig(configPath).enabled).toBe(false);
    expect(notify).toHaveBeenLastCalledWith("glm-vision: OFF", "info");

    await command.handler("glm-4.6v-flash", ctx);
    expect(loadConfig(configPath)).toMatchObject({ model: "glm-4.6v-flash", enabled: true });
    expect(notify).toHaveBeenLastCalledWith("glm-vision model → glm-4.6v-flash", "info");

    await command.handler("unknown", ctx);
    expect(notify).toHaveBeenLastCalledWith(
      "Unknown model: unknown. Available: glm-4.6v, glm-4.6v-flash",
      "error",
    );
  });
});
