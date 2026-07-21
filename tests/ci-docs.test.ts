import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MAINTAINER_DOCS = [
  { path: "README.md", label: "README Development" },
  { path: "docs/release.md", label: "docs/release.md" },
  { path: "RELEASE.md", label: "RELEASE.md" },
  { path: "docs/template-checklist.md", label: "docs/template-checklist.md" },
] as const;

describe("maintainer docs cover CI validation commands", () => {
  it.each(MAINTAINER_DOCS)("$path documents npm run version:check", ({ path, label }) => {
    const content = readFileSync(path, "utf8");

    expect(content, `${label} should list npm run version:check`).toMatch(/npm run version:check/);
  });
});
