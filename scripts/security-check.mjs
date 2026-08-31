import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const tracked = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  {
    cwd: root,
    encoding: "utf8",
  },
)
  .split("\0")
  .filter(Boolean);
const failures = [];

for (const file of tracked) {
  const base = path.basename(file);
  if (
    base === ".env" ||
    (/^\.env\./.test(base) && !base.endsWith(".example")) ||
    /\.tfstate(?:\.|$)/.test(base) ||
    /\.(?:key|pem|p12|pfx)$/i.test(base)
  ) {
    failures.push("tracked sensitive state: " + file);
  }
  const fullPath = path.join(root, file);
  if (statSync(fullPath).size <= 2_000_000) {
    const content = readFileSync(fullPath, "utf8");
    const privateKeyMarker = "BEGIN " + "PRIVATE KEY";
    const typedPrivateKeyMarker = new RegExp("BEGIN (?:RSA |EC |OPENSSH )PRIVATE KEY");
    if (content.includes(privateKeyMarker) || typedPrivateKeyMarker.test(content)) {
      failures.push("tracked private-key material: " + file);
    }
  }
}

const sourceFiles = tracked.filter(
  (file) =>
    (file.startsWith("apps/") || file.startsWith("scripts/")) &&
    /\.(?:[cm]?[jt]sx?)$/.test(file) &&
    !/\.test\.[cm]?[jt]sx?$/.test(file) &&
    file !== "scripts/security-check.mjs",
);
const dangerousPatterns = [
  ["dynamic evaluation", new RegExp("\\be" + "val\\s*\\(")],
  ["dynamic function construction", new RegExp("\\bnew\\s+Func" + "tion\\s*\\(")],
  ["React raw HTML injection", new RegExp("dangerouslySet" + "InnerHTML")],
  ["shell-enabled child process", /shell\s*:\s*true/],
];

for (const file of sourceFiles) {
  const content = readFileSync(path.join(root, file), "utf8");
  for (const [label, pattern] of dangerousPatterns) {
    if (pattern.test(content)) failures.push(label + ": " + file);
  }
}

for (const file of tracked.filter((candidate) => candidate.endsWith(".sh"))) {
  const content = readFileSync(path.join(root, file), "utf8");
  if (/(?:^|\n)\s*(?:source|\.)\s+[^\n]*(?:\.env|env_file)/.test(content)) {
    failures.push("shell-executed dotenv file: " + file);
  }
}

const requiredControls = [
  ["Dockerfile", /\nUSER node\n/],
  ["Dockerfile.runtime", /\nUSER node\n/],
  ["docker-compose.yml", /\n\s+read_only: true\n/],
  ["docker-compose.yml", /no-new-privileges:true/],
  ["docker-compose.yml", /\n\s+cap_drop:\n\s+- ALL\n/],
  ["apps/server/src/container-codex-runner.ts", /"--read-only"/],
  ["apps/server/src/container-codex-runner.ts", /"--cap-drop",\n\s+"ALL"/],
  ["apps/server/src/container-codex-runner.ts", /"no-new-privileges"/],
  ["scripts/deploy-volcengine.sh", /read-dotenv\.mjs/],
];
for (const [file, pattern] of requiredControls) {
  const content = readFileSync(path.join(root, file), "utf8");
  if (!pattern.test(content)) failures.push("missing required hardening control: " + file);
}

if (failures.length > 0) {
  console.error("Security guardrail check failed:\n- " + failures.join("\n- "));
  process.exitCode = 1;
} else {
  console.log(
    "Security guardrail check passed (tracked-secret, dangerous-construct, and container-control checks).",
  );
}
