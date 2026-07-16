# glm-vision

[![CI](https://github.com/eiei114/glm-vision/actions/workflows/ci.yml/badge.svg)](https://github.com/eiei114/glm-vision/actions/workflows/ci.yml)
[![Publish](https://github.com/eiei114/glm-vision/actions/workflows/publish.yml/badge.svg)](https://github.com/eiei114/glm-vision/actions/workflows/publish.yml)
[![npm version](https://img.shields.io/npm/v/glm-vision.svg)](https://www.npmjs.com/package/glm-vision)
[![npm downloads](https://img.shields.io/npm/dm/glm-vision.svg)](https://www.npmjs.com/package/glm-vision)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Pi package](https://img.shields.io/badge/pi-package-purple.svg)](https://pi.dev/packages)
[![Trusted Publishing](https://img.shields.io/badge/npm-Trusted%20Publishing-blue.svg)](docs/release.md)
<a href="https://buymeacoffee.com/ekawano114m"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" width="217" height="60"></a>

> Pi extension that gives non-vision GLM models (z.ai) image understanding by routing images through a GLM vision model.

## What this is

glm-vision intercepts Pi `read` tool results that include images when you are using the `zai` provider. It sends those images to a GLM vision model (default: `glm-4.6v`) and returns a combined text description to the active text-only GLM model.

## Features

- Automatic image interception for z.ai GLM text models
- Ordered multi-image support with per-image + combined summaries
- Prompt presets for OCR, UI, diagrams, and code, plus custom prompts
- Response cache keyed by image hash, prompt, and model
- Safe fallback behavior that preserves original images on error

## Install

Install the published npm package with Pi:

```bash
pi install npm:glm-vision
```

Pin a specific version when you want reproducible installs:

```bash
pi install npm:glm-vision@1.4.1
```

Install into the current project instead of your user Pi settings:

```bash
pi install npm:glm-vision -l
```

Or install from GitHub:

```bash
pi install git:github.com/eiei114/glm-vision
```

Try it without permanently installing:

```bash
pi -e npm:glm-vision
```

## Quick start

After installing, start a Pi session (or run locally with `pi -e .`) and confirm the extension loaded:

```bash
/glm-vision:status
```

Then ask Pi to read an image:

```text
Read ./screenshots/checkout-error.png and explain what is wrong with this UI.
```

## Usage notes (summary)

- **Vision models:** uses the `zai` provider and defaults to `glm-4.6v`. See the full list and availability checks in [`docs/usage.md`](docs/usage.md).
- **Multiple images:** images are sent in their original order and referenced as `Image 1`, `Image 2`, and so on.
- **Limits:** `maxImages` defaults to `4`. If more images are present, the first `maxImages` are described and the remainder are skipped.
- **Fallback behavior:** if no image data is available or the vision request fails, glm-vision returns an error message while preserving the original image blocks so Pi can continue its fallback path.

Command examples:

| Command | Description |
| --- | --- |
| `/glm-vision:status` | Show status, model, prompt mode, and cache stats. |
| `/glm-vision:on` | Enable image description. |
| `/glm-vision:off` | Disable image description. |
| `/glm-vision:model` | Open a TUI picker to switch vision models. |
| `/glm-vision:mode` | Open a TUI picker to switch prompt presets. |
| `/glm-vision:cache-status` | Show cache status. |

Legacy space forms such as `/glm-vision on` and `/glm-vision glm-4.6v` remain available for compatibility. More details, including presets, configuration, and troubleshooting, live in [`docs/usage.md`](docs/usage.md).

## Package contents

| Path | Purpose |
| --- | --- |
| `src/` | Pi extension entrypoint (`src/index.ts`) |
| `docs/` | Usage, examples, release, and maintainer docs |
| `scripts/` | Upstream model watcher utilities |
| `tests/` | Vitest coverage for core behavior |
| `.github/workflows/` | CI, publish, auto-release, upstream watch |

## Development

```bash
npm install
npm run lint
npm run typecheck
npm test
npm run validate:package
```

Optional upstream model checks:

```bash
npm run check:upstream
```

## Release

This package uses npm Trusted Publishing (OIDC) via GitHub Actions.

```bash
npm version patch
git push origin HEAD
```

See [`docs/release.md`](docs/release.md) and [`RELEASE.md`](RELEASE.md) for the full maintainer checklist.

## Maintainer docs

- [`docs/examples.md`](docs/examples.md) — usage examples
- [`docs/template-checklist.md`](docs/template-checklist.md) — Pi extension template alignment checklist

## Security

Pi packages can execute code with your local permissions. Review extensions before installing third-party packages.

For vulnerability reporting, see [`SECURITY.md`](SECURITY.md).

## Links

- npm: https://www.npmjs.com/package/glm-vision
- GitHub: https://github.com/eiei114/glm-vision
- Issues: https://github.com/eiei114/glm-vision/issues

## License

MIT
