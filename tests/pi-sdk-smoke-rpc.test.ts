import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeRpcClient } from "../scripts/pi-sdk-smoke-rpc.mjs";

type WriteFunction = NonNullable<NonNullable<ConstructorParameters<typeof Writable>[0]>["write"]>;

function makeChild(write: WriteFunction) {
  const child = Object.assign(new EventEmitter(), {
    stdin: new Writable({ write }),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    pid: 123,
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    kill: vi.fn(),
  });
  return child;
}

function closeChild(child: ReturnType<typeof makeChild>) {
  child.stdin.destroy();
  child.stdout.destroy();
  child.stderr.destroy();
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Pi smoke RPC child lifecycle", () => {
  it("records EPIPE and rejects pending requests without an unhandled stream error", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const pipeError = Object.assign(new Error("broken pipe"), { code: "EPIPE" });
    const child = makeChild((_chunk, _encoding, callback) => callback(pipeError));
    const rpc = makeRpcClient(child as never, Date.now() + 15_000, 1);
    const request = rpc.request("get_commands");

    await expect(request).rejects.toThrow("Pi child stdin failed: EPIPE: broken pipe");
    expect(rpc.stdinError).toBe("EPIPE: broken pipe");
    expect(rpc.pendingWaiterCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    closeChild(child);
  });

  it("rejects an unanswered RPC on child exit and clears its deadline timer", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const child = makeChild((_chunk, _encoding, _callback) => {});
    const rpc = makeRpcClient(child as never, Date.now() + 15_000, 1);
    const request = rpc.request("get_commands");

    expect(rpc.pendingWaiterCount).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
    child.emit("close", 1, null);

    await expect(request).rejects.toThrow("Pi process exited before the RPC response arrived");
    expect(rpc.pendingWaiterCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    closeChild(child);
  });
});
