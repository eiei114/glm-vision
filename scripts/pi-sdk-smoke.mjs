import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { allSemanticAssertionsPassed, containsExpected, hasExpectedStatusResponse } from "./pi-sdk-smoke-contract.mjs";
import { makeRpcClient } from "./pi-sdk-smoke-rpc.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SDK_VERSIONS = {
  "@earendil-works/pi-agent-core": "1.2.0",
  "@earendil-works/pi-ai": "1.2.0",
  "@earendil-works/pi-coding-agent": "1.2.0",
  "@earendil-works/pi-tui": "1.2.0",
};
const PROBE_DEADLINE_MS = 15_000;
const CLEANUP_GRACE_MS = 1_000;
const REPORT_PATH = path.join(ROOT, "docs", "verification", "pi-sdk-smoke.json");
const EVIDENCE_PATH = path.join(ROOT, "docs", "verification", "pi-sdk-smoke-evidence.json");
const OFFLINE_FETCH_PATH = path.join(ROOT, "scripts", "pi-sdk-offline-fetch.mjs");
const EXTENSION_PATH = path.join(ROOT, "src", "index.ts");
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAJ0lEQVQIW2O8e/fufwYGBgZBQUEQxcCIIfDu3Tuwivfv30NUoAsAALHpFMMLqZlPAAAAAElFTkSuQmCC";

function packageManifest(packageName) {
  const packagePath = path.join(ROOT, "node_modules", ...packageName.split("/"), "package.json");
  return JSON.parse(requireText(packagePath));
}

function requireText(filePath) {
  return readFileSync(filePath, "utf8");
}

function assertion(id, expected, observed, passed = containsExpected(observed, expected)) {
  return { id, expected, observed, passed };
}

function redact(text, tempRoot) {
  const escapeBackslashes = (value) => value.replaceAll("\\", "\\\\");
  return String(text ?? "")
    .replaceAll(tempRoot, "<isolated-temp>")
    .replaceAll(escapeBackslashes(tempRoot), "<isolated-temp>")
    .replaceAll(ROOT, "<repo>")
    .replaceAll(escapeBackslashes(ROOT), "<repo>");
}

function safeSummary(value, tempRoot) {
  return JSON.parse(redact(JSON.stringify(value), tempRoot));
}

function makeSseChunk(model, delta, finishReason = null) {
  return {
    id: "chatcmpl-pi-sdk-smoke",
    object: "chat.completion.chunk",
    created: 1_800_000_000,
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

function sendSse(res, model, chunks) {
  if (res.reqBody?.stream === false) {
    const last = chunks.at(-1);
    const toolCalls = chunks.flatMap((chunk) => chunk.delta.tool_calls ?? []);
    const content = chunks.map((chunk) => chunk.delta.content ?? "").join("");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        id: "chatcmpl-pi-sdk-smoke",
        object: "chat.completion",
        created: 1_800_000_000,
        model,
        choices: [
          {
            index: 0,
            message: { role: "assistant", ...(toolCalls.length ? { tool_calls: toolCalls } : { content }) },
            finish_reason: last.finish_reason,
          },
        ],
      }),
    );
    return;
  }

  res.writeHead(200, {
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream",
  });
  for (const chunk of chunks) res.write(`data: ${JSON.stringify(makeSseChunk(model, chunk.delta, chunk.finish_reason))}\n\n`);
  res.end("data: [DONE]\n\n");
}

function startModelServer() {
  let activeScenario;
  const server = createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
      res.writeHead(404);
      res.end("not found");
      return;
    }

    let body;
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch (error) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: String(error) } }));
      return;
    }
    res.reqBody = body;

    if (!activeScenario) {
      res.writeHead(503);
      res.end("no smoke scenario is active");
      return;
    }

    activeScenario.modelRequestCount += 1;
    activeScenario.providerModel = body.model;
    activeScenario.localProviderAuthorized =
      req.headers.authorization === "Bearer offline-smoke-key";

    if (activeScenario.modelRequestCount === 1) {
      const toolNames = (body.tools ?? []).map((tool) => tool.function?.name).filter(Boolean);
      activeScenario.readToolOffered = toolNames.includes("read");
      if (!activeScenario.readToolOffered) {
        sendSse(res, body.model, [
          { delta: { role: "assistant" } },
          { delta: { content: "SMOKE_READ_TOOL_NOT_AVAILABLE" } },
          { delta: {}, finish_reason: "stop" },
        ]);
        return;
      }

      const argumentsJson = JSON.stringify({ path: activeScenario.imagePath });
      sendSse(res, body.model, [
        { delta: { role: "assistant" } },
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call-pi-sdk-smoke-read",
                type: "function",
                function: { name: "read", arguments: argumentsJson },
              },
            ],
          },
        },
        { delta: {}, finish_reason: "tool_calls" },
      ]);
      return;
    }

    const conversation = JSON.stringify(body.messages ?? []);
    activeScenario.toolResultContainsDescription = conversation.includes("SMOKE_VISION_DESCRIPTION");
    activeScenario.toolResultContainsHandledError = conversation.includes(
      "[glm-vision error: Z.AI service error (HTTP 500)",
    );
    activeScenario.toolResultContainsImage = /data:image\//.test(conversation) || conversation.includes('"type":"image_url"');
    const finalText = activeScenario.mode === "error" ? "SMOKE_ERROR_PATH_FINAL" : "SMOKE_FEATURE_PATH_FINAL";
    sendSse(res, body.model, [
      { delta: { role: "assistant" } },
      { delta: { content: finalText } },
      { delta: {}, finish_reason: "stop" },
    ]);
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Offline Pi model server did not bind a TCP port"));
        return;
      }
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        setScenario(scenario) {
          activeScenario = scenario;
        },
        get currentScenario() {
          return activeScenario;
        },
      });
    });
  });
}

function createIsolatedEnv({ agentDir, homeDir, tempRoot, visionMode, visionLog }) {
  return {
    PATH: process.env.PATH ?? "",
    SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
    WINDIR: process.env.WINDIR ?? process.env.SystemRoot ?? "C:\\Windows",
    HOME: homeDir,
    USERPROFILE: homeDir,
    APPDATA: path.join(homeDir, "AppData", "Roaming"),
    LOCALAPPDATA: path.join(homeDir, "AppData", "Local"),
    TMP: tempRoot,
    TEMP: tempRoot,
    PI_CODING_AGENT_DIR: agentDir,
    PI_SMOKE_VISION_MODE: visionMode,
    PI_SMOKE_VISION_LOG: visionLog,
    NODE_OPTIONS: `--import=${pathToFileURL(OFFLINE_FETCH_PATH).href}`,
  };
}

function waitForClose(closePromise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Pi process close deadline")), timeoutMs);
    closePromise.then(
      (close) => {
        clearTimeout(timer);
        resolve(close);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function startPiProcess({ cliPath, env, repoRoot }) {
  const args = [
    cliPath,
    "--mode",
    "rpc",
    "--no-session",
    "--no-extensions",
    "--no-skills",
    "--no-themes",
    "--no-prompt-templates",
    "--no-context-files",
    "--offline",
    "--provider",
    "zai",
    "--model",
    "glm-4.6",
    "--thinking",
    "off",
    "--tools",
    "read",
    "--extension",
    EXTENSION_PATH,
  ];
  const child = spawn(process.execPath, args, {
    cwd: repoRoot,
    env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  return makeRpcClient(child, Date.now() + PROBE_DEADLINE_MS, CLEANUP_GRACE_MS);
}

async function sendPromptAndWait(rpc, message) {
  const response = await rpc.request("prompt", { message });
  const disposition = response.data?.disposition;
  if (disposition === "started" || disposition === "queued") await rpc.waitForAgentSettled();
  return response;
}

function inspectProcess(rpc, close, tempRoot) {
  const extensionErrors = rpc.records.filter((record) => record.type === "extension_error");
  const loadErrors = rpc.records.filter(
    (record) => record.type === "extension_load_error" || (record.type === "extension_error" && record.event === "extension_load"),
  );
  const unhandledStderr = rpc.stderr.match(/unhandled promise rejection|uncaught exception|uncaught error/gi) ?? [];
  const loadStderr = rpc.stderr.match(/failed to load extension|extension load failed/gi) ?? [];
  const exitFailure = close.code !== 0 || close.timedOut;
  return {
    exit_code: close.code,
    signal: close.signal,
    timed_out: close.timedOut,
    extension_load_errors: loadErrors.length + loadStderr.length,
    unhandled_errors: extensionErrors.length + unhandledStderr.length + (rpc.stdinError ? 1 : 0) + (exitFailure ? 1 : 0),
    extension_error_records: extensionErrors.length,
    protocol_errors: rpc.protocolErrors.length,
    stdin_error: rpc.stdinError ?? null,
    stderr: redact(rpc.stderr, tempRoot).trim(),
    rpc_record_types: rpc.records.map((record) => record.type),
  };
}

async function readVisionLog(filePath) {
  try {
    const content = await readFile(filePath, "utf8");
    return content.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function runExtensionLoad({ cliPath, env, repoRoot, modelServer, tempRoot, visionLog }) {
  modelServer.setScenario({ mode: "load", imagePath: "unused" });
  const rpc = startPiProcess({ cliPath, env, repoRoot });
  let commands = [];
  let promptResponse = null;
  let notification = null;
  let failure;
  try {
    const commandResponse = await rpc.request("get_commands");
    commands = commandResponse.data?.commands ?? [];
    promptResponse = await sendPromptAndWait(rpc, "/glm-vision status");
    notification = rpc.records.find(
      (record) => record.type === "extension_ui_request" && record.method === "notify" && String(record.message).includes("glm-vision: ON"),
    );
  } catch (error) {
    failure = error;
  }
  const close = await rpc.closeGracefully();
  const process = inspectProcess(rpc, close, tempRoot);
  const extensionCommand = commands.find((command) => command.name === "glm-vision" && command.source === "extension");
  const promptObserved = `disposition=${promptResponse?.data?.disposition ?? "missing"}; notify=${notification?.message ?? "missing"}`;
  const assertions = [
    assertion(
      "extension_registered",
      "get_commands lists glm-vision as an extension and /glm-vision status is handled with the ON notification",
      `command=${extensionCommand ? "glm-vision:extension" : "missing"}; ${redact(promptObserved, tempRoot)}`,
      Boolean(extensionCommand) &&
        promptResponse?.data?.disposition === "handled" &&
        String(notification?.message).includes("glm-vision: ON"),
    ),
  ];
  if (failure) assertions.push(assertion("probe_completed", "RPC startup and status command complete", failure.message, false));
  const visionRequests = await readVisionLog(visionLog);
  const evidence = {
    command: "npm run smoke:pi",
    process,
    extension_command: extensionCommand ?? null,
    status_prompt_disposition: promptResponse?.data?.disposition ?? null,
    status_notification: notification?.message ?? null,
    vision_provider_requests: visionRequests.length,
  };
  return { assertions, exitCode: process.exit_code, process, evidence };
}

async function runFeatureProcess({ mode, cliPath, env, repoRoot, modelServer, imagePath, tempRoot, statusPrompt }) {
  const visionLog = env.PI_SMOKE_VISION_LOG;
  modelServer.setScenario({
    mode,
    imagePath,
    modelRequestCount: 0,
    readToolOffered: false,
    localProviderAuthorized: false,
  });
  const scenario = modelServer.currentScenario;
  const rpc = startPiProcess({ cliPath, env, repoRoot });
  let promptResponse = null;
  let finalText = null;
  let commands = [];
  let statusResponse = null;
  let statusNotification = null;
  let failure;
  try {
    commands = (await rpc.request("get_commands")).data?.commands ?? [];
    if (statusPrompt) {
      statusResponse = await sendPromptAndWait(rpc, statusPrompt);
      statusNotification = rpc.records.find(
        (record) => record.type === "extension_ui_request" && record.method === "notify" && String(record.message).includes("glm-vision: ON"),
      );
    }
    promptResponse = await sendPromptAndWait(
      rpc,
      `Use the read tool to inspect this image and describe it: ${imagePath}`,
    );
    const finalResponse = await rpc.request("get_last_assistant_text");
    finalText = finalResponse.data?.text ?? null;
  } catch (error) {
    failure = error;
  }
  const close = await rpc.closeGracefully();
  const process = inspectProcess(rpc, close, tempRoot);
  const visionRequests = await readVisionLog(visionLog);
  const observed = {
    model_requests: scenario.modelRequestCount,
    provider_model: scenario.providerModel ?? null,
    read_tool_offered: scenario.readToolOffered,
    local_provider_authorized: scenario.localProviderAuthorized,
    tool_result_contains_description: scenario.toolResultContainsDescription ?? false,
    tool_result_contains_handled_error: scenario.toolResultContainsHandledError ?? false,
    tool_result_contains_image: scenario.toolResultContainsImage ?? false,
    final_assistant_text: finalText,
    extension_registered: commands.some((command) => command.name === "glm-vision" && command.source === "extension"),
    status_prompt_disposition: statusResponse?.data?.disposition ?? null,
    status_notification: statusNotification?.message ?? null,
    vision_provider_requests: visionRequests,
    prompt_disposition: promptResponse?.data?.disposition ?? null,
    process_exit_code: process.exit_code,
  };
  return {
    scenario,
    assertions: [],
    exitCode: process.exit_code,
    process,
    processId: rpc.child.pid ?? null,
    failure,
    visionRequests,
    observed,
  };
}

async function runFeatureCase({ name, mode, cliPath, env, repoRoot, modelServer, imagePath, tempRoot }) {
  const result = await runFeatureProcess({ mode, cliPath, env, repoRoot, modelServer, imagePath, tempRoot });
  const scenario = result.scenario;
  const featureExpected = mode === "error" ? "handled HTTP 500 and preserved the read image" : "SMOKE_VISION_DESCRIPTION reaches the next Pi model request";
  let featureObserved;
  let featurePassed;
  let featureId;
  if (mode === "error") {
    featureId = "handled_error";
    featureObserved = `error=${scenario.toolResultContainsHandledError === true}; image=${scenario.toolResultContainsImage === true}; ` +
      `vision_attempts=${result.visionRequests.length}; final=${result.observed.final_assistant_text ?? "missing"}`;
    featurePassed =
      scenario.toolResultContainsHandledError === true &&
      scenario.toolResultContainsImage === true &&
      result.visionRequests.length === 3 &&
      containsExpected(String(result.observed.final_assistant_text), "SMOKE_ERROR_PATH_FINAL");
  } else {
    featureId = name === "reload_cleanup" ? "reloaded_feature_response" : "feature_response";
    featureObserved = `description=${scenario.toolResultContainsDescription === true}; ` +
      `final=${result.observed.final_assistant_text ?? "missing"}; vision_requests=${result.visionRequests.length}`;
    featurePassed =
      scenario.toolResultContainsDescription === true &&
      result.visionRequests.length === 1 &&
      containsExpected(String(result.observed.final_assistant_text), "SMOKE_FEATURE_PATH_FINAL");
  }
  const assertions = [
    assertion(
      featureId,
      featureExpected,
      featureObserved,
      featurePassed,
    ),
  ];
  if (scenario.modelRequestCount < 2 || !scenario.localProviderAuthorized || !scenario.readToolOffered) {
    assertions.push(
      assertion(
        "actual_pi_tool_cycle",
        "the actual Pi host sends a local provider tool call, executes read, and receives the result",
        `model_requests=${scenario.modelRequestCount}; read_tool=${scenario.readToolOffered}; local_auth=${scenario.localProviderAuthorized}`,
        false,
      ),
    );
  }
  if (result.failure) assertions.push(assertion("probe_completed", "RPC read and model cycle completes", result.failure.message, false));
  const evidence = {
    command: "npm run smoke:pi",
    process: result.process,
    observed: result.observed,
    provider_response_boundary: "Pi uses an actual local OpenAI-compatible model endpoint; only the exact Z.AI vision HTTP endpoint is intercepted with a deterministic response.",
  };
  return { assertions, exitCode: result.exitCode, process: result.process, evidence };
}

async function runReloadCase({ cliPath, envForMode, repoRoot, modelServer, imagePath, tempRoot }) {
  const firstEnv = await envForMode("success", "reload-first");
  modelServer.setScenario({ mode: "reload-first", imagePath: "unused" });
  const first = startPiProcess({ cliPath, env: firstEnv, repoRoot });
  const firstPid = first.child.pid ?? null;
  let firstCommands = [];
  let firstPrompt;
  let firstFailure;
  try {
    firstCommands = (await first.request("get_commands")).data?.commands ?? [];
    firstPrompt = await sendPromptAndWait(first, "/glm-vision status");
  } catch (error) {
    firstFailure = error;
  }
  const firstClose = await first.closeGracefully();
  const firstProcess = inspectProcess(first, firstClose, tempRoot);

  const secondEnv = await envForMode("success", "reload-second");
  const secondResult = await runFeatureProcess({
    mode: "reload-second",
    cliPath,
    env: secondEnv,
    repoRoot,
    modelServer,
    imagePath,
    tempRoot,
    statusPrompt: "/glm-vision status",
  });
  const firstRegistered = firstCommands.some((command) => command.name === "glm-vision" && command.source === "extension");
  const secondRegistered = secondResult.observed.extension_registered === true;
  const secondStatusHandled = hasExpectedStatusResponse(
    secondResult.observed.status_prompt_disposition,
    secondResult.observed.status_notification,
  );
  const distinctProcesses = firstPid !== null && secondResult.processId !== null && firstPid !== secondResult.processId;
  const responsePassed =
    secondResult.scenario.toolResultContainsDescription === true &&
    containsExpected(String(secondResult.observed.final_assistant_text), "SMOKE_FEATURE_PATH_FINAL") &&
    secondResult.visionRequests.length === 1;
  const bothClean =
    firstProcess.exit_code === 0 &&
    !firstProcess.timed_out &&
    secondResult.process.exit_code === 0 &&
    !secondResult.process.timed_out &&
    !firstProcess.stderr.match(/shutdown error|uncaught|unhandled/i) &&
    !secondResult.process.stderr.match(/shutdown error|uncaught|unhandled/i);
  const assertions = [
    assertion(
      "reloaded_extension_registered",
      "a distinct second Pi process registers glm-vision and handles /glm-vision status with the ON notification",
      `distinct_processes=${distinctProcesses}; first_registered=${firstRegistered}; first_status=${firstPrompt?.data?.disposition ?? "missing"}; ` +
        `second_registered=${secondRegistered}; second_status=${secondResult.observed.status_prompt_disposition ?? "missing"}; ` +
        `second_notification=${containsExpected(String(secondResult.observed.status_notification), "glm-vision: ON") ? "glm-vision: ON" : "missing"}`,
      firstRegistered && firstPrompt?.data?.disposition === "handled" && secondRegistered && secondStatusHandled && distinctProcesses,
    ),
    assertion(
      "reloaded_feature_response",
      "the second process receives SMOKE_VISION_DESCRIPTION from the actual extension tool_result path",
      `tool_result=${secondResult.scenario.toolResultContainsDescription === true}; final=${secondResult.observed.final_assistant_text ?? "missing"}; vision_requests=${secondResult.visionRequests.length}`,
      responsePassed,
    ),
    assertion(
      "clean_shutdown",
      "both actual Pi processes exit normally after RPC stdin closes, without timeout or shutdown errors",
      `first_exit=${firstProcess.exit_code}; second_exit=${secondResult.process.exit_code}; first_timeout=${firstProcess.timed_out}; second_timeout=${secondResult.process.timed_out}; ` +
        `shutdown_errors=${bothClean ? 0 : 1}`,
      bothClean,
    ),
  ];
  if (firstFailure) assertions.push(assertion("first_process_status", "first process status prompt succeeds", firstFailure.message, false));
  if (secondResult.failure) assertions.push(assertion("second_process_probe", "second process RPC probe succeeds", secondResult.failure.message, false));
  return {
    assertions,
    exitCode: secondResult.process.exit_code,
    processes: [firstProcess, secondResult.process],
    evidence: {
      command: "npm run smoke:pi",
      processes: [firstProcess, secondResult.process],
      distinct_processes: distinctProcesses,
      first_status_disposition: firstPrompt?.data?.disposition ?? null,
      second_status_disposition: secondResult.observed.status_prompt_disposition,
      second_status_notification: secondResult.observed.status_notification,
      second_process: secondResult.observed,
    },
  };
}

async function runHostShellCase({ cliPath, cliVersion, agentDir, homeDir, tempRoot }) {
  const env = createIsolatedEnv({
    agentDir,
    homeDir,
    tempRoot,
    visionMode: "success",
    visionLog: path.join(tempRoot, "host-shell-vision.jsonl"),
  });
  const powershellPath = path.join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const shell = process.platform === "win32" ? powershellPath : "/bin/sh";
  let command;
  let args;
  let outputPath;
  let shellErrorPath;
  if (process.platform === "win32") {
    const shellScript = path.join(tempRoot, "host-shell-smoke.ps1");
    outputPath = path.join(tempRoot, "host-shell-version.txt");
    shellErrorPath = path.join(tempRoot, "host-shell-version.stderr.txt");
    const script =
      `$process = Start-Process -FilePath '${process.execPath.replaceAll("'", "''")}' ` +
      `-ArgumentList '"${cliPath.replaceAll("'", "''")}" --version' -Wait -PassThru -NoNewWindow ` +
      `-RedirectStandardOutput '${outputPath.replaceAll("'", "''")}' ` +
      `-RedirectStandardError '${shellErrorPath.replaceAll("'", "''")}'\n` +
      "exit $process.ExitCode\n";
    await writeFile(shellScript, script, "utf8");
    command = `-NoLogo -NoProfile -NonInteractive -File ${shellScript}`;
    args = ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", shellScript];
  } else {
    command = `exec '${process.execPath.replaceAll("'", "'\\''")}' '${cliPath.replaceAll("'", "'\\''")}' --version`;
    args = ["-c", command];
  }
  const child = spawn(shell, args, { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout = (stdout + chunk).slice(-8_000); });
  child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-8_000); });
  const closePromise = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  let timedOut = false;
  let close;
  try {
    close = await waitForClose(closePromise, PROBE_DEADLINE_MS);
  } catch {
    timedOut = true;
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      if (process.platform === "win32") {
        const taskkill = spawn(
          path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe"),
          ["/PID", String(child.pid), "/T", "/F"],
          { stdio: "ignore", windowsHide: true },
        );
        const taskkillClose = new Promise((resolve, reject) => {
          taskkill.once("error", reject);
          taskkill.once("close", resolve);
        });
        await waitForClose(
          taskkillClose,
          CLEANUP_GRACE_MS,
        ).catch(() => taskkill.kill());
      } else {
        child.kill("SIGKILL");
      }
    }
    close = await waitForClose(closePromise, CLEANUP_GRACE_MS).catch(() => ({ code: null, signal: "cleanup-timeout" }));
  }
  const versionOutput = outputPath ? await readFile(outputPath, "utf8").catch(() => "") : stdout.trim();
  const shellError = shellErrorPath ? await readFile(shellErrorPath, "utf8").catch(() => "") : "";
  const observed = `shell=${process.platform === "win32" ? "PowerShell" : "/bin/sh"}; version=${versionOutput.trim()}; stderr=${shellError.trim() || stderr.trim()}; exit=${close.code}`;
  const passed = !timedOut && close.code === 0 && versionOutput.trim().split(/\r?\n/).at(-1) === cliVersion;
  return {
    assertions: [assertion("native_shell_boundary", `native shell launches pinned Pi CLI ${cliVersion} and returns its version`, redact(observed, tempRoot), passed)],
    exitCode: close.code,
    evidence: {
      command: "npm run smoke:pi",
      shell: process.platform === "win32" ? "PowerShell -NoProfile -NonInteractive" : "/bin/sh",
      shell_command: redact(command, tempRoot),
      stdout: redact(versionOutput.trim(), tempRoot),
      stdout_capture: outputPath ? "PowerShell wrote native command output to an isolated temporary file" : "native shell stdout",
      stderr: redact(shellError.trim() || stderr.trim(), tempRoot),
      exit_code: close.code,
      timed_out: timedOut,
    },
  };
}

function caseEntry(name, command, result) {
  return {
    name,
    command,
    exit_code: result.exitCode,
    passed: result.exitCode === 0 && allSemanticAssertionsPassed(result.assertions),
    evidence: EVIDENCE_PATH.replace(`${ROOT}${path.sep}`, "").replaceAll("\\", "/") + `#cases.${name}`,
    assertions: result.assertions,
  };
}

async function main() {
  const installedVersions = Object.fromEntries(
    Object.keys(SDK_VERSIONS).map((packageName) => [packageName, packageManifest(packageName).version]),
  );
  for (const [packageName, expected] of Object.entries(SDK_VERSIONS)) {
    if (installedVersions[packageName] !== expected) {
      throw new Error(`${packageName} must be ${expected}; installed ${installedVersions[packageName] ?? "missing"}`);
    }
  }

  const codingAgent = packageManifest("@earendil-works/pi-coding-agent");
  const cliRelative = codingAgent.bin?.pi;
  if (typeof cliRelative !== "string") throw new Error("Pinned Pi coding-agent package does not expose its pi CLI bin");
  const cliPath = path.join(ROOT, "node_modules", "@earendil-works", "pi-coding-agent", cliRelative);
  const cliVersion = codingAgent.version;
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "glm-vision-pi-sdk-smoke-"));
  const agentDir = path.join(tempRoot, "isolated-agent");
  const homeDir = path.join(tempRoot, "isolated-home");
  await Promise.all([mkdir(agentDir, { recursive: true }), mkdir(homeDir, { recursive: true })]);
  const imagePath = path.join(tempRoot, "smoke.png");
  await writeFile(imagePath, Buffer.from(PNG_BASE64, "base64"));
  const modelServer = await startModelServer();
  const report = {
    schema_version: 1,
    verification_contract: "pi-sdk-behavior-v2",
    sdk_versions: SDK_VERSIONS,
    extension_load_errors: 0,
    unhandled_errors: 0,
    cases: [],
  };
  const caseEvidence = {};
  let failed = false;

  try {
    const models = {
      providers: {
        zai: {
          baseUrl: modelServer.baseUrl,
          api: "openai-completions",
          apiKey: "offline-smoke-key",
          models: [
            {
              id: "glm-4.6",
              name: "GLM offline smoke fixture",
              contextWindow: 8_192,
              maxTokens: 1_024,
              input: ["text", "image"],
            },
          ],
        },
      },
    };
    const envForMode = async (visionMode, suffix) => {
      const visionLog = path.join(tempRoot, `${suffix}-vision.jsonl`);
      await writeFile(visionLog, "", "utf8");
      const agentDirForCase = path.join(tempRoot, `${suffix}-agent`);
      const homeDirForCase = path.join(tempRoot, `${suffix}-home`);
      await Promise.all([
        mkdir(agentDirForCase, { recursive: true }),
        mkdir(homeDirForCase, { recursive: true }),
      ]);
      await writeFile(path.join(agentDirForCase, "models.json"), `${JSON.stringify(models, null, 2)}\n`, "utf8");
      const env = createIsolatedEnv({
        agentDir: agentDirForCase,
        homeDir: homeDirForCase,
        tempRoot,
        visionMode,
        visionLog,
      });
      return env;
    };
    const appendCase = (name, result) => {
      const record = caseEntry(name, "npm run smoke:pi", result);
      report.cases.push(record);
      caseEvidence[name] = safeSummary(result.evidence, tempRoot);
      const processes = result.processes ?? (result.process ? [result.process] : []);
      for (const process of processes) {
        report.extension_load_errors += process.extension_load_errors ?? 0;
        report.unhandled_errors += process.unhandled_errors ?? 0;
      }
      if (!record.passed) failed = true;
      return record;
    };

    const loadEnv = await envForMode("success", "extension-load");
    const loadCase = await runExtensionLoad({ cliPath, env: loadEnv, repoRoot: ROOT, modelServer, tempRoot, visionLog: loadEnv.PI_SMOKE_VISION_LOG });
    appendCase("extension_load", loadCase);

    const happyEnv = await envForMode("success", "happy-path");
    const happyCase = await runFeatureCase({
      name: "happy_path",
      mode: "success",
      cliPath,
      env: happyEnv,
      repoRoot: ROOT,
      modelServer,
      imagePath,
      tempRoot,
    });
    appendCase("happy_path", happyCase);

    const errorEnv = await envForMode("error", "error-path");
    const errorCase = await runFeatureCase({
      name: "error_path",
      mode: "error",
      cliPath,
      env: errorEnv,
      repoRoot: ROOT,
      modelServer,
      imagePath,
      tempRoot,
    });
    appendCase("error_path", errorCase);

    const reloadCase = await runReloadCase({ cliPath, envForMode, repoRoot: ROOT, modelServer, imagePath, tempRoot });
    appendCase("reload_cleanup", reloadCase);

    const hostShellCase = await runHostShellCase({ cliPath, cliVersion, agentDir, homeDir, tempRoot });
    appendCase("host_shell", hostShellCase);

    const evidence = {
      schema_version: 1,
      verification_contract: "pi-sdk-behavior-v2",
      command: "npm run smoke:pi",
      cli_version: cliVersion,
      sdk_versions: SDK_VERSIONS,
      host_platform: process.platform,
      isolation: {
        agent_directory: "temporary isolated PI_CODING_AGENT_DIR",
        user_home: "temporary isolated HOME/USERPROFILE",
        sessions: "--no-session",
        extensions: "--no-extensions with only the explicit repository extension",
        network: "loopback-only Pi/provider traffic; the exact Z.AI image-description endpoint is intercepted and all other non-loopback fetch() calls are rejected",
        model_inference: "deterministic offline fixture; no paid or external provider inference",
        production_global_pi_settings_touched: false,
      },
      cases: caseEvidence,
    };

    await mkdir(path.dirname(REPORT_PATH), { recursive: true });
    await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await writeFile(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    if (report.cases.length !== 5 || report.extension_load_errors !== 0 || report.unhandled_errors !== 0) {
      failed = true;
    }
    if (failed) {
      console.error(`Pi SDK behavior-v2 smoke failed; report written to ${path.relative(ROOT, REPORT_PATH)}`);
      process.exitCode = 1;
    } else {
      console.log(`Pi SDK ${cliVersion} behavior-v2 smoke passed: 5 actual-host cases, load errors=0, unhandled errors=0.`);
    }
  } finally {
    modelServer.server.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
