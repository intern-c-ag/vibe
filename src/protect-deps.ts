/**
 * `vibe protect deps` — minimal supply-chain protection for package managers.
 * Detects npm/pnpm/yarn/bun/uv and writes repo-local config to enforce
 * a minimum release age on new dependencies.
 */

import { existsSync, readFileSync, writeFileSync, appendFileSync } from "fs";
import { join } from "path";
import { createInterface } from "readline";
import { colors } from "./ui.js";

interface PmStatus {
  name: string;
  detected: boolean;
  configured: boolean;
  configFile: string;
  key: string;
  line: string;
}

function detect(dir: string): PmStatus[] {
  const pms: PmStatus[] = [];

  // npm
  const npmLock = existsSync(join(dir, "package-lock.json"));
  const npmrc = join(dir, ".npmrc");
  const npmContent = existsSync(npmrc) ? readFileSync(npmrc, "utf8") : "";
  pms.push({
    name: "npm",
    detected: npmLock || existsSync(join(dir, "package.json")),
    configured: npmContent.includes("min-release-age"),
    configFile: ".npmrc",
    key: "min-release-age",
    line: "min-release-age=7",
  });

  // pnpm
  const pnpmLock = existsSync(join(dir, "pnpm-lock.yaml"));
  const pnpmWs = join(dir, "pnpm-workspace.yaml");
  const pnpmContent = existsSync(pnpmWs) ? readFileSync(pnpmWs, "utf8") : "";
  pms.push({
    name: "pnpm",
    detected: pnpmLock,
    configured: pnpmContent.includes("minimumReleaseAge"),
    configFile: "pnpm-workspace.yaml",
    key: "minimumReleaseAge",
    line: "minimumReleaseAge: 10080",
  });

  // yarn (v2+)
  const yarnLock = existsSync(join(dir, "yarn.lock"));
  const yarnrc = join(dir, ".yarnrc.yml");
  const yarnContent = existsSync(yarnrc) ? readFileSync(yarnrc, "utf8") : "";
  pms.push({
    name: "yarn",
    detected: yarnLock,
    configured: yarnContent.includes("npmMinimalAgeGate"),
    configFile: ".yarnrc.yml",
    key: "npmMinimalAgeGate",
    line: "npmMinimalAgeGate: 7d",
  });

  // bun
  const bunLock = existsSync(join(dir, "bun.lockb")) || existsSync(join(dir, "bun.lock"));
  const bunfig = join(dir, "bunfig.toml");
  const bunContent = existsSync(bunfig) ? readFileSync(bunfig, "utf8") : "";
  pms.push({
    name: "bun",
    detected: bunLock,
    configured: bunContent.includes("minimumReleaseAge"),
    configFile: "bunfig.toml",
    key: "minimumReleaseAge",
    line: "[install]\nminimumReleaseAge = 604800",
  });

  // uv (Python)
  const uvLock = existsSync(join(dir, "uv.lock"));
  const pyproject = join(dir, "pyproject.toml");
  const uvContent = existsSync(pyproject) ? readFileSync(pyproject, "utf8") : "";
  pms.push({
    name: "uv",
    detected: uvLock || existsSync(join(dir, "requirements.txt")),
    configured: uvContent.includes("exclude-newer"),
    configFile: "pyproject.toml",
    key: "exclude-newer",
    line: '[tool.uv]\nexclude-newer = "7 days"',
  });

  return pms;
}

function ask(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase().startsWith("y"));
    });
  });
}

export async function protectDeps(dir: string): Promise<void> {
  const all = detect(dir);
  const detected = all.filter((p) => p.detected);

  if (detected.length === 0) {
    console.log(
      `${colors.yellow("⚠")} No supported package managers detected in ${dir}`
    );
    console.log(
      colors.dim("  Looked for: npm, pnpm, yarn, bun, uv")
    );
    return;
  }

  // Print status table
  console.log(`\n${colors.bold("Supply-chain protection status:")}\n`);
  console.log(
    `  ${"PM".padEnd(8)} ${"Config File".padEnd(24)} ${"Status"}`
  );
  console.log(`  ${"─".repeat(8)} ${"─".repeat(24)} ${"─".repeat(16)}`);
  for (const pm of detected) {
    const status = pm.configured
      ? colors.green("✔ configured")
      : colors.yellow("✘ missing");
    console.log(
      `  ${pm.name.padEnd(8)} ${pm.configFile.padEnd(24)} ${status}`
    );
  }

  const toFix = detected.filter((p) => !p.configured);
  if (toFix.length === 0) {
    console.log(`\n${colors.green("✔")} All detected package managers are already protected.`);
    return;
  }

  console.log(
    `\n${colors.bold("Will add minimum release-age gates to:")} ${toFix.map((p) => p.name).join(", ")}`
  );

  const consent = await ask(`\nProceed? [y/N] `);
  if (!consent) {
    console.log(colors.dim("Aborted."));
    return;
  }

  for (const pm of toFix) {
    const filePath = join(dir, pm.configFile);
    const exists = existsSync(filePath);
    if (exists) {
      let content = readFileSync(filePath, "utf8");
      if (!content.endsWith("\n")) content += "\n";
      appendFileSync(filePath, `${pm.line}\n`);
    } else {
      writeFileSync(filePath, `${pm.line}\n`);
    }
    console.log(
      `  ${colors.green("✔")} ${pm.configFile} ${exists ? "updated" : "created"}`
    );
  }

  console.log(`\n${colors.green("Done.")} Re-run ${colors.cyan("vibe protect deps")} to verify.`);
}
