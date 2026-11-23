import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CONFIG,
  PRESET_PROMPTS,
  createGlmVisionExtension,
  loadCache,
  loadConfig,
  makeCacheEntry,
  makeCacheKey,
  pruneCache,
  saveCache,
} from "../src/index";

const tempDirs: string[] = [];

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "glm-vision-response-cache-"));
  tempDirs.push(dir);
  return dir;
}

function tempConfigPath(dir = tempDir()) {
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

  const cachePath = path.join(path.dirname(configPath), "glm-vision-cache.json");
  createGlmVisionExtension({ configPath, cachePath })(pi as any);
  return { handlers, commands, configPath, cachePath };
}

function zaiContext() {
  return {
    model: { provider: "zai" },
    modelRegistry: { getApiKeyForProvider: vi.fn(async () => "secret") },
  };
}

function stubFetch(descriptions: string[]) {
  let index = 0;
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: descriptions[index++] ?? descriptions[descriptions.length - 1] } }] }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const IMAGE_BLOCK = { type: "image", data: "c2FtcGxlLWltYWdlLWJ5dGVz", mediaType: "image/png" };

describe("response cache", () => {
  it("serves a repeated identical request from cache and calls fetch once", async () => {
    const fetchMock = stubFetch(["first description"]);
    const { handlers } = setupExtension();
    const ctx = zaiContext();
    const event = { toolName: "read", content: [IMAGE_BLOCK] };

    const first = await handlers.get("tool_result")?.(event, ctx);
    expect(first.content[0].text).toContain("first description");
    expect(first.content[0].text).not.toContain("cache hit");

    const second = await handlers.get("tool_result")?.(event, ctx);
    expect(second.content[0].text).toContain("cache hit");
    expect(second.content[0].text).toContain("first description");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("misses when the model changes", async () => {
    const fetchMock = stubFetch(["model-a description", "model-b description"]);
    const { handlers, commands } = setupExtension();
    const ctx = { ...zaiContext(), ui: { notify: vi.fn() } };
    const event = { toolName: "read", content: [IMAGE_BLOCK] };

    const first = await handlers.get("tool_result")?.(event, ctx);
    expect(first.content[0].text).toContain("model-a description");

    await commands.get("glm-vision:glm-4.6v-flash")?.handler("", ctx);

    const second = await handlers.get("tool_result")?.(event, ctx);
    expect(second.content[0].text).toContain("model-b description");
    expect(second.content[0].text).not.toContain("cache hit");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("misses when the prompt mode changes", async () => {
    const fetchMock = stubFetch(["default description", "ocr description"]);
    const { handlers, commands } = setupExtension();
    const ctx = { ...zaiContext(), ui: { notify: vi.fn() } };
    const event = { toolName: "read", content: [IMAGE_BLOCK] };

    const first = await handlers.get("tool_result")?.(event, ctx);
    expect(first.content[0].text).toContain("default description");

    await commands.get("glm-vision:ocr")?.handler("", ctx);

    const second = await handlers.get("tool_result")?.(event, ctx);
    expect(second.content[0].text).toContain("ocr description");
    expect(second.content[0].text).not.toContain("cache hit");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not read or write the cache when cacheEnabled is false", async () => {
    const fetchMock = stubFetch(["disabled description", "disabled description 2"]);
    const { handlers, commands, cachePath } = setupExtension();
    const ctx = { ...zaiContext(), ui: { notify: vi.fn() } };

    await commands.get("glm-vision:cache-off")?.handler("", ctx);

    const event = { toolName: "read", content: [IMAGE_BLOCK] };
    const first = await handlers.get("tool_result")?.(event, ctx);
    const second = await handlers.get("tool_result")?.(event, ctx);

    expect(first.content[0].text).toContain("disabled description");
    expect(second.content[0].text).toContain("disabled description 2");
    expect(second.content[0].text).not.toContain("cache hit");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fs.existsSync(cachePath)).toBe(false);
  });

  it("evicts oldest entries when cacheMaxEntries is exceeded", async () => {
    const fetchMock = stubFetch(["desc one", "desc two", "desc three"]);
    const configPath = tempConfigPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ cacheMaxEntries: 2 }));
    const { handlers, cachePath } = setupExtension(configPath);
    const ctx = zaiContext();

    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    await handlers.get("tool_result")?.(
      { toolName: "read", content: [{ type: "image", data: "aW1hZ2Utb25l", mediaType: "image/png" }] },
      ctx,
    );

    vi.setSystemTime(new Date("2026-01-01T00:00:01.000Z"));
    await handlers.get("tool_result")?.(
      { toolName: "read", content: [{ type: "image", data: "aW1hZ2UtdHdv", mediaType: "image/png" }] },
      ctx,
    );

    vi.setSystemTime(new Date("2026-01-01T00:00:02.000Z"));
    await handlers.get("tool_result")?.(
      { toolName: "read", content: [{ type: "image", data: "aW1hZ2UtdGhyZWU=", mediaType: "image/png" }] },
      ctx,
    );

    const cache = loadCache(cachePath);
    const entries = Object.values(cache.entries);
    expect(entries).toHaveLength(2);
    const descriptions = entries.map((e: any) => e.description);
    expect(descriptions).toContain("desc two");
    expect(descriptions).toContain("desc three");
    expect(descriptions).not.toContain("desc one");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("cache-clear empties the cache file", async () => {
    const dir = tempDir();
    const configPath = path.join(dir, "nested", "glm-vision.json");
    const cachePath = path.join(dir, "glm-vision-cache.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });

    // Pre-seed a cache entry.
    saveCache(
      {
        version: 1,
        entries: {
          abc: makeCacheEntry(
            [{ base64: "abc", mediaType: "image/png" }],
            "glm-4.6v",
            "describe it",
            "default",
            "seeded description",
          ),
        },
      } as any,
      cachePath,
    );
    expect(Object.keys(loadCache(cachePath).entries)).toHaveLength(1);

    const handlers = new Map<string, (...args: any[]) => any>();
    const commands = new Map<string, any>();
    const pi = {
      on: (event: string, handler: (...args: any[]) => any) => handlers.set(event, handler),
      registerCommand: (name: string, command: any) => commands.set(name, command),
    };
    createGlmVisionExtension({ configPath, cachePath })(pi as any);

    const notify = vi.fn();
    await commands.get("glm-vision:cache-clear")?.handler("", { ui: { notify } });

    expect(loadCache(cachePath).entries).toEqual({});
    expect(notify).toHaveBeenLastCalledWith("glm-vision cache: cleared", "info");
  });

  it("cache-max persists config and prunes immediately", async () => {
    const dir = tempDir();
    const configPath = path.join(dir, "nested", "glm-vision.json");
    const cachePath = path.join(dir, "glm-vision-cache.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });

    const older = makeCacheEntry([{ base64: "a", mediaType: "image/png" }], "glm-4.6v", "p", "default", "older");
    (older as any).createdAt = "2026-01-01T00:00:00.000Z";
    const middle = makeCacheEntry([{ base64: "b", mediaType: "image/png" }], "glm-4.6v", "p", "default", "middle");
    (middle as any).createdAt = "2026-01-01T00:00:01.000Z";
    const newest = makeCacheEntry([{ base64: "c", mediaType: "image/png" }], "glm-4.6v", "p", "default", "newest");
    (newest as any).createdAt = "2026-01-01T00:00:02.000Z";

    saveCache(
      {
        version: 1,
        entries: { a: older, b: middle, c: newest },
      } as any,
      cachePath,
    );

    const handlers = new Map<string, (...args: any[]) => any>();
    const commands = new Map<string, any>();
    const pi = {
      on: (event: string, handler: (...args: any[]) => any) => handlers.set(event, handler),
      registerCommand: (name: string, command: any) => commands.set(name, command),
    };
    createGlmVisionExtension({ configPath, cachePath })(pi as any);

    const notify = vi.fn();
    await commands.get("glm-vision:cache-max")?.handler("2", { ui: { notify } });

    expect(loadConfig(configPath).cacheMaxEntries).toBe(2);
    const cache = loadCache(cachePath);
    expect(Object.keys(cache.entries)).toHaveLength(2);
    const descriptions = Object.values(cache.entries).map((e: any) => e.description);
    expect(descriptions).toContain("middle");
    expect(descriptions).toContain("newest");
    expect(descriptions).not.toContain("older");
    expect(notify).toHaveBeenLastCalledWith("glm-vision cache max -> 2", "info");
  });

  it("cache-on and cache-off flip cacheEnabled in config", async () => {
    const { commands, configPath } = setupExtension();
    const notify = vi.fn();
    const ctx = { ui: { notify } };

    await commands.get("glm-vision:cache-off")?.handler("", ctx);
    expect(loadConfig(configPath).cacheEnabled).toBe(false);
    expect(notify).toHaveBeenLastCalledWith("glm-vision cache: OFF", "info");

    await commands.get("glm-vision:cache-on")?.handler("", ctx);
    expect(loadConfig(configPath).cacheEnabled).toBe(true);
    expect(notify).toHaveBeenLastCalledWith("glm-vision cache: ON", "info");
  });

  it("treats a corrupt cache file as empty and does not throw", async () => {
    const fetchMock = stubFetch(["recovered description"]);
    const { handlers, cachePath } = setupExtension();
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, "not json");

    const result = await handlers.get("tool_result")?.(
      { toolName: "read", content: [IMAGE_BLOCK] },
      zaiContext(),
    );

    expect(result.content[0].text).toContain("recovered description");
    expect(result.content[0].text).not.toContain("cache hit");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const cache = loadCache(cachePath);
    expect(Object.keys(cache.entries)).toHaveLength(1);
  });

  it("misses a malformed matching row, keeps a legacy neighbor, and prunes safely", async () => {
    const fetchMock = stubFetch(["fresh description"]);
    const { handlers, cachePath } = setupExtension();
    const ctx = zaiContext();
    const neighbor = { ...IMAGE_BLOCK, data: "bmVpZ2hib3I=" };
    const images = (block: typeof IMAGE_BLOCK) => [{ base64: block.data, mediaType: block.mediaType }];
    const { model } = DEFAULT_CONFIG;
    const prompt = PRESET_PROMPTS.default;
    const badKey = makeCacheKey(images(IMAGE_BLOCK), model, prompt);
    const legacyKey = makeCacheKey(images(neighbor), model, prompt);
    const entry = makeCacheEntry(images(neighbor), model, prompt, "default", "legacy description");
    const { createdAt, description, imageHash, mediaType, promptHash, promptMode } = entry;
    const legacy = { createdAt, description, imageHash, mediaType, model, promptHash, promptMode };

    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify({
      version: 1,
      entries: {
        [badKey]: { createdAt },
        [legacyKey]: legacy,
        nullRow: null,
        blankDescription: { ...legacy, description: " \t" },
        numericDescription: { ...legacy, description: 42 },
        invalidTimestamp: { ...legacy, createdAt: "not a date" },
        missingTimestamp: { description },
        numericTimestamp: { ...legacy, createdAt: 0 },
      },
    }));

    const cached = await handlers.get("tool_result")?.({ toolName: "read", content: [neighbor] }, ctx);
    expect(cached.content[0].text).toContain("cache hit");
    expect(cached.content[0].text).toContain("legacy description");
    expect(fetchMock).not.toHaveBeenCalled();

    const fresh = await handlers.get("tool_result")?.({ toolName: "read", content: [IMAGE_BLOCK] }, ctx);
    expect(fresh.content[0].text).toContain("fresh description");
    expect(fresh.content[0].text).not.toContain("cache hit");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Check the persisted file, not a sanitized view from loadCache.
    expect(JSON.parse(fs.readFileSync(cachePath, "utf-8"))).toEqual({
      version: 1,
      entries: {
        [badKey]: expect.objectContaining({ description: "fresh description" }),
        [legacyKey]: legacy,
      },
    });
  });

  it("loadCache returns an empty cache for a corrupt file without throwing", () => {
    const dir = tempDir();
    const cachePath = path.join(dir, "glm-vision-cache.json");
    fs.writeFileSync(cachePath, "not json");
    expect(() => loadCache(cachePath)).not.toThrow();
    expect(loadCache(cachePath)).toEqual({ version: 1, entries: {} });
  });

  it("pruneCache drops malformed rows before keeping the newest entries", () => {
    const cache: any = { version: 1, entries: {} };
    const e1 = makeCacheEntry([{ base64: "a", mediaType: "image/png" }], "m", "p", "default", "old");
    (e1 as any).createdAt = "2026-01-01T00:00:00.000Z";
    const e2 = makeCacheEntry([{ base64: "b", mediaType: "image/png" }], "m", "p", "default", "mid");
    (e2 as any).createdAt = "2026-01-01T00:00:01.000Z";
    const e3 = makeCacheEntry([{ base64: "c", mediaType: "image/png" }], "m", "p", "default", "new");
    (e3 as any).createdAt = "2026-01-01T00:00:02.000Z";
    cache.entries = { nullRow: null, invalidTimestamp: { ...e3, createdAt: "invalid" }, a: e1, b: e2, c: e3 };
    pruneCache(cache, 2);
    expect(cache.entries).toEqual({ c: e3, b: e2 });
  });
});
