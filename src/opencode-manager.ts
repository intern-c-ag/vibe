import { execSync, spawn } from "child_process";
import { detectPlatform, commandExists } from "./claude-manager.js";

export function isOpencodeInstalled(): boolean {
  return commandExists("opencode");
}

export async function installOpencode(): Promise<{
  success: boolean;
  alreadyInstalled: boolean;
  error?: string;
}> {
  if (isOpencodeInstalled()) {
    return { success: true, alreadyInstalled: true };
  }

  try {
    execSync("curl -fsSL https://opencode.ai/install | bash", { stdio: "inherit" });
    return { success: true, alreadyInstalled: false };
  } catch (e: any) {
    return { success: false, alreadyInstalled: false, error: e.message };
  }
}

export function launchOpencode(cwd: string): void {
  if (!isOpencodeInstalled()) {
    throw new Error("Opencode is not installed. Run installOpencode() first.");
  }

  const child = spawn("opencode", [], {
    cwd,
    stdio: "inherit",
    shell: detectPlatform() === "windows",
  });

  child.on("error", (err) => {
    console.error(`Failed to launch Opencode: ${err.message}`);
    process.exit(1);
  });

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}
