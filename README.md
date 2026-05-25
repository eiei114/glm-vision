# glm-vision

[![npm](https://img.shields.io/npm/v/glm-vision)](https://www.npmjs.com/package/glm-vision) [![GitHub](https://img.shields.io/badge/GitHub-eiei114%2Fglm--vision-blue)](https://github.com/eiei114/glm-vision)

Pi extension that gives non-vision GLM models (z.ai) image understanding by routing images through a GLM vision model.

## How it works

When using a z.ai GLM text model (for example `glm-5.1`) and the `read` tool encounters an image file, glm-vision:

1. Intercepts the image data from the `read` tool result.
2. Builds a prompt from the active preset or custom prompt.
3. Sends the image to a GLM vision model (`glm-4.6v` by default).
4. Caches the response by image hash, prompt, and model.
5. Returns a text description to the main model.

```text
Image file -> read tool -> glm-vision intercepts
                       -> GLM-4.6V describes the image
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
| `/glm-vision` or `/glm-vision status` | Show status, model, prompt mode, cache stats, and active prompt. |
| `/glm-vision on` | Enable image description. |
| `/glm-vision off` | Disable image description and forward images as-is. |
| `/glm-vision check` | Probe z.ai Coding Plan availability for known vision models. |
| `/glm-vision check <model>` | Probe a new candidate model before adding it. |
| `/glm-vision glm-4.6v` | Switch to GLM-4.6V (default). |
| `/glm-vision glm-4.6v-flash` | Switch to GLM-4.6V Flash (lighter). |
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

### Prompt presets

| Preset | Best for | Behavior |
| --- | --- | --- |
| `default` | General image understanding | Detailed description with text, code, and UI handling. |
| `ocr` | Screenshots, scans, documents | Exact text transcription with layout preservation. |
| `ui` | App or website screenshots | Layout, visual hierarchy, controls, labels, states, UX notes. |
| `code` | Code screenshots | Code extraction, language hints, indentation, visible errors. |
| `diagram` | Flowcharts, architecture diagrams | Nodes, labels, arrows, relationships, process summary. |
| `brief` | Quick context | 2-4 concise sentences with important visible details. |

Cache keys include the image hash, active prompt text, and model. Switching presets or models naturally creates separate cache entries.

Cache hits are visible in returned tool content:

```text
[glm-vision: glm-4.6v, prompt=ocr, cache hit]
```

Fresh API calls show `cache miss` and are saved for later reuse when the cache is enabled.

### Checking Coding Plan model availability

z.ai Coding Plan availability can change as new GLM vision models roll out. Run:

```bash
/glm-vision check
```

The command uses your existing zai provider API key and probes the known vision-model candidates. It reports which models are currently accepted by the Coding Plan API, so maintainers can quickly decide whether `MODELS` and this README need an update.

To test a newly announced model before editing the extension, pass it explicitly:

```bash
/glm-vision check glm-new-vision-model
```

Maintainers can also run the upstream watcher outside Pi:

```bash
npm run check:upstream
```

That watcher reads official Z.AI sources, including `https://docs.z.ai/llms.txt`, the GLM-4.6V guide, and the GLM Coding Plan quick start. If `ZAI_API_KEY` is set, it also probes the Coding Plan API and fails when a newly accepted probe model is not yet in `MODELS` / this README. The included GitHub Actions workflow runs this weekly, on manual dispatch, and when model-related files change.

### Available vision models

| Model | Context | Notes |
| --- | --- | --- |
| `glm-4.6v` | 128K | Default. Best for detailed visual reasoning. |
| `glm-4.6v-flash` | 128K | Lighter and faster for simple descriptions. |

> **Note:** `glm-4.5v`, `glm-4.6v-flashx`, and `glm-5v-turbo` are tracked as probe candidates, but are not selectable until they are confirmed available on the z.ai Coding Plan. Only the models above are selectable by default.

## Configuration

Config is stored at `~/.pi/glm-vision.json`:

```json
{
  "model": "glm-4.6v",
  "enabled": true,
  "promptMode": "default",
  "cacheEnabled": true,
  "cacheMaxEntries": 100
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

glm-vision reuses the same API key that Pi uses for the `zai` provider. No additional API key setup is needed: if your z.ai model works in Pi, glm-vision works too.

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
- Customize `~/.pi/glm-vision.json` with an OCR-focused prompt or the `ocr` prompt preset.

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
