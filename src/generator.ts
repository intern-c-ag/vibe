import { execFile, spawn } from "child_process";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface GeneratedSkill {
  name: string;
  path: string;
  description: string;
  category: string;
}

export interface RepoProfile {
  name: string;
  language: string;
  framework?: string;
  patterns: string[];
  structure: Record<string, string[]>;
  dependencies: Record<string, string>;
  testFramework?: string;
  conventions: string[];
  summary: string;
}

interface SkillSpec {
  name: string;
  category: string;
  promptFocus: string;
}

function buildSkillSpecs(profile: RepoProfile): SkillSpec[] {
  const specs: SkillSpec[] = [
    {
      name: "architecture",
      category: "architecture",
      promptFocus: "overall architecture, directory structure, module organization, and dependency flow",
    },
    {
      name: "coding-conventions",
      category: "conventions",
      promptFocus: "naming conventions, code style, formatting rules, import ordering, and idiomatic patterns",
    },
  ];

  if (profile.testFramework || profile.patterns.some((p) => /test/i.test(p))) {
    specs.push({
      name: "testing-patterns",
      category: "testing",
      promptFocus: "testing strategy, test file organization, mocking patterns, fixtures, and assertion styles",
    });
  }

  if (profile.framework) {
    specs.push({
      name: "component-patterns",
      category: "patterns",
      promptFocus: `${profile.framework} component patterns, composition, state management, and lifecycle usage`,
    });
  }

  const hasApi = Object.keys(profile.structure).some(
    (k) => /api|route|endpoint|controller/i.test(k)
  );
  if (hasApi) {
    specs.push({
      name: "api-patterns",
      category: "patterns",
      promptFocus: "API design, route structure, middleware usage, request/response patterns, and error handling",
    });
  }

  if (profile.patterns.length > 0) {
    specs.push({
      name: "common-patterns",
      category: "patterns",
      promptFocus: "recurring design patterns, shared utilities, error handling strategies, and data flow patterns",
    });
  }

  return specs;
}

function buildPrompt(profile: RepoProfile, spec: SkillSpec): string {
  return `You are analyzing a codebase to generate a developer skill reference.

Repository: ${profile.name}
Language: ${profile.language}
${profile.framework ? `Framework: ${profile.framework}` : ""}
${profile.testFramework ? `Test Framework: ${profile.testFramework}` : ""}

Summary: ${profile.summary}

Detected Patterns: ${profile.patterns.join(", ")}
Conventions: ${profile.conventions.join(", ")}

Directory Structure:
${Object.entries(profile.structure)
  .map(([dir, files]) => `  ${dir}/: ${files.slice(0, 8).join(", ")}${files.length > 8 ? "..." : ""}`)
  .join("\n")}

Key Dependencies: ${Object.entries(profile.dependencies).slice(0, 15).map(([k, v]) => `${k}@${v}`).join(", ")}

Focus on: ${spec.promptFocus}

Generate a SKILL.md file with this exact format:

# ${spec.name.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ")}

## Description
<One paragraph: when and why a developer should consult this skill>

## Patterns
<Detected patterns with concrete examples from this codebase. Use code blocks where helpful.>

## Conventions
<Naming, structure, and style conventions specific to this focus area>

## Examples
<2-3 representative code examples showing the patterns in action. Use fenced code blocks.>

Output ONLY the markdown content, no extra commentary.`;
}

class Semaphore {
  private queue: (() => void)[] = [];
  private active = 0;

  constructor(private max: number) {}

  async acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.active++;
        resolve();
      });
    });
  }

  release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}

async function checkClaudeAvailable(): Promise<boolean> {
  try {
    await execFileAsync("which", ["claude"]);
    return true;
  } catch {
    return false;
  }
}

function runClaude(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("claude", ["-p", prompt, "--output-format", "text"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));

    proc.on("error", (err) =>
      reject(new Error(`Failed to spawn claude: ${err.message}`))
    );

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`claude exited with code ${code}: ${stderr.trim()}`));
      } else {
        resolve(stdout);
      }
    });
  });
}

export async function generateSingleSkill(
  prompt: string,
  outputDir: string,
  name: string
): Promise<GeneratedSkill> {
  if (!(await checkClaudeAvailable())) {
    throw new Error(
      "claude CLI not found. Install it from https://docs.anthropic.com/en/docs/claude-cli"
    );
  }

  const content = await runClaude(prompt);
  const skillDir = join(outputDir, name);
  const skillPath = join(skillDir, "SKILL.md");

  await mkdir(skillDir, { recursive: true });
  await writeFile(skillPath, content, "utf-8");

  // Extract description from first paragraph after ## Description
  const descMatch = content.match(/## Description\s*\n+([\s\S]*?)(?=\n##|\n*$)/);
  const description = descMatch
    ? descMatch[1].trim().split("\n")[0].slice(0, 120)
    : `Skill: ${name}`;

  return { name, path: skillPath, description, category: "general" };
}

export async function generateSkills(
  profile: RepoProfile,
  outputDir: string
): Promise<GeneratedSkill[]> {
  if (!(await checkClaudeAvailable())) {
    throw new Error(
      "claude CLI not found. Install it from https://docs.anthropic.com/en/docs/claude-cli"
    );
  }

  const specs = buildSkillSpecs(profile);
  const semaphore = new Semaphore(3);
  const results: GeneratedSkill[] = [];
  const errors: string[] = [];

  const tasks = specs.map(async (spec) => {
    await semaphore.acquire();
    try {
      const prompt = buildPrompt(profile, spec);
      const content = await runClaude(prompt);
      const skillDir = join(outputDir, spec.name);
      const skillPath = join(skillDir, "SKILL.md");

      await mkdir(skillDir, { recursive: true });
      await writeFile(skillPath, content, "utf-8");

      const descMatch = content.match(
        /## Description\s*\n+([\s\S]*?)(?=\n##|\n*$)/
      );
      const description = descMatch
        ? descMatch[1].trim().split("\n")[0].slice(0, 120)
        : `${spec.category} patterns for ${profile.name}`;

      results.push({
        name: spec.name,
        path: skillPath,
        description,
        category: spec.category,
      });
    } catch (err: any) {
      errors.push(`${spec.name}: ${err.message}`);
    } finally {
      semaphore.release();
    }
  });

  await Promise.all(tasks);

  if (results.length === 0 && errors.length > 0) {
    throw new Error(`All skill generations failed:\n${errors.join("\n")}`);
  }

  if (errors.length > 0) {
    console.warn(`Warning: ${errors.length} skill(s) failed:\n${errors.join("\n")}`);
  }

  return results;
}
