import { describe, expect, it } from "vitest";
import { REDACTED, redactText } from "./redaction.js";

describe("trace redaction", () => {
  it.each([
    "ARK_API_KEY=secret-value",
    "API_KEY=secret-value",
    "api_key: secret-value",
    "Authorization: Bearer secret-value",
    "Bearer secret-value",
    "password=secret-value",
    "token: secret-value",
    "client_secret=secret-value",
    '{"api_key":"secret-value"}',
    "https://user:secret-value@example.com/path",
    "https://example.com/path?token=secret-value&safe=yes",
  ])("removes a supported secret form: %s", (input) => {
    const result = redactText(input, 1_024);
    expect(result.text).toContain(REDACTED);
    expect(result.text).not.toContain("secret-value");
    expect(result.redactionCount).toBeGreaterThan(0);
  });

  it("preserves useful context and is text-idempotent", () => {
    const first = redactText("request failed: token=secret-value; retry allowed", 1_024);
    const second = redactText(first.text, 1_024);
    expect(first.text).toBe("request failed: token=[REDACTED]; retry allowed");
    expect(second.text).toBe(first.text);
    const authorization = redactText(
      "failure: Authorization: Bearer secret-value",
      1_024,
    );
    expect(redactText(authorization.text, 1_024).text).toBe(authorization.text);
  });

  it("bounds adversarially long input before and after redaction", () => {
    const result = redactText("API_KEY=" + "x".repeat(100_000), 128);
    expect(result.text.length).toBeLessThanOrEqual(128);
    expect(result.truncated).toBe(true);
    expect(result.text).not.toContain("x".repeat(64));
  });
});
