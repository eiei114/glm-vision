import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ── Config ────────────────────────────────────────────────────
export const getConfigPath = () => path.join(os.homedir(), ".pi", "glm-vision.json");
const BASE_URL = "https://api.z.ai/api/coding/paas/v4";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;

export interface VisionConfig {
  model: string;
  prompt?: string;
  enabled?: boolean;
}

interface LoadedConfig {
  config: VisionConfig;
  warning?: string;
}

export const DEFAULT_CONFIG: VisionConfig = {
  model: "glm-4.6v",
  prompt:
    "Describe this image in detail. If it contains text, transcribe it exactly. If it shows code, reproduce the code. If it shows a UI, describe the layout and elements. Respond in the same language as any text in the image.",
  enabled: true,
};

export const MODELS = ["glm-4.6v", "glm-4.6v-flash"];
export const CHECK_MODELS = [...MODELS, "glm-4.5v", "glm-4.6v-flashx", "glm-5v-turbo"];

function isVisionModel(value: unknown): value is string {
  return typeof value === "string" && MODELS.includes(value);
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

    const config = { ...DEFAULT_CONFIG };
    const warnings: string[] = [];

    if ("model" in raw) {
      if (isVisionModel(raw.model)) {
        config.model = raw.model;
      } else {
        warnings.push(
          `Unknown model "${String(raw.model)}". Available: ${MODELS.join(", ")}. Using ${DEFAULT_CONFIG.model}.`,
        );
      }
    }

    if ("prompt" in raw) {
      if (typeof raw.prompt === "string") {
        config.prompt = raw.prompt;
      } else {
        warnings.push("prompt must be a string. Using the default prompt.");
      }
    }

    if ("enabled" in raw) {
      if (typeof raw.enabled === "boolean") {
        config.enabled = raw.enabled;
      } else {
        warnings.push("enabled must be true or false. Using enabled=true.");
      }
    }

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
  fs.writeFileSync(configPath, JSON.stringify(c, null, 2));
}

// ── Image extraction ──────────────────────────────────────────
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

// ── Vision API call ───────────────────────────────────────────
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

  const res = await fetchWithRetry(url, {
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
  }, model);

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
    throw new Error("Z.AI returned an empty response. The original image was left attached; try again or switch models with /glm-vision.");
  }

  return description;
}

export interface GlmVisionExtensionOptions {
  configPath?: string;
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

async function checkCodingPlanModels(
  models: string[],
  apiKey: string,
  signal?: AbortSignal,
): Promise<string> {
  const results = await Promise.all(
    models.map((model) => checkModelAvailability(model, apiKey, signal)),
  );

  return results
    .map((result) => {
      const mark = result.ok ? "✓" : "✗";
      const status = result.status ? ` (${result.status})` : "";
      return `${mark} ${result.model}: ${result.message}${status}`;
    })
    .join("\n");
}

// ── Extension ─────────────────────────────────────────────────
export function createGlmVisionExtension(options: GlmVisionExtensionOptions = {}) {
  const configPath = options.configPath || getConfigPath();

  return function glmVisionExtension(pi: ExtensionAPI) {
    let { config, warning: configWarning } = loadConfigResult(configPath);

    // Reload config on session start
    pi.on("session_start", async () => {
      const loaded = loadConfigResult(configPath);
      config = loaded.config;
      configWarning = loaded.warning;
    });

    // Intercept read tool results containing images (zai provider only)
    pi.on("tool_result", async (event, ctx) => {
      if (event.toolName !== "read") return;
      if (config.enabled === false) return;

      // Only activate when using zai provider
      const currentModel = ctx.model;
      if (!currentModel || currentModel.provider !== "zai") return;

      const content = event.content as any[];
      if (!Array.isArray(content) || !hasImageContent(content)) return;

      const img = extractImage(content);
      if (!img) return;

      if (configWarning) {
        return {
          content: [
            {
              type: "text",
              text: `[glm-vision config warning: ${configWarning}]`,
            },
            ...content.filter((b: any) => b.type === "image" || b.type === "image_url"),
          ],
        };
      }

      // Get API key from pi's model registry (same auth as main zai provider)
      let apiKey: string | undefined;
      try {
        apiKey = await (ctx as any).modelRegistry?.getApiKeyForProvider?.("zai");
      } catch {
        /* fall through */
      }

      if (!apiKey) {
        return {
          content: [
            {
              type: "text",
              text: `[glm-vision error: no zai API key found. Authenticate or configure the zai provider in Pi, then retry the read.]`,
            },
            ...content.filter((b: any) => b.type === "image" || b.type === "image_url"),
          ],
        };
      }

      try {
        const description = await describeImage(
          img,
          config.model,
          config.prompt || DEFAULT_CONFIG.prompt!,
          apiKey,
          ctx.signal,
        );
        return {
          content: [
            {
              type: "text",
              text: `[glm-vision: ${config.model}]\n\n${description}`,
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
      description: `View, switch, or check GLM vision models (${MODELS.join(", ")}). Use "on"/"off" to toggle.`,
      getArgumentCompletions(prefix: string) {
        const options = [...MODELS, "on", "off", "check"];
        return options
          .filter((m) => m.startsWith(prefix))
          .map((m) => ({ value: m, label: m }));
      },
      handler: async (args, ctx) => {
        const trimmed = (args || "").trim();

        if (!trimmed) {
          const status = config.enabled !== false ? "ON" : "OFF";
          ctx.ui.notify(
            `glm-vision [${status}]: ${config.model}${configWarning ? ` (${configWarning})` : ""}`,
            configWarning ? "warning" : "info",
          );
          return;
        }

        if (trimmed === "on") {
          config.enabled = true;
          configWarning = undefined;
          saveConfig(config, configPath);
          ctx.ui.notify(`glm-vision: ON (${config.model})`, "info");
          return;
        }
        if (trimmed === "off") {
          config.enabled = false;
          configWarning = undefined;
          saveConfig(config, configPath);
          ctx.ui.notify("glm-vision: OFF", "info");
          return;
        }

        if (trimmed === "check" || trimmed.startsWith("check ")) {
          let apiKey: string | undefined;
          try {
            apiKey = await (ctx as any).modelRegistry?.getApiKeyForProvider?.("zai");
          } catch {
            /* fall through */
          }

          if (!apiKey) {
            ctx.ui.notify("glm-vision check: no zai API key found", "error");
            return;
          }

          const customModels = trimmed
            .slice("check".length)
            .split(/[\s,]+/)
            .map((model) => model.trim())
            .filter(Boolean);
          const modelsToCheck = customModels.length > 0 ? customModels : CHECK_MODELS;

          ctx.ui.notify("glm-vision check: probing z.ai Coding Plan models...", "info");
          const report = await checkCodingPlanModels(modelsToCheck, apiKey, ctx.signal);
          ctx.ui.notify(`glm-vision Coding Plan check\n${report}`, "info");
          return;
        }

        if (MODELS.includes(trimmed)) {
          config.model = trimmed;
          config.enabled = true;
          configWarning = undefined;
          saveConfig(config, configPath);
          ctx.ui.notify(`glm-vision model → ${config.model}`, "info");
        } else {
          ctx.ui.notify(
            `Unknown model: ${trimmed}. Available: ${MODELS.join(", ")}`,
            "error",
          );
        }
      },
    });
  };
}

export default createGlmVisionExtension();
