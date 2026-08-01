import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const outputDirectory = join(process.cwd(), ".next", "standalone");

if (!existsSync(outputDirectory)) {
  throw new Error("Standalone output is missing. Run this script after next build.");
}

mkdirSync(join(outputDirectory, ".next"), { recursive: true });
cpSync(join(process.cwd(), ".next", "static"), join(outputDirectory, ".next", "static"), {
  recursive: true,
});
cpSync(join(process.cwd(), "public"), join(outputDirectory, "public"), { recursive: true });
