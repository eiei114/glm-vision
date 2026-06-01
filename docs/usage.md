# Usage guide

## How it works

When using a z.ai GLM text model (for example `glm-5.1`) and the `read` tool encounters one or more image files, glm-vision:

1. Intercepts the image data in the order Pi provided it.
2. Builds a prompt from the active preset or custom prompt.
3. Sends the images together to a GLM vision model (`glm-4.6v` by default).
4. Caches the response by image hash, prompt, and model.
5. Returns a combined text description to the main model.

```text
Image file(s) -> read tool -> [glm-vision intercepts]
                              -> GLM-4.6V describes Image 1, Image 2, ...
                              -> Combined text description -> main GLM model
```

This lets non-vision GLM models inspect screenshots, diagrams, scanned text, and error images through a vision-capable sibling model.

## Multiple images

When a tool result contains multiple images, glm-vision sends them in their original order and asks the vision model to refer to them as `Image 1`, `Image 2`, and so on. The answer includes per-image observations plus any cross-image comparison or combined conclusion the vision model can infer.

Single-image behavior is backward compatible: one image is still described as a normal vision result, now with `images: 1` in the result header.

### Limits and fallback behavior

- `maxImages` controls how many images are sent in one vision request. Default: `4`.
- If a tool result contains more than `maxImages` extractable images, glm-vision sends the first `maxImages` in order and notes the skipped count in the prompt/result header.
- If no extractable image data is present, glm-vision leaves the tool result unchanged.
- If authentication is missing or the vision request fails, glm-vision returns an error text and preserves the original image blocks so Pi can continue with the normal fallback path.

## Commands

| Command | Description |
| --- | --- |
| `/glm-vision` or `/glm-vision status` | Show status, model, prompt mode, cache stats, and active prompt. |
| `/glm-vision on` | Enable image description. |
| `/glm-vision off` | Disable image description and forward images as-is. |
| `/glm-vision check` | Probe z.ai Coding Plan availability for known vision models. |
| `/glm-vision check <model>` | Probe a new candidate model before adding it. |
| `/glm-vision glm-4.6v` | Switch to GLM-4.6V (default). |
| `/glm-vision glm-4.6v-flash` | Switch to GLM-4.6V Flash (lighter). |
| `/glm-vision glm-4.6v-flashx` | Switch to GLM-4.6V FlashX (lightweight paid tier). |
| `/glm-vision glm-5v-turbo` | Switch to GLM-5V-Turbo (multimodal coding model). |
| `/glm-vision <preset>` | Switch prompt preset, e.g. `/glm-vision ocr`. |
| `/glm-vision mode <preset>` | Switch prompt preset, e.g. `/glm-vision mode ui`. |
| `/glm-vision prompt` | Show active prompt text. |
| `/glm-vision prompt <text>` | Save and use a custom prompt. |
| `/glm-vision reset` | Reset model, prompt mode, and cache settings to defaults. |
| `/glm-vision cache status` | Show cache status and cache file path. |
| `/glm-vision cache on` | Enable response cache. |
| `/glm-vision cache off` | Disable response cache without deleting entries. |
| `/glm-vision cache clear` | Clear cached responses. |
| `/glm-vision cache max <n>` | Set maximum cache entries and prune older entries. |

## Prompt presets

| Preset | Best for | Behavior |
| --- | --- | --- |
| `default` | General image understanding | Detailed description with text, code, and UI handling. |
| `ocr` | Screenshots, scans, documents | Exact text transcription with layout preservation. |
| `ui` | App or website screenshots | Layout, visual hierarchy, controls, labels, states, UX notes. |
| `code` | Code screenshots | Code extraction, language hints, indentation, visible errors. |
| `diagram` | Flowcharts, architecture diagrams | Nodes, labels, arrows, relationships, process summary. |
| `brief` | Quick context | 2-4 concise sentences with important visible details. |

## Cache behavior

Cache keys include the image hash, active prompt text, and model. Switching presets or models naturally creates separate cache entries.

Cache hits are visible in returned tool content:

```text
[glm-vision: glm-4.6v, prompt=ocr, cache hit]
```

Fresh API calls show `cache miss` and are saved for later reuse when the cache is enabled.

## Checking Coding Plan model availability

z.ai Coding Plan availability can change as new GLM vision models roll out. Run:

```bash
/glm-vision check
```

The command uses your existing zai provider API key and probes the known vision-model candidates. It reports which models are currently accepted by the Coding Plan API, so maintainers can quickly decide whether `MODELS` and docs need an update.

To test a newly announced model before editing the extension, pass it explicitly:

```bash
/glm-vision check glm-new-vision-model
```

Maintainers can also run the upstream watcher outside Pi:

```bash
npm run check:upstream
```

That watcher reads official Z.AI sources, including `https://docs.z.ai/llms.txt`, the GLM-4.6V guide, and the GLM Coding Plan quick start. If `ZAI_API_KEY` is set, it also probes the Coding Plan API and fails when a newly accepted probe model is not yet in `MODELS` / this doc. The included GitHub Actions workflow (`upstream-watch.yml`) runs this weekly, on manual dispatch, and when model-related files change.

## Available vision models

| Model | Context | Notes |
| --- | --- | --- |
| `glm-4.6v` | 128K | Default. Visual reasoning + tool calling. |
| `glm-4.6v-flash` | 128K | Lighter and faster for simple descriptions. |
| `glm-4.6v-flashx` | 128K | Lightweight, faster paid option. |
| `glm-5v-turbo` | 200K | Multimodal coding model for harder UI/code vision tasks. |

> **Note:** `glm-4.5v` is tracked as a probe candidate but not selectable until confirmed available on the z.ai Coding Plan.

## Direct API vs Vision MCP Server

glm-vision keeps using the direct Z.AI HTTP API by default. That is the best fit for this package because it automatically intercepts Pi `read` results and returns a text description to the active GLM model without requiring the user to call a separate tool.

Z.AI also provides an official [Vision MCP Server](https://docs.z.ai/devpack/mcp/vision-mcp-server) for MCP-compatible clients. It is useful when you want specialized tools such as OCR, UI screenshot analysis, technical diagram understanding, UI diff checks, image analysis, or video analysis. Use it alongside glm-vision when your client already supports MCP and you prefer explicit vision tools. Do not treat it as a replacement for glm-vision's automatic image-read interception.

See [`docs/decisions/0001-vision-mcp-and-model-selection.md`](decisions/0001-vision-mcp-and-model-selection.md) for the decision record.

## Configuration

Config is stored at `~/.pi/glm-vision.json`:

```json
{
  "model": "glm-4.6v",
  "enabled": true,
  "promptMode": "default",
  "cacheEnabled": true,
  "cacheMaxEntries": 100,
  "maxImages": 4
}
```

Use a custom `prompt` when you want a consistent style for image summaries. For example, OCR-heavy workflows can ask the vision model to transcribe all visible text before describing layout.

Custom prompts are stored as:

```json
{
  "model": "glm-4.6v",
  "enabled": true,
  "promptMode": "custom",
  "prompt": "Describe only visible chart data and axis labels.",
  "cacheEnabled": true,
  "cacheMaxEntries": 100
}
```

Response cache is stored at `~/.pi/glm-vision-cache.json`.

If `~/.pi` or this config file is missing, glm-vision uses defaults. If the config JSON is invalid, not an object, has invalid field types, names an unavailable vision model, or names an unavailable prompt mode, glm-vision leaves the original image attached and returns an actionable config warning instead of crashing.

## API failures and retry behavior

Z.AI requests time out after 30 seconds. Transient failures (`408`, `409`, `425`, `429`, and `5xx`) are retried up to 3 total attempts with exponential backoff (`500ms`, then `1000ms`). Authentication, model-access, invalid JSON, and empty-response failures return clear `glm-vision error` messages while preserving the original image content.

## How authentication works

glm-vision reuses the same API key that Pi uses for the `zai` provider. No additional API key setup is needed: if your z.ai model works in Pi, glm-vision works too.

## Troubleshooting

### glm-vision does not run

- Confirm the active Pi model uses the `zai` provider.
- Run `/glm-vision` and confirm the status is `ON`.
- Confirm the file is read through the `read` tool and contains supported image data.
- Restart the Pi session after installing or changing packages.

### `no zai API key found`

glm-vision reuses the same API key that Pi uses for the `zai` provider. If your z.ai model works in Pi, glm-vision should work too.

Fixes:

1. Re-authenticate or reconfigure the `zai` provider in Pi.
2. Start a new Pi session.
3. Run `/glm-vision` to confirm the extension loaded.

### Vision response is incomplete or misses text

- Switch to `/glm-vision glm-4.6v` for detailed reasoning.
- Crop the image to the relevant area.
- Increase contrast or resolution before reading the image.
- Customize `~/.pi/glm-vision.json` with an OCR-focused prompt or the `ocr` prompt preset.

### Image is forwarded instead of described

This can happen when glm-vision is disabled, the active provider is not `zai`, the image format is not represented as supported image content, or the vision API request fails. Error responses include the original image content when possible so the main model can still proceed.

### Vision API returns an error

- Check z.ai plan access for `glm-4.6v` or `glm-4.6v-flash`.
- Try the other model with `/glm-vision glm-4.6v-flash` or `/glm-vision glm-4.6v`.
- Retry with a smaller or cropped image.
- Include the exact `[glm-vision error: ...]` text when filing a bug.

## Contributing

Use the GitHub issue templates for bug reports and feature requests. Bug reports should include Pi version, package version, OS, selected z.ai model, image type, reproduction steps, and any `[glm-vision error: ...]` output.
