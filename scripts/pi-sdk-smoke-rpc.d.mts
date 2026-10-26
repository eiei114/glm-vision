import type { ChildProcess } from "node:child_process";

export interface RpcRecord {
  type: string;
  id?: string;
  success?: boolean;
  error?: string;
  [key: string]: unknown;
}

export interface RpcClient {
  child: ChildProcess;
  records: RpcRecord[];
  readonly stderr: string;
  readonly protocolErrors: string[];
  readonly startError: string | undefined;
  readonly stdinError: string | undefined;
  readonly pendingWaiterCount: number;
  waitFor(predicate: (record: RpcRecord) => boolean, deadline?: number): Promise<RpcRecord>;
  request(type: string, fields?: Record<string, unknown>): Promise<RpcRecord>;
  waitForAgentSettled(): Promise<RpcRecord>;
  closeGracefully(): Promise<{ code: number | null; signal: NodeJS.Signals | string | null; timedOut: boolean }>;
}

export function makeRpcClient(child: ChildProcess, deadlineAt: number, cleanupGraceMs?: number): RpcClient;
