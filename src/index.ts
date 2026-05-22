import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// Config
const CONFIG_PATH = path.join(os.homedir(), ".pi", "glm-vision.json");
const CACHE_PATH = path.join(os.homedir(), ".pi", "glm-vision-cache.json");
const BASE_URL = "https://api.z.ai/api/coding/paas/v4";
const DEFAULT_CACHE_MAX_ENTRIES = 100;

const PRESET_PROMPTS = {
  default:
    "Describe this image in detail. If it contains text, transcribe it exactly. If it shows code, reproduce the code. If it shows a UI, describe the layout and elements. Respond in the same language as any text in the image.",
  ocr:
    "Transcribe all visible text exactly. Preserve line breaks, ordering, punctuation, and layout as much as possible. If text is unclear, mark it as [unclear]. Do not summarize unless needed to explain ambiguous layout.",
  ui:
    "Analyze this user interface screenshot. Describe the layout, visual hierarchy, controls, labels, states, navigation, and any notable UX issues. Include exact visible text when relevant.",
  code:
    "Extract and reproduce any visible code exactly. Identify the language if possible, preserve indentation, and mention file names, line numbers, errors, or UI context visible in the image.",
  diagram:
    "Explain this diagram. Identify nodes, labels, arrows, relationships, flow direction, legends, and any implied process. Summarize the core idea after describing the structure.",
  brief:
    "Briefly describe the image in 2-4 concise sentences. Include important text, UI state, code error, or diagram meaning if present.",
} as const;

type PromptMode = keyof typeof PRESET_PROMPTS | "custom";

interface VisionConfig {
  model: string;
  prompt?: string;
  promptMode?: PromptMode;
  enabled?: boolean;
  cacheEnabled?: boolean;
  cacheMaxEntries?: number;
}

interface CacheEntry {
  createdAt: string;
  description: string;
  imageHash: string;
  mediaType: string;
  model: string;
  promptHash: string;
  promptMode: PromptMode;
}

interface CacheFile {
  version: 1;
  entries: Record<string, CacheEntry>;
}

const DEFAULT_CONFIG: VisionConfig = {
  model: "glm-4.6v",
  promptMode: "default",
  enabled: true,
  cacheEnabled: true,
  cacheMaxEntries: DEFAULT_CACHE_MAX_ENTRIES,
};

const MODELS = ["glm-4.6v", "glm-4.6v-flash"];
const PRESET_NAMES = Object.keys(PRESET_PROMPTS) as Array<keyof typeof PRESET_PROMPTS>;

function ensureConfigDir() {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
}

function normalizeConfig(raw: Partial<VisionConfig>): VisionConfig {
  const merged: VisionConfig = { ...DEFAULT_CONFIG, ...raw };
  if (raw.prompt && !raw.promptMode) merged.promptMode = "custom";
  if (!merged.promptMode) merged.promptMode = "default";
  if (merged.promptMode !== "custom" && !PRESET_NAMES.includes(merged.promptMode as any)) {
    merged.promptMode = "default";
  }
  if (!MODELS.includes(merged.model)) merged.model = DEFAULT_CONFIG.model;
  if (!Number.isFinite(merged.cacheMaxEntries) || (merged.cacheMaxEntries || 0) < 1) {
    merged.cacheMaxEntries = DEFAULT_CACHE_MAX_ENTRIES;
  }
  return merged;
}

function loadConfig(): VisionConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    return normalizeConfig(raw);
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(c: VisionConfig) {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(normalizeConfig(c), null, 2));
}

function loadCache(): CacheFile {
  try {
    const raw = JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8"));
    if (raw?.version === 1 && raw.entries && typeof raw.entries === "object") return raw;
  } catch {
    // Empty or invalid cache: start fresh.
  }
  return { version: 1, entries: {} };
}

function saveCache(cache: CacheFile) {
  ensureConfigDir();
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
}

function hash(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function getActivePrompt(c: VisionConfig): string {
  if (c.promptMode === "custom") return c.prompt || PRESET_PROMPTS.default;
  return PRESET_PROMPTS[(c.promptMode || "default") as keyof typeof PRESET_PROMPTS] || PRESET_PROMPTS.default;
}

function getPromptLabel(c: VisionConfig): PromptMode {
  return c.promptMode || "default";
}

function makeCacheKey(img: ImageData, model: string, prompt: string): string {
  const imageHash = hash(Buffer.from(img.base64, "base64"));
  return hash(JSON.stringify({ imageHash, mediaType: img.mediaType, model, prompt }));
}

function makeCacheEntry(img: ImageData, model: string, prompt: string, mode: PromptMode, description: string): CacheEntry {
  return {
    createdAt: new Date().toISOString(),
    description,
    imageHash: hash(Buffer.from(img.base64, "base64")),
    mediaType: img.mediaType,
    model,
    promptHash: hash(prompt),
    promptMode: mode,
  };
}

function pruneCache(cache: CacheFile, maxEntries: number) {
  const entries = Object.entries(cache.entries).sort(
    ([, a], [, b]) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
  cache.entries = Object.fromEntries(entries.slice(0, maxEntries));
}

function cacheStats(): { entries: number; path: string } {
  return { entries: Object.keys(loadCache().entries).length, path: CACHE_PATH };
}

function clearCache() {
  saveCache({ version: 1, entries: {} });
}

function statusText(c: VisionConfig): string {
  const stats = cacheStats();
  const prompt = getActivePrompt(c);
  return [
    `glm-vision: ${c.enabled !== false ? "ON" : "OFF"}`,
    `model: ${c.model}`,
    `prompt: ${getPromptLabel(c)}`,
    `cache: ${c.cacheEnabled !== false ? "ON" : "OFF"} (${stats.entries} entries, max ${c.cacheMaxEntries})`,
    `config: ${CONFIG_PATH}`,
    `cache file: ${stats.path}`,
    `active prompt: ${prompt}`,
  ].join("\n");
}

// Image extraction
interface ImageData {
  base64: string;
  mediaType: string;
}

function extractImage(content: any[]): ImageData | null {
  for (const block of content) {
    if (block.type === "image" && block.source?.data) {
      return { base64: block.source.data, mediaType: block.source.mediaType || "image/png" };
    }
    if (block.type === "image" && block.data) {
      return { base64: block.data, mediaType: block.mediaType || "image/png" };
    }
    if (block.type === "image_url" && block.image_url?.url?.startsWith("data:")) {
      const match = block.image_url.url.match(/^data:(image\/\w+);base64,(.+)$/s);
      if (match) return { base64: match[2], mediaType: match[1] };
    }
  }
  return null;
}

function hasImageContent(content: any[]): boolean {
  return content.some((b) => b.type === "image" || b.type === "image_url");
}

// Vision API call
async function describeImage(
  img: ImageData,
  model: string,
  prompt: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<string> {
  const url = `${BASE_URL}/chat/completions`;
  const dataUrl = `data:${img.mediaType};base64,${img.base64}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      max_tokens: 4096,
    }),
    signal,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${res.status} ${err}`);
  }

  const json = (await res.json()) as any;
  return json.choices?.[0]?.message?.content || "[glm-vision: empty response]";
}

// Extension
export default function (pi: ExtensionAPI) {
  let config = loadConfig();

  // Reload config on session start.
  pi.on("session_start", async () => {
    config = loadConfig();
  });

  // Intercept read tool results containing images (zai provider only).
  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName !== "read") return;
    if (config.enabled === false) return;

    // Only activate when using zai provider.
    const currentModel = ctx.model;
    if (!currentModel || currentModel.provider !== "zai") return;

    const content = event.content as any[];
    if (!Array.isArray(content) || !hasImageContent(content)) return;

    const img = extractImage(content);
    if (!img) return;

    const prompt = getActivePrompt(config);
    const promptMode = getPromptLabel(config);
    const cacheKey = makeCacheKey(img, config.model, prompt);

    if (config.cacheEnabled !== false) {
      const cache = loadCache();
      const hit = cache.entries[cacheKey];
      if (hit) {
        return {
          content: [
            {
              type: "text",
              text: `[glm-vision: ${config.model}, prompt=${promptMode}, cache hit]\n\n${hit.description}`,
            },
          ],
        };
      }
    }

    // Get API key from pi's model registry (same auth as main zai provider).
    let apiKey: string | undefined;
    try {
      apiKey = await (ctx as any).modelRegistry?.getApiKeyForProvider?.("zai");
    } catch {
      // fall through
    }

    if (!apiKey) {
      return {
        content: [
          {
            type: "text",
            text: "[glm-vision error: no zai API key found. Check your zai authentication.]",
          },
          ...content.filter((b: any) => b.type === "image" || b.type === "image_url"),
        ],
      };
    }

    try {
      const description = await describeImage(img, config.model, prompt, apiKey, ctx.signal);
      if (config.cacheEnabled !== false) {
        const cache = loadCache();
        cache.entries[cacheKey] = makeCacheEntry(img, config.model, prompt, promptMode, description);
        pruneCache(cache, config.cacheMaxEntries || DEFAULT_CACHE_MAX_ENTRIES);
        saveCache(cache);
      }
      return {
        content: [
          {
            type: "text",
            text: `[glm-vision: ${config.model}, prompt=${promptMode}, cache miss]\n\n${description}`,
          },
        ],
      };
    } catch (err: any) {
      return {
        content: [
          {
            type: "text",
            text: `[glm-vision error: ${err.message}]`,
          },
          ...content.filter((b: any) => b.type === "image" || b.type === "image_url"),
        ],
      };
    }
  });

  // /glm-vision command
  pi.registerCommand("glm-vision", {
    description: `Configure GLM vision model, prompt presets, and response cache. Try "status", "ocr", "cache clear", "prompt <text>", "reset".`,
    getArgumentCompletions(prefix: string) {
      const options = [
        "status",
        "on",
        "off",
        "reset",
        "prompt",
        "cache on",
        "cache off",
        "cache clear",
        "cache status",
        "cache max ",
        ...MODELS,
        ...PRESET_NAMES,
        ...PRESET_NAMES.map((m) => `mode ${m}`),
      ];
      return options
        .filter((m) => m.startsWith(prefix))
        .map((m) => ({ value: m, label: m }));
    },
    handler: async (args, ctx) => {
      const trimmed = (args || "").trim();
      const [command, ...rest] = trimmed.split(/\s+/).filter(Boolean);

      if (!trimmed || command === "status") {
        ctx.ui.notify(statusText(config), "info");
        return;
      }

      if (command === "on") {
        config.enabled = true;
        saveConfig(config);
        ctx.ui.notify(`glm-vision: ON (${config.model})`, "info");
        return;
      }

      if (command === "off") {
        config.enabled = false;
        saveConfig(config);
        ctx.ui.notify("glm-vision: OFF", "info");
        return;
      }

      if (command === "reset") {
        config = { ...DEFAULT_CONFIG };
        saveConfig(config);
        ctx.ui.notify("glm-vision: reset to defaults", "info");
        return;
      }

      if (command === "prompt") {
        const nextPrompt = rest.join(" ").trim();
        if (!nextPrompt) {
          ctx.ui.notify(getActivePrompt(config), "info");
          return;
        }
        config.prompt = nextPrompt;
        config.promptMode = "custom";
        saveConfig(config);
        ctx.ui.notify("glm-vision prompt: custom prompt saved", "info");
        return;
      }

      if (command === "mode") {
        const mode = rest[0] as keyof typeof PRESET_PROMPTS | undefined;
        if (mode && PRESET_NAMES.includes(mode)) {
          config.promptMode = mode;
          config.prompt = undefined;
          saveConfig(config);
          ctx.ui.notify(`glm-vision prompt mode -> ${mode}`, "info");
        } else {
          ctx.ui.notify(`Unknown prompt mode. Available: ${PRESET_NAMES.join(", ")}`, "error");
        }
        return;
      }

      if (command === "cache") {
        const subcommand = rest[0];
        if (!subcommand || subcommand === "status") {
          const stats = cacheStats();
          ctx.ui.notify(
            `glm-vision cache: ${config.cacheEnabled !== false ? "ON" : "OFF"}, ${stats.entries} entries, max ${config.cacheMaxEntries}\n${stats.path}`,
            "info",
          );
          return;
        }
        if (subcommand === "on") {
          config.cacheEnabled = true;
          saveConfig(config);
          ctx.ui.notify("glm-vision cache: ON", "info");
          return;
        }
        if (subcommand === "off") {
          config.cacheEnabled = false;
          saveConfig(config);
          ctx.ui.notify("glm-vision cache: OFF", "info");
          return;
        }
        if (subcommand === "clear") {
          clearCache();
          ctx.ui.notify("glm-vision cache: cleared", "info");
          return;
        }
        if (subcommand === "max") {
          const maxEntries = Number(rest[1]);
          if (Number.isInteger(maxEntries) && maxEntries > 0) {
            config.cacheMaxEntries = maxEntries;
            saveConfig(config);
            const cache = loadCache();
            pruneCache(cache, maxEntries);
            saveCache(cache);
            ctx.ui.notify(`glm-vision cache max -> ${maxEntries}`, "info");
          } else {
            ctx.ui.notify("Usage: /glm-vision cache max <positive integer>", "error");
          }
          return;
        }
        ctx.ui.notify('Unknown cache command. Try "cache status", "cache clear", "cache on", "cache off".', "error");
        return;
      }

      if (PRESET_NAMES.includes(command as keyof typeof PRESET_PROMPTS)) {
        config.promptMode = command as keyof typeof PRESET_PROMPTS;
        config.prompt = undefined;
        saveConfig(config);
        ctx.ui.notify(`glm-vision prompt mode -> ${command}`, "info");
        return;
      }

      if (MODELS.includes(trimmed)) {
        config.model = trimmed;
        config.enabled = true;
        saveConfig(config);
        ctx.ui.notify(`glm-vision model -> ${config.model}`, "info");
      } else {
        ctx.ui.notify(
          `Unknown command: ${trimmed}. Available models: ${MODELS.join(", ")}; prompt modes: ${PRESET_NAMES.join(", ")}`,
          "error",
        );
      }
    },
  });
}
