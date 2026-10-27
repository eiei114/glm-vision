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
  it("flushes a final prompt response without a newline before rejecting later settlement waits", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const child = makeChild((_chunk, _encoding, callback) => callback());
    const rpc = makeRpcClient(child as never, Date.now() + 15_000, 1);
    const request = rpc.request("prompt");
    const response = { type: "response", id: "pi-smoke-0-prompt", success: true, data: { disposition: "started" } };

    child.stdout.write(JSON.stringify(response));
    expect(rpc.records).toHaveLength(0);
    expect(rpc.pendingWaiterCount).toBe(1);
    child.emit("close", 0, null);

    await expect(request).resolves.toEqual(response);
    const settled = rpc.waitForAgentSettled();
    expect(rpc.pendingWaiterCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    await expect(settled).rejects.toThrow("Pi process exited before the RPC response arrived");
    closeChild(child);
  });

  it("prefers a recorded matching response after close even when its deadline has elapsed", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const child = makeChild((_chunk, _encoding, callback) => callback());
    const rpc = makeRpcClient(child as never, Date.now() + 15_000, 1);
    const record = { type: "agent_settled" };
    child.stdout.write(JSON.stringify(record));
    child.emit("close", 0, null);

    await expect(rpc.waitFor((entry) => entry.type === "agent_settled", Date.now() - 1)).resolves.toEqual(record);
    expect(rpc.pendingWaiterCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    closeChild(child);
  });

  it("rejects unmatched waits after abnormal close immediately without creating timers", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const child = makeChild((_chunk, _encoding, callback) => callback());
    const rpc = makeRpcClient(child as never, Date.now() + 15_000, 1);
    child.emit("close", 1, null);

    const response = rpc.waitFor(() => true);
    expect(rpc.pendingWaiterCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    await expect(response).rejects.toThrow("Pi process exited before the RPC response arrived");
    closeChild(child);
  });

  it("does not write new requests to a closed child's stdin", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const write = vi.fn((_chunk, _encoding, callback) => callback());
    const child = makeChild(write);
    const rpc = makeRpcClient(child as never, Date.now() + 15_000, 1);
    child.emit("close", 0, null);

    await expect(rpc.request("get_commands")).rejects.toThrow("Pi process exited before the RPC response arrived");
    expect(write).not.toHaveBeenCalled();
    expect(rpc.pendingWaiterCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    closeChild(child);
  });

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
