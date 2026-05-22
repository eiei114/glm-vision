# glm-vision

[![npm](https://img.shields.io/npm/v/glm-vision)](https://www.npmjs.com/package/glm-vision) [![GitHub](https://img.shields.io/badge/GitHub-eiei114%2Fglm--vision-blue)](https://github.com/eiei114/glm-vision)

Pi extension that gives non-vision GLM models (z.ai) image understanding by routing images through a GLM vision model.

## How it works

When using a z.ai GLM text model (for example `glm-5.1`) and the `read` tool encounters an image file, glm-vision:

1. Intercepts the image data from the `read` tool result.
2. Sends it to a GLM vision model (`glm-4.6v` by default).
3. Returns a text description to the main model.

```text
Image file -> read tool -> glm-vision -> GLM-4.6V
                                      -> text description -> main GLM model
```

This lets non-vision GLM models inspect screenshots, diagrams, scanned text, and error images through a vision-capable sibling model.

## Requirements

- A [z.ai](https://z.ai) account with Coding Plan access.
- Pi with the `zai` provider configured and authenticated.
- A z.ai model selected in Pi when reading images. glm-vision is inactive for non-`zai` providers.

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

No setup is required after installation. glm-vision runs automatically when all of these are true:

- The active Pi model uses the `zai` provider.
- The `read` tool returns image content.
- glm-vision is enabled.

Example prompt:

```text
Read ./screenshots/checkout-error.png and explain what is wrong with this UI.
```

glm-vision replaces the raw image result with a text description such as:

```text
[glm-vision: glm-4.6v]

The screenshot shows a checkout form with a red validation message under the card number field...
```

### Commands

| Command | Description |
| --- | --- |
| `/glm-vision` | Show current status and selected model. |
| `/glm-vision on` | Enable image description. |
| `/glm-vision off` | Disable glm-vision and forward images as-is. |
| `/glm-vision glm-4.6v` | Switch to GLM-4.6V (default). |
| `/glm-vision glm-4.6v-flash` | Switch to GLM-4.6V Flash (lighter). |

### Available vision models

| Model | Context | Notes |
| --- | --- | --- |
| `glm-4.6v` | 128K | Default. Best for detailed visual reasoning. |
| `glm-4.6v-flash` | 128K | Lighter and faster for simple descriptions. |

> `glm-5v-turbo` is not available on the z.ai Coding Plan. Use one of the models above.

### Configuration

Config is stored at `~/.pi/glm-vision.json`:

```json
{
  "model": "glm-4.6v",
  "enabled": true,
  "prompt": "Describe this image in detail..."
}
```

Use a custom `prompt` when you want a consistent style for image summaries. For example, OCR-heavy workflows can ask the vision model to transcribe all visible text before describing layout.

## Usage scenarios

### UI screenshot review

Use when reviewing visual regressions, app states, design implementation, or accessibility issues.

```text
Read ./screenshots/settings-page.png. Describe the layout, visible controls, error states, and anything that looks inconsistent with a modern settings page.
```

Good follow-up prompts:

- "Compare the described UI with our expected settings flow."
- "List likely CSS or component bugs from the screenshot."
- "Suggest regression tests that would catch this state."

### OCR and text extraction

Use when an image contains logs, scanned docs, terminal output, PDFs rendered as screenshots, or handwritten notes.

```text
Read ./captures/install-log.png. Transcribe all visible text exactly, then summarize the failure.
```

Tips:

- Ask for exact transcription first when accuracy matters.
- Use `glm-4.6v` instead of flash for dense text.
- Crop noisy screenshots before reading if the key text is small.

### Diagram reading

Use when an image contains architecture diagrams, flowcharts, UML, database schemas, or whiteboards.

```text
Read ./docs/auth-flow.png. Convert the diagram into a numbered sequence and call out every system boundary.
```

Good follow-up prompts:

- "Turn this into Mermaid."
- "Identify missing failure paths."
- "Map each box in the diagram to files in this repo."

### Error-image diagnosis

Use when a bug report only includes a screenshot of an error, stack trace, browser console, or broken screen.

```text
Read ./bug-reports/payment-error.jpg. Extract the exact error message, identify the failing area, and suggest the first three debugging steps.
```

Tips:

- Include surrounding code or logs in the same conversation after reading the image.
- Ask the model to separate observed facts from inferred causes.
- Keep original images attached to issues so maintainers can verify the generated description.

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
- Customize `~/.pi/glm-vision.json` with an OCR-focused prompt.

### Image is forwarded instead of described

This can happen when glm-vision is disabled, the active provider is not `zai`, the image format is not represented as supported image content, or the vision API request fails. Error responses include the original image content when possible so the main model can still proceed.

### Vision API returns an error

- Check z.ai plan access for `glm-4.6v` or `glm-4.6v-flash`.
- Try the other model with `/glm-vision glm-4.6v-flash` or `/glm-vision glm-4.6v`.
- Retry with a smaller or cropped image.
- Include the exact `[glm-vision error: ...]` text when filing a bug.

## Release operations

Maintainer release steps, semantic versioning policy, and release note template live in [RELEASE.md](./RELEASE.md). User-visible changes are tracked in [CHANGELOG.md](./CHANGELOG.md).

## Contributing

Use the GitHub issue templates for bug reports and feature requests. Bug reports should include Pi version, package version, OS, selected z.ai model, image type, reproduction steps, and any `[glm-vision error: ...]` output.

## License

MIT
