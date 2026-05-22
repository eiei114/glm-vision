import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ── Config ────────────────────────────────────────────────────
const CONFIG_PATH = path.join(os.homedir(), ".pi", "glm-vision.json");
const BASE_URL = "https://api.z.ai/api/coding/paas/v4";

interface VisionConfig {
  model: string;
  prompt?: string;
  enabled?: boolean;
}

const DEFAULT_CONFIG: VisionConfig = {
  model: "glm-4.6v",
  prompt:
    "Describe this image in detail. If it contains text, transcribe it exactly. If it shows code, reproduce the code. If it shows a UI, describe the layout and elements. Respond in the same language as any text in the image.",
  enabled: true,
};

const MODELS = ["glm-4.6v", "glm-4.6v-flash"];
const CHECK_MODELS = [...MODELS, "glm-4.5v", "glm-4.6v-flashx", "glm-5v-turbo"];

function loadConfig(): VisionConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    return { ...DEFAULT_CONFIG, ...raw };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(c: VisionConfig) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(c, null, 2));
}

// ── Image extraction ──────────────────────────────────────────
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

// ── Vision API call ───────────────────────────────────────────
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
export default function (pi: ExtensionAPI) {
  let config = loadConfig();

  // Reload config on session start
  pi.on("session_start", async () => {
    config = loadConfig();
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
            text: `[glm-vision error: no zai API key found. Check your zai authentication.]`,
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
        ctx.ui.notify(`glm-vision [${status}]: ${config.model}`, "info");
        return;
      }

      if (trimmed === "on") {
        config.enabled = true;
        saveConfig(config);
        ctx.ui.notify(`glm-vision: ON (${config.model})`, "info");
        return;
      }
      if (trimmed === "off") {
        config.enabled = false;
        saveConfig(config);
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
        saveConfig(config);
        ctx.ui.notify(`glm-vision model → ${config.model}`, "info");
      } else {
        ctx.ui.notify(
          `Unknown model: ${trimmed}. Available: ${MODELS.join(", ")}`,
          "error",
        );
      }
    },
  });
}
