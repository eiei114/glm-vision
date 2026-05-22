# glm-vision

[![npm](https://img.shields.io/npm/v/glm-vision)](https://www.npmjs.com/package/glm-vision) [![GitHub](https://img.shields.io/badge/GitHub-eiei114%2Fglm--vision-blue)](https://github.com/eiei114/glm-vision)

Pi extension that gives non-vision GLM models (z.ai) image understanding by routing images through a GLM vision model.

## How it works

When using a z.ai GLM text model (e.g. `glm-5.1`) and the `read` tool encounters an image file, glm-vision:

1. Intercepts the image data
2. Sends it to a GLM vision model (`glm-4.6v` by default)
3. Returns a text description to the main model

```
Image file → read tool → [glm-vision intercepts]
                            ↓
              GLM-4.6V describes the image
                            ↓
              Text description → main GLM model
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

No configuration needed — it works automatically when:

- The active model is a zai provider model
- The `read` tool returns image content

### Commands

| Command | Description |
|---------|-------------|
| `/glm-vision` | Show current status and model |
| `/glm-vision on` | Enable image description |
| `/glm-vision off` | Disable (forward images as-is) |
| `/glm-vision glm-4.6v` | Switch to GLM-4.6V (default) |
| `/glm-vision glm-4.6v-flash` | Switch to GLM-4.6V Flash (lighter) |
| `/glm-vision glm-4.6v-flashx` | Switch to GLM-4.6V FlashX (lightweight paid tier) |
| `/glm-vision glm-5v-turbo` | Switch to GLM-5V-Turbo (multimodal coding model) |

### Available vision models

| Model | Context | Notes |
|-------|---------|-------|
| `glm-4.6v` | 128K | Default. Visual reasoning + tool calling |
| `glm-4.6v-flash` | 128K | Free lightweight option |
| `glm-4.6v-flashx` | 128K | Lightweight, faster paid option |
| `glm-5v-turbo` | 200K | Multimodal coding model for harder UI/code vision tasks |

The model ids above match Z.AI's HTTP API model codes. `glm-4.6v` remains the default because Z.AI's official Vision MCP Server currently advertises GLM-4.6V for Coding Plan vision understanding.

### Direct API vs Vision MCP Server

glm-vision keeps using the direct Z.AI HTTP API by default. That is the best fit for this package because it automatically intercepts Pi `read` results and returns a text description to the active GLM model without requiring the user to call a separate tool.

Z.AI also provides an official [Vision MCP Server](https://docs.z.ai/devpack/mcp/vision-mcp-server) for MCP-compatible clients. It is useful when you want specialized tools such as OCR, UI screenshot analysis, technical diagram understanding, UI diff checks, image analysis, or video analysis. Use it alongside glm-vision when your client already supports MCP and you prefer explicit vision tools. Do not treat it as a replacement for glm-vision's automatic image-read interception.

See [`docs/decisions/0001-vision-mcp-and-model-selection.md`](docs/decisions/0001-vision-mcp-and-model-selection.md) for the decision record.

### Configuration

Config stored at `~/.pi/glm-vision.json`:

```json
{
  "model": "glm-4.6v",
  "enabled": true,
  "prompt": "Describe this image in detail..."
}
```

## How authentication works

glm-vision reuses the same API key that Pi uses for the zai provider. No additional API key setup is needed — if your zai model works in Pi, glm-vision works too.

## License

MIT
