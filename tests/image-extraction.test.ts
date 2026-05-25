import { describe, expect, it } from "vitest";

import {
  buildVisionRequestContent,
  countExtractableImages,
  extractImages,
  formatVisionResult,
  hasImageContent,
  normalizeMaxImages,
  visionPrompt,
} from "../src/index";

describe("image extraction", () => {
  it("returns one labeled image", () => {
    const images = extractImages([
      { type: "text", text: "before" },
      { type: "image", source: { data: "AAA", media_type: "image/png" } },
    ]);

    expect(images.length).toBe(1);
    expect(images[0]).toEqual({
      index: 1,
      label: "Image 1",
      base64: "AAA",
      mediaType: "image/png",
    });
  });

  it("preserves order across multiple image block formats", () => {
    const images = extractImages([
      { type: "image", source: { data: "AAA", mediaType: "image/png" } },
      { type: "text", text: "between" },
      { type: "image", data: "BBB", mediaType: "image/jpeg" },
      { type: "image_url", image_url: { url: "data:image/webp;base64,CCC" } },
      { type: "image_url", image_url: { url: "https://example.test/image.png" } },
    ]);

    expect(
      images.map((img) => [img.label, img.base64 ?? img.url, img.mediaType]),
    ).toEqual([
      ["Image 1", "AAA", "image/png"],
      ["Image 2", "BBB", "image/jpeg"],
      ["Image 3", "CCC", "image/webp"],
      ["Image 4", "https://example.test/image.png", undefined],
    ]);
  });

  it("applies configured limit and result reports skipped images", () => {
    const content = [
      { type: "image", data: "AAA" },
      { type: "image", data: "BBB" },
      { type: "image", data: "CCC" },
    ];

    const images = extractImages(content, 2);
    const skipped = countExtractableImages(content) - images.length;

    expect(images.map((img) => img.label)).toEqual(["Image 1", "Image 2"]);
    expect(skipped).toBe(1);
    expect(visionPrompt("Describe", images, skipped)).toMatch(/Image 1, Image 2/);
    expect(formatVisionResult("glm-4.6v", "done", images.length, skipped)).toMatch(/images: 2, skipped: 1/);
  });

  it("buildVisionRequestContent sends every selected image with its label", () => {
    const images = extractImages([
      { type: "image", data: "AAA", mediaType: "image/png" },
      { type: "image", data: "BBB", mediaType: "image/jpeg" },
    ]);

    const requestContent = buildVisionRequestContent("Describe", images);

    expect(
      requestContent.map((block: any) => block.type),
    ).toEqual(["text", "text", "image_url", "text", "image_url"]);
    expect(requestContent[1].text).toBe("Image 1:");
    expect((requestContent[2] as any).image_url.url).toBe("data:image/png;base64,AAA");
    expect(requestContent[3].text).toBe("Image 2:");
    expect((requestContent[4] as any).image_url.url).toBe("data:image/jpeg;base64,BBB");
  });

  it("no-image content is ignored", () => {
    const content = [{ type: "text", text: "plain tool output" }];

    expect(hasImageContent(content)).toBe(false);
    expect(countExtractableImages(content)).toBe(0);
    expect(extractImages(content)).toEqual([]);
  });

  it("normalizeMaxImages falls back and clamps invalid values", () => {
    expect(normalizeMaxImages(undefined)).toBe(4);
    expect(normalizeMaxImages(0)).toBe(1);
    expect(normalizeMaxImages(2.9)).toBe(2);
  });
});
