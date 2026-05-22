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

### Available vision models

| Model | Context | Notes |
|-------|---------|-------|
| `glm-4.6v` | 128K | Default. Visual reasoning + tool calling |
| `glm-4.6v-flash` | 128K | Lighter, faster. Supports thinking toggle |

> **Note:** `glm-5v-turbo` is not available on the z.ai Coding Plan. Only the models above work.

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

## Release

Publishing to npm is automated by GitHub Actions. To publish a new version:

1. Update `version` in `package.json`.
2. Commit and tag the release, for example `v1.0.3`, or create a GitHub Release for that tag.
3. The `Publish to npm` workflow validates the package, skips if that exact version already exists on npm, and runs `npm publish --access public --provenance`.

The workflow supports npm trusted publishing via GitHub OIDC. If trusted publishing is not configured on npm, add an `NPM_TOKEN` repository secret.

## License

MIT
