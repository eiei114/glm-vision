# glm-vision

[![npm](https://img.shields.io/npm/v/glm-vision)](https://www.npmjs.com/package/glm-vision) [![GitHub](https://img.shields.io/badge/GitHub-eiei114%2Fglm--vision-blue)](https://github.com/eiei114/glm-vision)

Pi extension that gives non-vision GLM models (z.ai) image understanding by routing images through a GLM vision model.

## How it works

When using a z.ai GLM text model (e.g. `glm-5.1`) and the `read` tool encounters an image file, glm-vision:

1. Intercepts the image data
2. Builds a prompt from the active preset or custom prompt
3. Sends the image to a GLM vision model (`glm-4.6v` by default)
4. Caches the response by image hash, prompt, and model
5. Returns a text description to the main model

```text
Image file -> read tool -> glm-vision intercepts
                       -> GLM-4.6V describes the image
                       -> text description -> main GLM model
```

This lets non-vision GLM models "see" images through a vision-capable sibling model.

## Requirements

- A [z.ai](https://z.ai) account with Coding Plan
- Pi with zai provider configured and authenticated

## Installation

### Via npm

```bash
pi install npm:glm-vision
```

Or add to `.pi/settings.json`:

```json
{
  "packages": ["npm:glm-vision"]
}
```

### From GitHub

```bash
pi install git:github.com/eiei114/glm-vision
```

Or add to `.pi/settings.json`:

```json
{
  "packages": ["git:github.com/eiei114/glm-vision"]
}
```

## Usage

No configuration needed. It works automatically when:

- The active model is a zai provider model
- The `read` tool returns image content

### Commands

| Command | Description |
|---------|-------------|
| `/glm-vision` or `/glm-vision status` | Show status, model, prompt mode, cache stats, and active prompt |
| `/glm-vision on` | Enable image description |
| `/glm-vision off` | Disable image description and forward images as-is |
| `/glm-vision glm-4.6v` | Switch to GLM-4.6V (default) |
| `/glm-vision glm-4.6v-flash` | Switch to GLM-4.6V Flash (lighter) |
| `/glm-vision <preset>` | Switch prompt preset, e.g. `/glm-vision ocr` |
| `/glm-vision mode <preset>` | Switch prompt preset, e.g. `/glm-vision mode ui` |
| `/glm-vision prompt` | Show active prompt text |
| `/glm-vision prompt <text>` | Save and use a custom prompt |
| `/glm-vision reset` | Reset model, prompt mode, and cache settings to defaults |
| `/glm-vision cache status` | Show cache status and cache file path |
| `/glm-vision cache on` | Enable response cache |
| `/glm-vision cache off` | Disable response cache without deleting entries |
| `/glm-vision cache clear` | Clear cached responses |
| `/glm-vision cache max <n>` | Set maximum cache entries and prune older entries |

### Prompt presets

| Preset | Best for | Behavior |
|--------|----------|----------|
| `default` | General image understanding | Detailed description with text, code, and UI handling |
| `ocr` | Screenshots, scans, documents | Exact text transcription with layout preservation |
| `ui` | App or website screenshots | Layout, visual hierarchy, controls, labels, states, UX notes |
| `code` | Code screenshots | Code extraction, language hints, indentation, visible errors |
| `diagram` | Flowcharts, architecture diagrams | Nodes, labels, arrows, relationships, process summary |
| `brief` | Quick context | 2-4 concise sentences with important visible details |

Cache keys include the image hash, active prompt text, and model. Switching presets or models naturally creates separate cache entries.

Cache hits are visible in returned tool content:

```text
[glm-vision: glm-4.6v, prompt=ocr, cache hit]
```

Fresh API calls show `cache miss` and are saved for later reuse when the cache is enabled.

### Available vision models

| Model | Context | Notes |
|-------|---------|-------|
| `glm-4.6v` | 128K | Default. Visual reasoning + tool calling |
| `glm-4.6v-flash` | 128K | Lighter, faster. Supports thinking toggle |

> **Note:** `glm-5v-turbo` is not available on the z.ai Coding Plan. Only the models above work.

## Configuration

Config stored at `~/.pi/glm-vision.json`:

```json
{
  "model": "glm-4.6v",
  "enabled": true,
  "promptMode": "default",
  "cacheEnabled": true,
  "cacheMaxEntries": 100
}
```

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

Response cache stored at `~/.pi/glm-vision-cache.json`.

If `~/.pi` or this config file is missing, glm-vision uses defaults. If the
config JSON is invalid, not an object, has invalid field types, names an
unavailable vision model, or names an unavailable prompt mode, glm-vision leaves
the original image attached and returns an actionable config warning instead of
crashing.

### API failures and retry behavior

Z.AI requests time out after 30 seconds. Transient failures (`408`, `409`,
`425`, `429`, and `5xx`) are retried up to 3 total attempts with exponential
backoff (`500ms`, then `1000ms`). Authentication, model-access, invalid JSON,
and empty-response failures return clear `glm-vision error` messages while
preserving the original image content.

## How authentication works

glm-vision reuses the same API key that Pi uses for the zai provider. No additional API key setup is needed. If your zai model works in Pi, glm-vision works too.

## License

MIT
