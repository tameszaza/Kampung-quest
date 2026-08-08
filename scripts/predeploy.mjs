import { spawnSync } from "node:child_process";

const phases = [
  ["production environment validation", "scripts/validate-production-env.mjs"],
  ["database migrations", "scripts/migrate.mjs"],
];

for (const [label, script] of phases) {
  console.log(`Starting ${label}...`);
  const result = spawnSync(process.execPath, [script], {
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  console.log(`Completed ${label}.`);
}
