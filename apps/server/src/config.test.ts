import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("configuration validation", () => {
  it("rejects unsafe logging, model, URL, and directory values", () => {
    expect(() => loadConfig({ NODE_ENV: "test", LOG_LEVEL: "verbose" })).toThrow();
    expect(() => loadConfig({ NODE_ENV: "test", ARK_MODEL: "model; rm -rf" })).toThrow();
    expect(() =>
      loadConfig({ NODE_ENV: "test", ARK_BASE_URL: "https://user:pass@example.com/v3" }),
    ).toThrow(/credentials/);
    expect(() =>
      loadConfig({ NODE_ENV: "test", ARK_BASE_URL: "https://example.com/v3?token=value" }),
    ).toThrow(/query/);
    expect(() =>
      loadConfig({ NODE_ENV: "test", ARK_BASE_URL: "ftp://example.com/v3" }),
    ).toThrow(/HTTP or HTTPS/);
    expect(() => loadConfig({ NODE_ENV: "test", APP_DATA_DIR: path.parse(process.cwd()).root })).toThrow(
      /filesystem root/,
    );
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        APP_DATA_DIR: "/tmp/shared-launchpad-directory",
        CODEX_HOME: "/tmp/shared-launchpad-directory",
      }),
    ).toThrow(/must be distinct/);
  });

  it("requires HTTPS for a non-loopback production Ark endpoint", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        ARK_BASE_URL: "http://api.example.com/v3",
      }),
    ).toThrow(/must use HTTPS/);
    expect(
      loadConfig({
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        ARK_BASE_URL: "http://localhost:8080/v3",
      }).arkBaseUrl,
    ).toBe("http://localhost:8080/v3");
  });
});
