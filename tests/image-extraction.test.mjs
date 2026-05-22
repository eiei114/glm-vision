import test from "node:test";
import assert from "node:assert/strict";

import {
  buildVisionRequestContent,
  countExtractableImages,
  extractImages,
  formatVisionResult,
  hasImageContent,
  normalizeMaxImages,
  visionPrompt,
} from "../src/index.ts";

test("extractImages returns one labeled image", () => {
  const images = extractImages([
    { type: "text", text: "before" },
    { type: "image", source: { data: "AAA", media_type: "image/png" } },
  ]);

  assert.equal(images.length, 1);
  assert.deepEqual(images[0], {
    index: 1,
    label: "Image 1",
    base64: "AAA",
    mediaType: "image/png",
  });
});

test("extractImages preserves order across multiple image block formats", () => {
  const images = extractImages([
    { type: "image", source: { data: "AAA", mediaType: "image/png" } },
    { type: "text", text: "between" },
    { type: "image", data: "BBB", mediaType: "image/jpeg" },
    { type: "image_url", image_url: { url: "data:image/webp;base64,CCC" } },
    { type: "image_url", image_url: { url: "https://example.test/image.png" } },
  ]);

  assert.deepEqual(
    images.map((img) => [img.label, img.base64 ?? img.url, img.mediaType]),
    [
      ["Image 1", "AAA", "image/png"],
      ["Image 2", "BBB", "image/jpeg"],
      ["Image 3", "CCC", "image/webp"],
      ["Image 4", "https://example.test/image.png", undefined],
    ],
  );
});

test("extractImages applies configured limit and result reports skipped images", () => {
  const content = [
    { type: "image", data: "AAA" },
    { type: "image", data: "BBB" },
    { type: "image", data: "CCC" },
  ];

  const images = extractImages(content, 2);
  const skipped = countExtractableImages(content) - images.length;

  assert.deepEqual(images.map((img) => img.label), ["Image 1", "Image 2"]);
  assert.equal(skipped, 1);
  assert.match(visionPrompt("Describe", images, skipped), /Image 1, Image 2/);
  assert.match(formatVisionResult("glm-4.6v", "done", images.length, skipped), /images: 2, skipped: 1/);
});

test("buildVisionRequestContent sends every selected image with its label", () => {
  const images = extractImages([
    { type: "image", data: "AAA", mediaType: "image/png" },
    { type: "image", data: "BBB", mediaType: "image/jpeg" },
  ]);

  const requestContent = buildVisionRequestContent("Describe", images);

  assert.deepEqual(
    requestContent.map((block) => block.type),
    ["text", "text", "image_url", "text", "image_url"],
  );
  assert.equal(requestContent[1].text, "Image 1:");
  assert.equal(requestContent[2].image_url.url, "data:image/png;base64,AAA");
  assert.equal(requestContent[3].text, "Image 2:");
  assert.equal(requestContent[4].image_url.url, "data:image/jpeg;base64,BBB");
});

test("no-image content is ignored", () => {
  const content = [{ type: "text", text: "plain tool output" }];

  assert.equal(hasImageContent(content), false);
  assert.equal(countExtractableImages(content), 0);
  assert.deepEqual(extractImages(content), []);
});

test("normalizeMaxImages falls back and clamps invalid values", () => {
  assert.equal(normalizeMaxImages(undefined), 4);
  assert.equal(normalizeMaxImages(0), 1);
  assert.equal(normalizeMaxImages(2.9), 2);
});
