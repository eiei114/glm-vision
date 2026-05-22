import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ── Config ────────────────────────────────────────────────────
const CONFIG_PATH = path.join(os.homedir(), ".pi", "glm-vision.json");
const BASE_URL = "https://api.z.ai/api/coding/paas/v4";
const DEFAULT_MAX_IMAGES = 4;

interface VisionConfig {
  model: string;
  prompt?: string;
  enabled?: boolean;
  maxImages?: number;
}

const DEFAULT_CONFIG: VisionConfig = {
  model: "glm-4.6v",
  prompt:
    "Describe the image(s) in detail. If they contain text, transcribe it exactly. If they show code, reproduce the code. If they show a UI, describe the layout and elements. When multiple images are provided, label observations by Image 1, Image 2, etc. and summarize relationships between them. Respond in the same language as any text in the image(s).",
  enabled: true,
  maxImages: DEFAULT_MAX_IMAGES,
};

const MODELS = ["glm-4.6v", "glm-4.6v-flash"];

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
  base64?: string;
  mediaType?: string;
  url?: string;
}

export interface LabeledImageData extends ImageData {
  index: number;
  label: string;
}

function extractImageFromBlock(block: any): ImageData | null {
  if (block.type === "image" && block.source?.data) {
    return {
      base64: block.source.data,
      mediaType: block.source.mediaType || block.source.media_type || "image/png",
    };
  }
  if (block.type === "image" && block.data) {
    return {
      base64: block.data,
      mediaType: block.mediaType || block.media_type || "image/png",
    };
  }
  if (block.type === "image_url" && block.image_url?.url) {
    const url = block.image_url.url;
    if (url.startsWith("data:")) {
      const match = url.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s);
      if (match) return { base64: match[2], mediaType: match[1] };
      return null;
    }
    return { url };
  }
  return null;
}

export function extractImages(content: any[], limit = Number.POSITIVE_INFINITY): LabeledImageData[] {
  const images: LabeledImageData[] = [];
  for (const block of content) {
    const image = extractImageFromBlock(block);
    if (!image) continue;

    const index = images.length + 1;
    images.push({ ...image, index, label: `Image ${index}` });
    if (images.length >= limit) break;
  }
  return images;
}

export function countExtractableImages(content: any[]): number {
  return extractImages(content).length;
}

export function hasImageContent(content: any[]): boolean {
  return content.some((b) => b.type === "image" || b.type === "image_url");
}

export function normalizeMaxImages(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_MAX_IMAGES;
  return Math.max(1, Math.floor(value));
}

function imageUrl(img: ImageData): string {
  if (img.url) return img.url;
  return `data:${img.mediaType || "image/png"};base64,${img.base64 || ""}`;
}

export function visionPrompt(prompt: string, images: LabeledImageData[], skippedCount = 0): string {
  const labels = images.map((img) => img.label).join(", ");
  const skipped = skippedCount > 0 ? ` ${skippedCount} additional image(s) were omitted due to the configured limit.` : "";
  return `${prompt}\n\nYou are receiving ${images.length} image(s), in the same order Pi provided them: ${labels}. Use these exact labels in the answer. Give per-image observations first, then any cross-image comparison or combined conclusion.${skipped}`;
}

export function buildVisionRequestContent(prompt: string, images: LabeledImageData[], skippedCount = 0): any[] {
  const requestContent: any[] = [
    { type: "text", text: visionPrompt(prompt, images, skippedCount) },
  ];

  for (const img of images) {
    requestContent.push({ type: "text", text: `${img.label}:` });
    requestContent.push({ type: "image_url", image_url: { url: imageUrl(img) } });
  }

  return requestContent;
}

// ── Vision API call ───────────────────────────────────────────
async function describeImages(
  images: LabeledImageData[],
  model: string,
  prompt: string,
  apiKey: string,
  skippedCount = 0,
  signal?: AbortSignal,
): Promise<string> {
  const url = `${BASE_URL}/chat/completions`;
  const requestContent = buildVisionRequestContent(prompt, images, skippedCount);

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
          content: requestContent,
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

export function formatVisionResult(model: string, description: string, imageCount: number, skippedCount = 0): string {
  const skipped = skippedCount > 0 ? `, skipped: ${skippedCount}` : "";
  return `[glm-vision: ${model} | images: ${imageCount}${skipped}]\n\n${description}`;
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

    const maxImages = normalizeMaxImages(config.maxImages);
    const totalImages = countExtractableImages(content);
    const images = extractImages(content, maxImages);
    if (!images.length) return;
    const skippedCount = Math.max(0, totalImages - images.length);

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
      const description = await describeImages(
        images,
        config.model,
        config.prompt || DEFAULT_CONFIG.prompt!,
        apiKey,
        skippedCount,
        ctx.signal,
      );
      return {
        content: [
          {
            type: "text",
            text: formatVisionResult(config.model, description, images.length, skippedCount),
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
    description: `View or switch GLM vision model (${MODELS.join(", ")}). Use "on"/"off" to toggle.`,
    getArgumentCompletions(prefix: string) {
      const options = [...MODELS, "on", "off"];
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

      if (MODELS.includes(trimmed)) {
        config.model = trimmed;
        config.enabled = true;
        saveConfig(config);
        ctx.ui.notify(`glm-vision model -> ${config.model}`, "info");
      } else {
        ctx.ui.notify(
          `Unknown model: ${trimmed}. Available: ${MODELS.join(", ")}`,
          "error",
        );
      }
    },
  });
}
