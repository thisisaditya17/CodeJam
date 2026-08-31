const canary = "techjam-demo-canary-not-a-secret";

process.stderr.write(
  "Injected Runtime failure. Authorization: Bearer " + canary + "\n",
);
process.exitCode = 17;
