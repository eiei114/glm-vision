import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("README install examples", () => {
  it("pins the documented install version to package.json", () => {
    const version = JSON.parse(readFileSync("package.json", "utf8")).version;
    const readme = readFileSync("README.md", "utf8");
    const pinMatch = readme.match(/pi install npm:glm-vision@(\d+\.\d+\.\d+)/);

    expect(pinMatch, "README should include a pinned npm install example").not.toBeNull();
    expect(pinMatch?.[1]).toBe(version);
  });
});
