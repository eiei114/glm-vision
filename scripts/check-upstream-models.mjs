#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SOURCE_FILE = path.join(ROOT, "src", "index.ts");
const CODING_PLAN_URL = "https://api.z.ai/api/coding/paas/v4/chat/completions";

const OFFICIAL_SOURCES = [
  {
    name: "Z.AI docs index",
    url: "https://docs.z.ai/llms.txt",
  },
  {
    name: "GLM-4.6V guide",
    url: "https://docs.z.ai/guides/vlm/glm-4.6v",
  },
  {
    name: "GLM Coding Plan quick start",
    url: "https://docs.z.ai/devpack/quick-start",
  },
];

function normalizeModel(raw) {
  return raw
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/glm-?(\d)/, "glm-$1")
    .replace(/-v\b/, "v")
    .replace(/-+/g, "-");
}

function extractModels(text) {
  const models = new Set();
  const modelPattern = /\bglm[-_\s]?\d+(?:\.\d+)*(?:\s*v|v)?(?:[-_\s]?(?:flashx|flash|turbo|air|plus))?\b/gi;

  for (const match of text.matchAll(modelPattern)) {
    models.add(normalizeModel(match[0]));
  }

  return [...models].sort();
}

function readArrayConst(source, name, knownArrays = {}) {
  const match = source.match(new RegExp(`const\\s+${name}\\s*=\\s*\\[([^\\]]*)\\]`));
  if (!match) throw new Error(`Could not find ${name} in src/index.ts`);

  const values = [...match[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
  for (const spread of match[1].matchAll(/\.\.\.([A-Z_]+)/g)) {
    values.push(...(knownArrays[spread[1]] || []));
  }

  return [...new Set(values)].sort();
}

async function fetchText(source) {
  const res = await fetch(source.url, {
    headers: {
      "User-Agent": "glm-vision-upstream-watch/1.0 (+https://github.com/eiei114/glm-vision)",
    },
  });

  if (!res.ok) throw new Error(`${source.name}: ${res.status} ${res.statusText}`);
  return await res.text();
}

async function probeModel(model, apiKey) {
  const res = await fetch(CODING_PLAN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1,
    }),
  });

  if (res.ok) return { model, ok: true, status: res.status, message: "available" };

  const text = await res.text();
  return {
    model,
    ok: false,
    status: res.status,
    message: text.replace(/\s+/g, " ").trim().slice(0, 160) || res.statusText,
  };
}

function printList(label, values) {
  console.log(`${label}: ${values.length ? values.join(", ") : "(none)"}`);
}

const source = await fs.readFile(SOURCE_FILE, "utf8");
const selectableModels = readArrayConst(source, "MODELS");
const checkModels = readArrayConst(source, "CHECK_MODELS", { MODELS: selectableModels });

const officialModelsBySource = new Map();
for (const officialSource of OFFICIAL_SOURCES) {
  const text = await fetchText(officialSource);
  const models = extractModels(text);
  officialModelsBySource.set(officialSource.name, models);
}

const officialModels = [...new Set([...officialModelsBySource.values()].flat())].sort();
const officialVisionModels = officialModels.filter((model) => /\d+(?:\.\d+)*v\b/.test(model));
const untrackedVisionModels = officialVisionModels.filter((model) => !checkModels.includes(model));

console.log("glm-vision upstream watch");
console.log("");
console.log("Official sources:");
for (const source of OFFICIAL_SOURCES) {
  console.log(`- ${source.name}: ${source.url}`);
}
console.log("");
printList("Selectable MODELS", selectableModels);
printList("Probe CHECK_MODELS", checkModels);
printList("Official vision candidates", officialVisionModels);

for (const [name, models] of officialModelsBySource) {
  printList(`Observed in ${name}`, models);
}

if (untrackedVisionModels.length > 0) {
  console.error("");
  printList("ERROR: official vision candidates missing from CHECK_MODELS", untrackedVisionModels);
  console.error("Add them to CHECK_MODELS first, then probe Coding Plan availability before adding to MODELS/README.");
  process.exitCode = 1;
}

const apiKey = process.env.ZAI_API_KEY || process.env.GLM_CODING_PLAN_API_KEY;
if (!apiKey) {
  console.log("");
  console.log("ZAI_API_KEY not set; skipped Coding Plan API probes.");
  console.log("Set ZAI_API_KEY in CI secrets to fail when a probed model becomes Coding Plan-available but is not selectable.");
  process.exit();
}

console.log("");
console.log("Coding Plan API probes:");
const probeTargets = [...new Set([...checkModels, ...officialVisionModels])].sort();
const probeResults = await Promise.all(probeTargets.map((model) => probeModel(model, apiKey)));
for (const result of probeResults) {
  const mark = result.ok ? "OK" : "NO";
  const status = result.status ? ` (${result.status})` : "";
  console.log(`- ${mark} ${result.model}: ${result.message}${status}`);
}

const selectableMissing = probeResults
  .filter((result) => result.ok && !selectableModels.includes(result.model))
  .map((result) => result.model);

if (selectableMissing.length > 0) {
  console.error("");
  printList("ERROR: Coding Plan-available models missing from MODELS/README", selectableMissing);
  console.error("Add available models to MODELS and document them in README before closing the upstream update.");
  process.exitCode = 1;
}

