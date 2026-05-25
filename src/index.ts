import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// -- Config -----------------------------------------------------
export const getConfigPath = () => path.join(os.homedir(), ".pi", "glm-vision.json");
export const getCachePath = () => path.join(os.homedir(), ".pi", "glm-vision-cache.json");

const BASE_URL = "https://api.z.ai/api/coding/paas/v4";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;
const DEFAULT_CACHE_MAX_ENTRIES = 100;

export const PRESET_PROMPTS = {
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

export type PresetPromptMode = keyof typeof PRESET_PROMPTS;
export type PromptMode = PresetPromptMode | "custom";

export interface VisionConfig {
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

interface LoadedConfig {
  config: VisionConfig;
  warning?: string;
}

export const DEFAULT_CONFIG: VisionConfig = {
  model: "glm-4.6v",
  promptMode: "default",
  enabled: true,
  cacheEnabled: true,
  cacheMaxEntries: DEFAULT_CACHE_MAX_ENTRIES,
};

export const MODELS = ["glm-4.6v", "glm-4.6v-flash", "glm-4.6v-flashx", "glm-5v-turbo"];
export const CHECK_MODELS = [...MODELS, "glm-4.5v"];
export const PRESET_NAMES = Object.keys(PRESET_PROMPTS) as PresetPromptMode[];

function isVisionModel(value: unknown): value is string {
  return typeof value === "string" && MODELS.includes(value);
}

function isPresetPromptMode(value: unknown): value is PresetPromptMode {
  return typeof value === "string" && PRESET_NAMES.includes(value as PresetPromptMode);
}

function isPromptMode(value: unknown): value is PromptMode {
  return value === "custom" || isPresetPromptMode(value);
}

function normalizeConfig(raw: Partial<VisionConfig>, warnings: string[] = []): VisionConfig {
  const config: VisionConfig = { ...DEFAULT_CONFIG };

  if ("model" in raw) {
    if (isVisionModel(raw.model)) {
      config.model = raw.model;
    } else if (raw.model !== undefined) {
      warnings.push(
        `Unknown model "${String(raw.model)}". Available: ${MODELS.join(", ")}. Using ${DEFAULT_CONFIG.model}.`,
      );
    }
  }

  if ("prompt" in raw) {
    if (typeof raw.prompt === "string") {
      config.prompt = raw.prompt;
    } else if (raw.prompt !== undefined) {
      warnings.push("prompt must be a string. Using the active preset prompt.");
    }
  }

  if ("promptMode" in raw) {
    if (isPromptMode(raw.promptMode)) {
      config.promptMode = raw.promptMode;
    } else if (raw.promptMode !== undefined) {
      warnings.push(`Unknown promptMode "${String(raw.promptMode)}". Using default.`);
    }
  } else if (typeof raw.prompt === "string") {
    config.promptMode = "custom";
  }

  if ("enabled" in raw) {
    if (typeof raw.enabled === "boolean") {
      config.enabled = raw.enabled;
    } else if (raw.enabled !== undefined) {
      warnings.push("enabled must be true or false. Using enabled=true.");
    }
  }

  if ("cacheEnabled" in raw) {
    if (typeof raw.cacheEnabled === "boolean") {
      config.cacheEnabled = raw.cacheEnabled;
    } else if (raw.cacheEnabled !== undefined) {
      warnings.push("cacheEnabled must be true or false. Using cacheEnabled=true.");
    }
  }

  if ("cacheMaxEntries" in raw) {
    if (Number.isInteger(raw.cacheMaxEntries) && (raw.cacheMaxEntries || 0) > 0) {
      config.cacheMaxEntries = raw.cacheMaxEntries;
    } else if (raw.cacheMaxEntries !== undefined) {
      warnings.push(`cacheMaxEntries must be a positive integer. Using ${DEFAULT_CACHE_MAX_ENTRIES}.`);
    }
  }

  return config;
}

function loadConfigResult(configPath = getConfigPath()): LoadedConfig {
  try {
    const rawText = fs.readFileSync(configPath, "utf-8");
    const raw = JSON.parse(rawText);

    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return {
        config: { ...DEFAULT_CONFIG },
        warning: `Config ${configPath} must be a JSON object. Using defaults.`,
      };
    }

    const warnings: string[] = [];
    const config = normalizeConfig(raw, warnings);
    return {
      config,
      warning: warnings.length ? `Invalid ${configPath}: ${warnings.join(" ")}` : undefined,
    };
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      return { config: { ...DEFAULT_CONFIG } };
    }

    return {
      config: { ...DEFAULT_CONFIG },
      warning: `Could not read ${configPath}: ${err?.message || String(err)}. Using defaults.`,
    };
  }
}

export function loadConfig(configPath = getConfigPath()): VisionConfig {
  return loadConfigResult(configPath).config;
}

export function saveConfig(c: VisionConfig, configPath = getConfigPath()) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(normalizeConfig(c), null, 2));
}

// -- Cache ------------------------------------------------------
function loadCache(cachePath = getCachePath()): CacheFile {
  try {
    const raw = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
    if (raw?.version === 1 && raw.entries && typeof raw.entries === "object" && !Array.isArray(raw.entries)) {
      return raw;
    }
  } catch {
    // Empty or invalid cache: start fresh.
  }
  return { version: 1, entries: {} };
}

function saveCache(cache: CacheFile, cachePath = getCachePath()) {
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
}

function hash(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function getActivePrompt(c: VisionConfig): string {
  if (c.promptMode === "custom") return c.prompt || PRESET_PROMPTS.default;
  return PRESET_PROMPTS[(c.promptMode || "default") as PresetPromptMode] || PRESET_PROMPTS.default;
}

function getPromptLabel(c: VisionConfig): PromptMode {
  if (c.promptMode === "custom") return "custom";
  if (isPresetPromptMode(c.promptMode)) return c.promptMode;
  return "default";
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

function cacheStats(cachePath = getCachePath()): { entries: number; path: string } {
  return { entries: Object.keys(loadCache(cachePath).entries).length, path: cachePath };
}

function clearCache(cachePath = getCachePath()) {
  saveCache({ version: 1, entries: {} }, cachePath);
}

function statusText(c: VisionConfig, configPath: string, cachePath: string, warning?: string): string {
  const stats = cacheStats(cachePath);
  const prompt = getActivePrompt(c);
  return [
    `glm-vision: ${c.enabled !== false ? "ON" : "OFF"}`,
    `model: ${c.model}`,
    `prompt: ${getPromptLabel(c)}`,
    `cache: ${c.cacheEnabled !== false ? "ON" : "OFF"} (${stats.entries} entries, max ${c.cacheMaxEntries})`,
    `config: ${configPath}`,
    `cache file: ${stats.path}`,
    warning ? `warning: ${warning}` : undefined,
    `active prompt: ${prompt}`,
  ]
    .filter(Boolean)
    .join("\n");
}

// -- Image extraction ------------------------------------------
export interface ImageData {
  base64: string;
  mediaType: string;
}

export function extractImage(content: any[]): ImageData | null {
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

export function hasImageContent(content: any[]): boolean {
  return content.some((b) => b.type === "image" || b.type === "image_url");
}

// -- Vision API call -------------------------------------------
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    if (!signal) return;

    const onAbort = () => {
      clearTimeout(timeout);
      reject(new Error("request cancelled"));
    };

    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function createTimeoutSignal(parentSignal?: AbortSignal): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("request timed out")), REQUEST_TIMEOUT_MS);

  const onAbort = () => controller.abort(parentSignal?.reason || new Error("request cancelled"));
  if (parentSignal) {
    if (parentSignal.aborted) onAbort();
    else parentSignal.addEventListener("abort", onAbort, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", onAbort);
    },
  };
}

async function readErrorBody(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  if (!text) return "";

  try {
    const json = JSON.parse(text);
    return json?.error?.message || json?.message || text;
  } catch {
    return text;
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function explainHttpError(status: number, body: string, model: string): string {
  const detail = body ? `: ${body.slice(0, 500)}` : "";

  if (status === 401 || status === 403) {
    return `Z.AI rejected the zai API key (HTTP ${status}). Reauthenticate or update the zai provider API key in Pi${detail}`;
  }
  if (status === 400 || status === 404) {
    return `Z.AI rejected model "${model}" (HTTP ${status}). Use /glm-vision ${MODELS.join(" or ")}, and check your Coding Plan access${detail}`;
  }
  if (status === 429) {
    return `Z.AI rate limited the request (HTTP 429). Try again later${detail}`;
  }
  if (status >= 500) {
    return `Z.AI service error (HTTP ${status}). Retried automatically; try again later if it persists${detail}`;
  }

  return `Z.AI request failed (HTTP ${status})${detail}`;
}

function explainFetchError(err: any): string {
  const message = err?.message || String(err);
  if (err?.name === "AbortError" || /timed out/i.test(message)) {
    return `Z.AI request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`;
  }
  if (/cancelled|aborted/i.test(message)) {
    return "Z.AI request was cancelled";
  }
  return `Z.AI network request failed: ${message}`;
}

async function fetchWithRetry(url: string, init: RequestInit, model: string): Promise<Response> {
  let lastError: string | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const { signal, cleanup } = createTimeoutSignal(init.signal || undefined);

    try {
      const res = await fetch(url, { ...init, signal });

      if (res.ok || !isRetryableStatus(res.status) || attempt === MAX_ATTEMPTS) {
        return res;
      }

      lastError = explainHttpError(res.status, await readErrorBody(res), model);
    } catch (err: any) {
      lastError = explainFetchError(err);
      if (attempt === MAX_ATTEMPTS || /cancelled|aborted/i.test(lastError)) {
        throw new Error(`${lastError} after ${attempt} attempt${attempt === 1 ? "" : "s"}.`);
      }
    } finally {
      cleanup();
    }

    await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), init.signal || undefined);
  }

  throw new Error(lastError || "Z.AI request failed.");
}

export async function describeImage(
  img: ImageData,
  model: string,
  prompt: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<string> {
  const url = `${BASE_URL}/chat/completions`;
  const dataUrl = `data:${img.mediaType};base64,${img.base64}`;

  const res = await fetchWithRetry(
    url,
    {
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
    },
    model,
  );

  if (!res.ok) {
    throw new Error(explainHttpError(res.status, await readErrorBody(res), model));
  }

  let json: any;
  try {
    json = await res.json();
  } catch (err: any) {
    throw new Error(`Z.AI returned invalid JSON: ${err?.message || String(err)}`);
  }

  const description = json?.choices?.[0]?.message?.content;
  if (typeof description !== "string" || !description.trim()) {
    throw new Error(
      "Z.AI returned an empty response. The original image was left attached; try again or switch models with /glm-vision.",
    );
  }

  return description;
}

export interface GlmVisionExtensionOptions {
  configPath?: string;
  cachePath?: string;
}

async function checkModelAvailability(
  model: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<{ model: string; ok: boolean; status?: number; message: string }> {
  const url = `${BASE_URL}/chat/completions`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
      }),
      signal,
    });

    if (res.ok) {
      return { model, ok: true, status: res.status, message: "available" };
    }

    const text = await res.text();
    const firstLine = text.replace(/\s+/g, " ").trim().slice(0, 160);
    return {
      model,
      ok: false,
      status: res.status,
      message: firstLine || res.statusText || "unavailable",
    };
  } catch (err: any) {
    return { model, ok: false, message: err.message || "request failed" };
  }
}

async function checkCodingPlanModels(models: string[], apiKey: string, signal?: AbortSignal): Promise<string> {
  const results = await Promise.all(models.map((model) => checkModelAvailability(model, apiKey, signal)));

  return results
    .map((result) => {
      const mark = result.ok ? "OK" : "NO";
      const status = result.status ? ` (${result.status})` : "";
      return `${mark} ${result.model}: ${result.message}${status}`;
    })
    .join("\n");
}

// -- Extension --------------------------------------------------
export function createGlmVisionExtension(options: GlmVisionExtensionOptions = {}) {
  const configPath = options.configPath || getConfigPath();
  const cachePath = options.cachePath || getCachePath();

  return function glmVisionExtension(pi: ExtensionAPI) {
    let { config, warning: configWarning } = loadConfigResult(configPath);

    // Reload config on session start.
    pi.on("session_start", async () => {
      const loaded = loadConfigResult(configPath);
      config = loaded.config;
      configWarning = loaded.warning;
    });

    // Intercept read tool results containing images (zai provider only).
    pi.on("tool_result", async (event, ctx) => {
      if (event.toolName !== "read") return;
      if (config.enabled === false) return;

      const currentModel = ctx.model;
      if (!currentModel || currentModel.provider !== "zai") return;

      const content = event.content as any[];
      if (!Array.isArray(content) || !hasImageContent(content)) return;

      const img = extractImage(content);
      if (!img) return;

      const originalImages = content.filter((b: any) => b.type === "image" || b.type === "image_url");

      if (configWarning) {
        return {
          content: [
            {
              type: "text",
              text: `[glm-vision config warning: ${configWarning}]`,
            },
            ...originalImages,
          ],
        };
      }

      const prompt = getActivePrompt(config);
      const promptMode = getPromptLabel(config);
      const cacheKey = makeCacheKey(img, config.model, prompt);

      if (config.cacheEnabled !== false) {
        const cache = loadCache(cachePath);
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
              text: "[glm-vision error: no zai API key found. Authenticate or configure the zai provider in Pi, then retry the read.]",
            },
            ...originalImages,
          ],
        };
      }

      try {
        const description = await describeImage(img, config.model, prompt, apiKey, ctx.signal);
        if (config.cacheEnabled !== false) {
          const cache = loadCache(cachePath);
          cache.entries[cacheKey] = makeCacheEntry(img, config.model, prompt, promptMode, description);
          pruneCache(cache, config.cacheMaxEntries || DEFAULT_CACHE_MAX_ENTRIES);
          saveCache(cache, cachePath);
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
            ...originalImages,
          ],
        };
      }
    });

    // /glm-vision command.
    pi.registerCommand("glm-vision", {
      description:
        'Configure GLM vision model, prompt presets, response cache, and Coding Plan checks. Try "status", "ocr", "cache clear", "check".',
      getArgumentCompletions(prefix: string) {
        const options = [
          "status",
          "on",
          "off",
          "check",
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
          ctx.ui.notify(statusText(config, configPath, cachePath, configWarning), configWarning ? "warning" : "info");
          return;
        }

        if (command === "on") {
          config.enabled = true;
          configWarning = undefined;
          saveConfig(config, configPath);
          ctx.ui.notify(`glm-vision: ON (${config.model})`, "info");
          return;
        }

        if (command === "off") {
          config.enabled = false;
          configWarning = undefined;
          saveConfig(config, configPath);
          ctx.ui.notify("glm-vision: OFF", "info");
          return;
        }

        if (command === "check") {
          let apiKey: string | undefined;
          try {
            apiKey = await (ctx as any).modelRegistry?.getApiKeyForProvider?.("zai");
          } catch {
            // fall through
          }

          if (!apiKey) {
            ctx.ui.notify("glm-vision check: no zai API key found", "error");
            return;
          }

          const customModels = rest
            .join(" ")
            .split(/[\s,]+/)
            .map((model) => model.trim())
            .filter(Boolean);
          const modelsToCheck = customModels.length > 0 ? customModels : CHECK_MODELS;

          ctx.ui.notify("glm-vision check: probing z.ai Coding Plan models...", "info");
          const report = await checkCodingPlanModels(modelsToCheck, apiKey, ctx.signal);
          ctx.ui.notify(`glm-vision Coding Plan check\n${report}`, "info");
          return;
        }

        if (command === "reset") {
          config = { ...DEFAULT_CONFIG };
          configWarning = undefined;
          saveConfig(config, configPath);
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
          configWarning = undefined;
          saveConfig(config, configPath);
          ctx.ui.notify("glm-vision prompt: custom prompt saved", "info");
          return;
        }

        if (command === "mode") {
          const mode = rest[0];
          if (isPresetPromptMode(mode)) {
            config.promptMode = mode;
            config.prompt = undefined;
            configWarning = undefined;
            saveConfig(config, configPath);
            ctx.ui.notify(`glm-vision prompt mode -> ${mode}`, "info");
          } else {
            ctx.ui.notify(`Unknown prompt mode. Available: ${PRESET_NAMES.join(", ")}`, "error");
          }
          return;
        }

        if (command === "cache") {
          const subcommand = rest[0];
          if (!subcommand || subcommand === "status") {
            const stats = cacheStats(cachePath);
            ctx.ui.notify(
              `glm-vision cache: ${config.cacheEnabled !== false ? "ON" : "OFF"}, ${stats.entries} entries, max ${config.cacheMaxEntries}\n${stats.path}`,
              "info",
            );
            return;
          }
          if (subcommand === "on") {
            config.cacheEnabled = true;
            configWarning = undefined;
            saveConfig(config, configPath);
            ctx.ui.notify("glm-vision cache: ON", "info");
            return;
          }
          if (subcommand === "off") {
            config.cacheEnabled = false;
            configWarning = undefined;
            saveConfig(config, configPath);
            ctx.ui.notify("glm-vision cache: OFF", "info");
            return;
          }
          if (subcommand === "clear") {
            clearCache(cachePath);
            ctx.ui.notify("glm-vision cache: cleared", "info");
            return;
          }
          if (subcommand === "max") {
            const maxEntries = Number(rest[1]);
            if (Number.isInteger(maxEntries) && maxEntries > 0) {
              config.cacheMaxEntries = maxEntries;
              configWarning = undefined;
              saveConfig(config, configPath);
              const cache = loadCache(cachePath);
              pruneCache(cache, maxEntries);
              saveCache(cache, cachePath);
              ctx.ui.notify(`glm-vision cache max -> ${maxEntries}`, "info");
            } else {
              ctx.ui.notify("Usage: /glm-vision cache max <positive integer>", "error");
            }
            return;
          }
          ctx.ui.notify('Unknown cache command. Try "cache status", "cache clear", "cache on", "cache off".', "error");
          return;
        }

        if (isPresetPromptMode(command)) {
          config.promptMode = command;
          config.prompt = undefined;
          configWarning = undefined;
          saveConfig(config, configPath);
          ctx.ui.notify(`glm-vision prompt mode -> ${command}`, "info");
          return;
        }

        if (MODELS.includes(trimmed)) {
          config.model = trimmed;
          config.enabled = true;
          configWarning = undefined;
          saveConfig(config, configPath);
          ctx.ui.notify(`glm-vision model -> ${config.model}`, "info");
        } else {
          ctx.ui.notify(
            `Unknown command: ${trimmed}. Available models: ${MODELS.join(", ")}; prompt modes: ${PRESET_NAMES.join(", ")}`,
            "error",
          );
        }
      },
    });
  };
}

export default createGlmVisionExtension();
