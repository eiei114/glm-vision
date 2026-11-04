import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG, createGlmVisionExtension, loadConfig } from "../src/index";

/**
 * Regression cover for the documented malformed-config contract in
 * docs/usage.md: "If the config JSON is invalid, not an object, has invalid
 * field types, names an unavailable vision model, or names an unavailable
 * prompt mode, glm-vision leaves the original image attached and returns an
 * actionable config warning instead of crashing."
 *
 * Before this file the `configWarning` branch of the tool_result handler and
 * its `session_start` reset had no assertions at all, so the documented
 * behaviour could regress silently.
 */

const tempDirs: string[] = [];

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "glm-vision-config-warning-"));
  tempDirs.push(dir);
  return dir;
}

const IMAGE_BLOCK = { type: "image", data: "cHJlc2VydmVkLWJ5dGVz", mediaType: "image/png" };
const SECOND_BLOCK = { type: "image", data: "c2Vjb25kLWJ5dGVz", mediaType: "image/jpeg" };

function setupExtension(rawConfig: string) {
  const dir = tempDir();
  const configPath = path.join(dir, "nested", "glm-vision.json");
  const cachePath = path.join(dir, "glm-vision-cache.json");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, rawConfig);

  const handlers = new Map<string, (...args: any[]) => any>();
  const commands = new Map<string, any>();
  const pi = {
    on: (event: string, handler: (...args: any[]) => any) => {
      handlers.set(event, handler);
    },
    registerCommand: (name: string, command: any) => {
      commands.set(name, command);
    },
  };
  createGlmVisionExtension({ configPath, cachePath })(pi as any);

  return { handlers, commands, configPath, cachePath };
}

function zaiContext() {
  return {
    model: { provider: "zai" },
    modelRegistry: { getApiKeyForProvider: vi.fn(async () => "secret") },
  };
}

function stubSuccessfulFetch(description: string) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: description } }] }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const MALFORMED_CONFIGS = [
  {
    case: "invalid JSON text",
    raw: "{ this is not json",
    warningPattern: /Could not read .*glm-vision\.json/,
    remedyPattern: /Using defaults\./,
    fallsBackTo: {},
  },
  {
    case: "JSON array instead of an object",
    raw: JSON.stringify([{ model: "glm-4.6v" }]),
    warningPattern: /must be a JSON object/,
    remedyPattern: /Using defaults\./,
    fallsBackTo: {},
  },
  {
    case: "non-string prompt field",
    raw: JSON.stringify({ prompt: 42 }),
    warningPattern: /prompt must be a string/,
    remedyPattern: /Using the active preset prompt\./,
    fallsBackTo: {},
  },
  {
    case: "unavailable model name",
    raw: JSON.stringify({ model: "gpt-4o" }),
    warningPattern: /Unknown model "gpt-4o"\. Available: glm-4\.6v, glm-4\.6v-flash/,
    remedyPattern: /Using glm-4\.6v\./,
    fallsBackTo: { model: "glm-4.6v" },
  },
  {
    case: "unavailable prompt mode",
    raw: JSON.stringify({ promptMode: "hollywood" }),
    warningPattern: /Unknown promptMode "hollywood"/,
    remedyPattern: /Using default\./,
    fallsBackTo: { promptMode: "default" },
  },
] as const;

describe("malformed config warnings", () => {
  it.each(MALFORMED_CONFIGS)(
    "returns an actionable warning and keeps the images for $case",
    async ({ raw, warningPattern, remedyPattern, fallsBackTo }) => {
      const { handlers, configPath } = setupExtension(raw);
      const fetchMock = stubSuccessfulFetch("should not be called");

      const result = await handlers.get("tool_result")?.({
        toolName: "read",
        content: [IMAGE_BLOCK, SECOND_BLOCK],
      }, zaiContext());

      const [warningBlock, ...preserved] = result.content;
      expect(warningBlock.type).toBe("text");
      expect(warningBlock.text).toMatch(/^\[glm-vision config warning: /);
      expect(warningBlock.text).toContain(configPath);
      expect(warningBlock.text).toMatch(warningPattern);
      expect(warningBlock.text).toMatch(remedyPattern);

      // The original images must survive untouched so the user can still see them.
      expect(preserved).toEqual([IMAGE_BLOCK, SECOND_BLOCK]);

      // A malformed config must warn first, never spend a vision API call.
      expect(fetchMock).not.toHaveBeenCalled();

      // The reported defaults are the real resolved config, not just text.
      expect(loadConfig(configPath)).toEqual({ ...DEFAULT_CONFIG, ...fallsBackTo });
    },
  );

  it("keeps warning on every read instead of warning only once", async () => {
    const { handlers } = setupExtension(JSON.stringify({ model: "gpt-4o" }));
    const fetchMock = stubSuccessfulFetch("should not be called");
    const event = { toolName: "read", content: [IMAGE_BLOCK] };

    const first = await handlers.get("tool_result")?.(event, zaiContext());
    const second = await handlers.get("tool_result")?.(event, zaiContext());

    expect(first.content[0].text).toContain("config warning");
    expect(second.content[0].text).toContain("config warning");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports the warning in status at warning level", async () => {
    const { commands, configPath } = setupExtension(JSON.stringify({ cacheMaxEntries: -1 }));
    const notify = vi.fn();

    await commands.get("glm-vision:status")?.handler("", { ui: { notify } });

    const [text, level] = notify.mock.lastCall ?? [];
    expect(level).toBe("warning");
    expect(text).toContain(`warning: Invalid ${configPath}: cacheMaxEntries must be a positive integer.`);
    // Documented fallbacks still apply alongside the warning.
    expect(text).toContain("cache: ON (0 entries, max 100)");
  });

  it("clears the warning after session_start reloads a repaired config", async () => {
    const { handlers, commands, configPath } = setupExtension("{ broken");
    const fetchMock = stubSuccessfulFetch("a repaired description");
    const event = { toolName: "read", content: [IMAGE_BLOCK] };

    const warned = await handlers.get("tool_result")?.(event, zaiContext());
    expect(warned.content[0].text).toContain("config warning");
    expect(fetchMock).not.toHaveBeenCalled();

    fs.writeFileSync(configPath, JSON.stringify({ enabled: true, cacheEnabled: false }));
    await handlers.get("session_start")?.();

    const reloaded = await handlers.get("tool_result")?.(event, zaiContext());

    expect(reloaded.content).toEqual([
      { type: "text", text: "[glm-vision: glm-4.6v | images: 1]\n\na repaired description" },
    ]);
    expect(JSON.stringify(reloaded)).not.toContain("config warning");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const notify = vi.fn();
    await commands.get("glm-vision:status")?.handler("", { ui: { notify } });
    expect(notify.mock.lastCall?.[1]).toBe("info");
    expect(notify.mock.lastCall?.[0]).not.toContain("warning:");
  });

  it("returns a warning, not a crash, when the config file is unreadable as JSON after a save", async () => {
    // `saveConfig` writes normalized JSON; an invalid override must still
    // surface as a warning on the next read rather than throwing.
    const { handlers, configPath } = setupExtension("{}");
    fs.writeFileSync(configPath, "{ truncated");
    await handlers.get("session_start")?.();

    const result = await handlers.get("tool_result")?.(
      { toolName: "read", content: [IMAGE_BLOCK] },
      zaiContext(),
    );

    expect(result.content[0].text).toMatch(/^\[glm-vision config warning: Could not read /);
    expect(result.content.slice(1)).toEqual([IMAGE_BLOCK]);
  });
});
