export const REDACTED = "[REDACTED]";

export interface RedactionResult {
  text: string;
  redactionCount: number;
  truncated: boolean;
}

const MAX_SCAN_CHARACTERS = 16_384;
const TRUNCATION_SUFFIX = "... [TRUNCATED]";
const SENSITIVE_KEY =
  "(?:ark_api_key|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd|token|secret)";

function bounded(text: string, maximum: number): { text: string; truncated: boolean } {
  if (text.length <= maximum) return { text, truncated: false };
  if (maximum <= TRUNCATION_SUFFIX.length) {
    return { text: TRUNCATION_SUFFIX.slice(0, maximum), truncated: true };
  }
  return {
    text: text.slice(0, maximum - TRUNCATION_SUFFIX.length) + TRUNCATION_SUFFIX,
    truncated: true,
  };
}

export function redactText(input: string, maximum = 512): RedactionResult {
  const scanned = bounded(String(input), MAX_SCAN_CHARACTERS);
  let text = scanned.text;
  let redactionCount = 0;

  const replaceSecret = (match: string, prefix: string, value: string): string => {
    if (value.includes(REDACTED)) return match;
    redactionCount += 1;
    return prefix + REDACTED;
  };

  text = text.replace(
    /\b(https?:\/\/)([^\s\/:@]{1,256}):([^\s\/@]{1,16384})@/gi,
    (_match, scheme: string) => {
      redactionCount += 1;
      return scheme + REDACTED + "@";
    },
  );

  const queryPattern = new RegExp(
    "([?&]" + SENSITIVE_KEY + "=)([^&#\\s]{1,16384})",
    "gi",
  );
  text = text.replace(queryPattern, replaceSecret);

  text = text.replace(
    /(\bauthorization\s*[:=]\s*(?:bearer|basic)\s+)([^\s,;}\r\n]{1,16384})/gi,
    replaceSecret,
  );

  text = text.replace(/(\bbearer\s+)([A-Za-z0-9._~+\/=:-]{4,16384})/gi, replaceSecret);

  const quotedAssignment = new RegExp(
    "([\\\"']?)(" + SENSITIVE_KEY + ")\\1(\\s*[:=]\\s*)([\\\"'])([^\\\"'\\r\\n]{1,16384})\\4",
    "gi",
  );
  text = text.replace(
    quotedAssignment,
    (match, keyQuote: string, key: string, separator: string, valueQuote: string, value: string) => {
      if (value.includes(REDACTED)) return match;
      redactionCount += 1;
      return keyQuote + key + keyQuote + separator + valueQuote + REDACTED + valueQuote;
    },
  );

  const unquotedAssignment = new RegExp(
    "([\\\"']?)(" + SENSITIVE_KEY + ")\\1(\\s*[:=]\\s*)([^\\s,;}\\r\\n&]{1,16384})",
    "gi",
  );
  text = text.replace(
    unquotedAssignment,
    (match, keyQuote: string, key: string, separator: string, value: string) => {
      if (value.includes(REDACTED)) return match;
      redactionCount += 1;
      return keyQuote + key + keyQuote + separator + REDACTED;
    },
  );

  const output = bounded(text, Math.max(0, maximum));
  return {
    text: output.text,
    redactionCount,
    truncated: scanned.truncated || output.truncated,
  };
}
