import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import type { GeneratedSkill } from "./generator.js";
import type { FileEntry, ProjectContext } from "./deep-scanner.js";

const MAX_EXAMPLE_CHARS = 420;

interface SkillDraft {
  suffix: string;
  category: "domain" | "architecture" | "conventions" | "security" | "testing";
  description: string;
  markdown: string;
}

function toKebab(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}

function pickExamples(files: FileEntry[], limit: number): FileEntry[] {
  return [...files]
    .sort((a, b) => {
      const depthA = a.path.split("/").length;
      const depthB = b.path.split("/").length;
      if (depthA !== depthB) return depthA - depthB;
      return b.lines - a.lines;
    })
    .slice(0, limit);
}

function codeFence(file: FileEntry): string {
  const lang = file.language === "unknown" ? "txt" : file.language;
  const snippet = clip(
    file.content
      .split("\n")
      .map((l) => l.replace(/\t/g, "  ").trimEnd())
      .filter(Boolean)
      .slice(0, 18)
      .join("\n"),
    MAX_EXAMPLE_CHARS,
  );
  return `### ${file.path}\n\n\`\`\`${lang}\n${snippet}\n\`\`\``;
}

function domainSkill(ctx: ProjectContext): SkillDraft {
  const readme = ctx.docs.find((d) => /^readme/i.test(basename(d.path)));
  const examples = pickExamples([...ctx.docs, ...ctx.references, ...ctx.sourceFiles], 3);

  return {
    suffix: "domain",
    category: "domain",
    description: `Domain map and terminology for ${ctx.name}`,
    markdown: `# ${ctx.name} Domain Guide\n\n## Description\n${clip(ctx.identity.replace(/\n+/g, " "), 380)}\n\n## Patterns\n- Primary languages: ${ctx.stack.languages.join(", ") || "unknown"}\n- Framework/runtime footprint: ${ctx.stack.frameworks.join(", ") || "none detected"} (runtime: ${ctx.stack.runtime || "unknown"})\n- Product/domain language should follow top-level docs first (${readme?.path ?? "README not found"}).\n\n## Conventions\n- Keep business terms aligned with names already used in docs and manifests.\n- Prefer extending existing feature directories before adding new top-level folders.\n- Reuse shared utilities from existing modules before introducing duplicates.\n\n## Anti-Patterns\n- Introducing new domain terms that conflict with README naming.\n- Re-implementing behavior already documented in references/examples.\n- Splitting one workflow across unrelated directories without a clear boundary.\n\n## Examples\n${examples.map(codeFence).join("\n\n")}\n\n## References\n- ${readme?.path ?? "README.md (missing)"}`,
  };
}

function architectureSkill(ctx: ProjectContext): SkillDraft {
  const examples = pickExamples(ctx.sourceFiles, 3);
  const structure = ctx.structure.slice(0, 12).map((p) => `- ${p}`).join("\n") || "- (structure unavailable)";

  return {
    suffix: "architecture",
    category: "architecture",
    description: `Architecture and module boundaries for ${ctx.name}`,
    markdown: `# ${ctx.name} Architecture\n\n## Description\nHow this repository is organized and where to extend code safely.\n\n## Patterns\n- Existing directory map (top paths):\n${structure}\n- Keep layers cohesive: docs/manifests define contracts; source files implement behavior.\n- Prefer flow-aligned modules over generic utility buckets.\n\n## Conventions\n- Follow nearest-neighbor placement: new files should sit next to related modules.\n- Preserve path depth patterns already present in ${ctx.name}.\n- Update both source and docs when changing cross-cutting behavior.\n\n## Anti-Patterns\n- Creating new top-level folders for one-off logic.\n- Circular module references across distant directories.\n- Mixing infra/config logic directly into domain modules without boundaries.\n\n## Examples\n${examples.map(codeFence).join("\n\n")}\n\n## References\n- ${ctx.manifests.slice(0, 5).map((m) => m.path).join("\n- ") || "No manifests detected"}`,
  };
}

function conventionsSkill(ctx: ProjectContext): SkillDraft {
  const examples = pickExamples(ctx.sourceFiles, 3);

  return {
    suffix: "conventions",
    category: "conventions",
    description: `Code style and naming conventions for ${ctx.name}`,
    markdown: `# ${ctx.name} Coding Conventions\n\n## Description\nConcrete coding conventions observed in this repository.\n\n## Patterns\n- Keep naming and export style consistent with nearby modules.\n- Preserve import grouping/order used by existing files.\n- Keep modules focused on one cohesive concern.\n\n## Conventions\n- Match quote/semicolon/comma style from surrounding code.\n- Keep declarations and guard clauses readable and shallow.\n- Prefer existing utility abstractions over ad-hoc duplication.\n\n## Anti-Patterns\n- Mixed naming styles within the same module.\n- Formatter drift from existing project conventions.\n- Copy/paste logic without extraction when repetition appears.\n\n## Examples\n${examples.map(codeFence).join("\n\n")}\n\n## References\n- ${ctx.manifests.filter((m) => /eslint|biome|prettier|tsconfig|package\.json/i.test(m.path)).slice(0, 5).map((m) => m.path).join("\n- ") || "No formatter/linter config detected"}`,
  };
}

function securitySkill(ctx: ProjectContext): SkillDraft {
  const sensitive = [
    ...ctx.sourceFiles.filter((f) => /(auth|token|secret|password|crypto|sign|verify|permission|role|acl|middleware)/i.test(f.path)),
    ...ctx.manifests.filter((f) => /(docker|compose|package\.json|cargo\.toml|pyproject|go\.mod|\.env)/i.test(f.path)),
  ];
  const examples = pickExamples(sensitive.length ? sensitive : ctx.sourceFiles, 3);

  return {
    suffix: "security",
    category: "security",
    description: `Security guardrails derived from ${ctx.name}`,
    markdown: `# ${ctx.name} Security\n\n## Description\nSecurity considerations grounded in this repository's real paths and dependency surface.\n\n## Patterns\n- Validate untrusted inputs at boundaries (API handlers, CLI args, env parsing).\n- Prefer explicit allow-lists and typed validation over implicit coercion.\n- Keep credentials out of source; use environment/config injection.\n\n## Conventions\n- Security-sensitive changes should include a test or reproducible check.\n- Pin and audit dependency updates in manifest files before release.\n- Keep permission checks close to entry points, not buried in helpers.\n\n## Anti-Patterns\n- Logging secrets/tokens or full sensitive payloads.\n- Trusting client-provided flags without server-side verification.\n- Expanding permission scope without least-privilege review.\n\n## Examples\n${examples.map(codeFence).join("\n\n")}\n\n## References\n- ${ctx.manifests.slice(0, 5).map((m) => m.path).join("\n- ") || "No manifests detected"}`,
  };
}

function testingSkill(ctx: ProjectContext): SkillDraft {
  const tests = ctx.sourceFiles.filter((f) => f.category === "test" || /(test|spec|__tests__)/i.test(f.path));
  const examples = pickExamples(tests.length ? tests : ctx.sourceFiles, 3);

  return {
    suffix: "testing",
    category: "testing",
    description: `Testing strategy and examples for ${ctx.name}`,
    markdown: `# ${ctx.name} Testing\n\n## Description\nHow to test changes in this repository using detected frameworks and existing test shape.\n\n## Patterns\n- Detected testing tools: ${ctx.stack.testing.join(", ") || "none detected"}.\n- Keep tests close to behavior boundaries (routes, services, pure functions).\n- Prefer deterministic fixtures and isolated setup/teardown.\n\n## Conventions\n- Name test files by behavior intent, not implementation detail.\n- Use table-driven/parameterized tests for repeated branches.\n- For regressions, add one failing case first, then patch implementation.\n\n## Anti-Patterns\n- Snapshot-only tests for critical logic without explicit assertions.\n- Over-mocking where integration behavior is the core risk.\n- Tests that rely on network/time/randomness without controls.\n\n## Examples\n${examples.map(codeFence).join("\n\n")}\n\n## References\n- ${tests.slice(0, 5).map((t) => t.path).join("\n- ") || "No tests found; add baseline tests before large refactors."}`,
  };
}

export async function generateSkillsFromLocalContext(
  ctx: ProjectContext,
  outputDir: string,
  repoName: string,
  _signals?: unknown,
  categories?: Array<"domain" | "architecture" | "conventions" | "security" | "testing">,
): Promise<GeneratedSkill[]> {
  const base = toKebab(repoName || ctx.name || "repo");
  const allDrafts = [domainSkill(ctx), architectureSkill(ctx), conventionsSkill(ctx), securitySkill(ctx), testingSkill(ctx)];
  const drafts = categories?.length ? allDrafts.filter((d) => categories.includes(d.category)) : allDrafts;
  const out: GeneratedSkill[] = [];

  for (const draft of drafts) {
    const name = `${base}-${draft.suffix}`;
    const dir = join(outputDir, name);
    const skillPath = join(dir, "SKILL.md");
    await mkdir(dir, { recursive: true });
    await writeFile(skillPath, `${draft.markdown.trim()}\n`, "utf-8");
    await writeFile(
      join(dir, "meta.json"),
      JSON.stringify(
        {
          name,
          description: draft.description,
          category: draft.category,
          sourceRepo: repoName,
          createdAt: new Date().toISOString(),
          generator: "local-deterministic",
        },
        null,
        2,
      ),
      "utf-8",
    );
    out.push({ name, path: skillPath, description: draft.description, category: draft.category });
  }

  return out;
}
