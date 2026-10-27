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

export function makeRpcClient(child, deadlineAt, cleanupGraceMs = 1_000) {
  let stdoutBuffer = "";
  let stderr = "";
  let protocolErrors = [];
  const records = [];
  const waiters = new Set();
  let startError;
  let stdinError;
  let closed = false;
  const closePromise = new Promise((resolve) => {
    child.once("close", (code, signal) => resolve({ code, signal }));
  });

  const rejectWaiters = (error) => {
    for (const waiter of [...waiters]) {
      waiters.delete(waiter);
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  };

  const handleStdinError = (error) => {
    if (stdinError) return;
    const message = error instanceof Error ? error.message : String(error);
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    stdinError = code ? `${code}: ${message}` : message;
    rejectWaiters(new Error(`Pi child stdin failed: ${stdinError}`));
  };

  child.once("error", (error) => {
    startError = error.message;
    rejectWaiters(new Error(`Pi child failed to start: ${error.message}`));
  });
  child.stdin.on("error", handleStdinError);

  const deliver = (record) => {
    records.push(record);
    for (const waiter of [...waiters]) {
      if (waiter.predicate(record)) {
        waiters.delete(waiter);
        clearTimeout(waiter.timer);
        waiter.resolve(record);
      }
    }
  };

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk;
    let newline;
    while ((newline = stdoutBuffer.indexOf("\n")) >= 0) {
      const line = stdoutBuffer.slice(0, newline).replace(/\r$/, "");
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      try {
        deliver(JSON.parse(line));
      } catch {
        protocolErrors.push(line.slice(0, 500));
      }
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-16_000);
  });
  child.on("close", () => {
    closed = true;
    if (stdoutBuffer.trim()) {
      try {
        deliver(JSON.parse(stdoutBuffer));
      } catch {
        protocolErrors.push(stdoutBuffer.slice(0, 500));
      }
      stdoutBuffer = "";
    }
    rejectWaiters(new Error("Pi process exited before the RPC response arrived"));
  });

  return {
    child,
    records,
    get stderr() {
      return stderr;
    },
    get protocolErrors() {
      return protocolErrors;
    },
    get startError() {
      return startError;
    },
    get stdinError() {
      return stdinError;
    },
    get pendingWaiterCount() {
      return waiters.size;
    },
    async waitFor(predicate, deadline = deadlineAt) {
      const found = records.find(predicate);
      if (found) return found;
      if (closed) throw new Error("Pi process exited before the RPC response arrived");
      if (startError) throw new Error(`Pi child failed to start: ${startError}`);
      if (stdinError) throw new Error(`Pi child stdin failed: ${stdinError}`);
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("Pi RPC probe exceeded its 15s deadline");
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve, reject, timer: undefined };
        waiter.timer = setTimeout(() => {
          waiters.delete(waiter);
          reject(new Error("Pi RPC probe exceeded its 15s deadline"));
        }, remaining);
        waiters.add(waiter);
      });
    },
    async request(type, fields = {}) {
      const id = `pi-smoke-${records.length}-${type}`;
      const response = this.waitFor(
        (record) => record.type === "response" && record.id === id,
      );
      if (closed || startError || stdinError) return await response;
      try {
        child.stdin.write(`${JSON.stringify({ id, type, ...fields })}\n`);
      } catch (error) {
        handleStdinError(error);
      }
      const result = await response;
      if (!result.success) throw new Error(`Pi RPC ${type} failed: ${result.error ?? "unspecified error"}`);
      return result;
    },
    async waitForAgentSettled() {
      return this.waitFor((record) => record.type === "agent_settled");
    },
    async closeGracefully() {
      if (!child.stdin.destroyed) child.stdin.end();
      let timedOut = false;
      let close;
      try {
        const remaining = deadlineAt - Date.now();
        if (remaining <= 0) throw new Error("deadline elapsed before Pi shutdown");
        close = await waitForClose(closePromise, remaining);
      } catch {
        timedOut = true;
        if (child.pid && child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
        try {
          close = await waitForClose(closePromise, cleanupGraceMs);
        } catch {
          close = { code: null, signal: "cleanup-timeout" };
        }
      }
      return { ...close, timedOut };
    },
  };
}
