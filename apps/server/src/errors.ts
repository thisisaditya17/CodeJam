export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export class RunCancelledError extends Error {
  constructor() {
    super("Run cancelled");
    this.name = "RunCancelledError";
  }
}

export class RunExecutionError extends Error {
  constructor(
    public readonly code: RunFailureCode,
    message: string,
    public readonly exitCode?: number,
  ) {
    super(message);
    this.name = "RunExecutionError";
  }
}
import type { RunFailureCode } from "./types.js";
