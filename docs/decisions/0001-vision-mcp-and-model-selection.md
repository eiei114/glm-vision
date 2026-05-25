# Decision: keep direct API default; document Vision MCP as optional

Date: 2026-05-22

## Context

glm-vision gives Pi users image understanding by intercepting image content returned by the `read` tool, calling a Z.AI vision model, then returning text to the active GLM model.

Z.AI now also documents an official Vision MCP Server for MCP-compatible coding clients. It exposes specialized tools such as OCR, UI screenshot analysis, technical diagram understanding, UI diff checks, general image analysis, and video analysis. It requires Node.js 22+, `Z_AI_API_KEY`, and `Z_AI_MODE=ZAI`.

Relevant Z.AI docs checked on 2026-05-22:

- Vision MCP Server: https://docs.z.ai/devpack/mcp/vision-mcp-server
- GLM-4.6V: https://docs.z.ai/guides/vlm/glm-4.6v
- GLM-5V-Turbo: https://docs.z.ai/guides/vlm/glm-5v-turbo
- HTTP API endpoint guidance: https://docs.z.ai/guides/develop/http/introduction
- Model pricing and available vision models: https://docs.z.ai/guides/overview/pricing
- Model parameter codes and max output tokens: https://docs.z.ai/guides/overview/concept-param
- GLM Coding Plan overview: https://docs.z.ai/devpack/overview

## Decision

Keep glm-vision's direct Z.AI HTTP API integration as the default path.

Document the official Vision MCP Server as an optional companion for users whose client supports MCP and who want explicit vision tools.

Do not replace the direct API path with MCP in this package yet.

## Rationale

- Direct API preserves glm-vision's main UX: automatic image-read interception in Pi.
- MCP requires separate local server setup and explicit client/tool routing; it is not equivalent to intercepting Pi `read` output.
- Z.AI's MCP server is broader than this package: image analysis, OCR, UI diagnosis, diagrams, UI diffs, and video. That breadth is valuable, but it belongs beside glm-vision unless Pi exposes a clean way for an extension to delegate intercepted images to configured MCP tools.
- Z.AI documentation specifically names GLM-4.6V for the Vision MCP Server, so `glm-4.6v` should remain glm-vision's default.

## Model choices

| Model id | Positioning | Context / output notes | Use when |
| --- | --- | --- | --- |
| `glm-4.6v` | High-performance GLM-4.6 vision model | 128K context; default max output 16K, max 32K | Default; strongest documented MCP-aligned choice |
| `glm-4.6v-flash` | Lightweight/free GLM-4.6 vision model | 128K context; default max output 16K, max 32K | Cost-sensitive or routine image descriptions |
| `glm-4.6v-flashx` | Lightweight paid GLM-4.6 vision model | 128K context; default max output 16K, max 32K | Faster/lighter paid option |
| `glm-5v-turbo` | Multimodal coding foundation model | 200K context; default max output 64K, max 128K | Harder UI/code vision tasks, higher capability needs |

## Consequences

- README and command completions expose current Z.AI vision model codes used by this package.
- Users can install Z.AI's Vision MCP Server separately if they need its specialized tools.
- Future MCP integration should be implemented only if it can preserve automatic image-read interception or provide a clearly different command/tool UX.
