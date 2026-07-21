import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("maintainer docs cover CI validation commands", () => {
  it("documents version:check in README and release guide", () => {
    const readme = readFileSync("README.md", "utf8");
    const releaseGuide = readFileSync("docs/release.md", "utf8");

    expect(readme, "README Development should list npm run version:check").toMatch(
      /npm run version:check/,
    );
    expect(releaseGuide, "docs/release.md should list npm run version:check").toMatch(
      /npm run version:check/,
    );
  });
});
