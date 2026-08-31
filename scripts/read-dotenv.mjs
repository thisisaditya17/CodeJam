import { readFileSync } from "node:fs";

const [filePath, requestedName] = process.argv.slice(2);
if (!filePath || !requestedName || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(requestedName)) {
  console.error("Usage: node scripts/read-dotenv.mjs <file> <variable-name>");
  process.exit(2);
}

const values = new Map();
for (const [index, originalLine] of readFileSync(filePath, "utf8").split(/\r?\n/).entries()) {
  const line = originalLine.trim();
  if (!line || line.startsWith("#")) continue;
  const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
  if (!match) {
    console.error("Invalid dotenv syntax on line " + (index + 1));
    process.exit(2);
  }
  const name = match[1];
  let value = match[2] ?? "";
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    value = value.slice(1, -1);
  }
  values.set(name, value);
}

process.stdout.write(values.get(requestedName) ?? "");
