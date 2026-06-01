# Examples

## UI screenshot review

Use when reviewing visual regressions, app states, design implementation, or accessibility issues.

```text
Read ./screenshots/settings-page.png. Describe the layout, visible controls, error states, and anything that looks inconsistent with a modern settings page.
```

Good follow-up prompts:

- "Compare the described UI with our expected settings flow."
- "List likely CSS or component bugs from the screenshot."
- "Suggest regression tests that would catch this state."

## OCR and text extraction

Use when an image contains logs, scanned docs, terminal output, PDFs rendered as screenshots, or handwritten notes.

```text
Read ./captures/install-log.png. Transcribe all visible text exactly, then summarize the failure.
```

Tips:

- Ask for exact transcription first when accuracy matters.
- Use `glm-4.6v` instead of flash for dense text.
- Crop noisy screenshots before reading if the key text is small.

## Diagram reading

Use when an image contains architecture diagrams, flowcharts, UML, database schemas, or whiteboards.

```text
Read ./docs/auth-flow.png. Convert the diagram into a numbered sequence and call out every system boundary.
```

Good follow-up prompts:

- "Turn this into Mermaid."
- "Identify missing failure paths."
- "Map each box in the diagram to files in this repo."

## Error-image diagnosis

Use when a bug report only includes a screenshot of an error, stack trace, browser console, or broken screen.

```text
Read ./bug-reports/payment-error.jpg. Extract the exact error message, identify the failing area, and suggest the first three debugging steps.
```

Tips:

- Include surrounding code or logs in the same conversation after reading the image.
- Ask the model to separate observed facts from inferred causes.
- Keep original images attached to issues so maintainers can verify the generated description.
