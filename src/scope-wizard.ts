/**
 * Scope Wizard — interactive per-repo training scope configuration.
 *
 * Supports two levels of scope control:
 *   1. Top-level entry tagging (core | reference | deps/generated | ignore)
 *   2. Ordered glob rules with first-match-wins semantics for nested path control
 *
 * Persisted in `.vibe/scope.json` inside the target repo.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import * as readline from "node:readline";
import { colors } from "./ui.js";

// ── Types ─────────────────────────────────────────────────────────────────

export type ScopeTag = "core" | "reference" | "deps/generated" | "ignore";

export interface ScopeEntry {
  name: string;
  tag: ScopeTag;
}

/** Ordered glob rule — first match wins during path resolution */
export interface ScopeRule {
  glob: string;
  tag: ScopeTag;
}

/** V1 config (backward compat) */
export interface ScopeConfigV1 {
  version: 1;
  entries: ScopeEntry[];
  createdAt: string;
  updatedAt: string;
}

/** V2 config with hierarchical rules */
export interface ScopeConfig {
  version: 2;
  entries: ScopeEntry[];
  /** Ordered glob rules — first match wins. Evaluated before top-level entries. */
  rules: ScopeRule[];
  createdAt: string;
  updatedAt: string;
}

/** Weights applied during deep scan based on scope tags */
export interface ScopeWeights {
  /** Paths to include in deep scan (core + reference) */
  includePaths: string[];
  /** Paths to fully exclude from scan */
  excludePaths: string[];
  /** Paths treated as reference (lower weight) */
  referencePaths: string[];
  /** Paths treated as core (full weight) */
  corePaths: string[];
  /** Ordered rules for fine-grained path matching */
  rules: ScopeRule[];
}

// ── Persistence ───────────────────────────────────────────────────────────

const SCOPE_DIR = ".vibe";
const SCOPE_FILE = "scope.json";

function scopePath(repoRoot: string): string {
  return join(repoRoot, SCOPE_DIR, SCOPE_FILE);
}

/** Migrate V1 config to V2 */
function migrateV1(v1: ScopeConfigV1): ScopeConfig {
  return {
    version: 2,
    entries: v1.entries,
    rules: [],
    createdAt: v1.createdAt,
    updatedAt: v1.updatedAt,
  };
}

export function loadScopeConfig(repoRoot: string): ScopeConfig | null {
  const p = scopePath(repoRoot);
  if (!existsSync(p)) return null;
  try {
    const raw = readFileSync(p, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.entries)) return null;
    if (parsed.version === 1) return migrateV1(parsed as ScopeConfigV1);
    if (parsed.version === 2) return parsed as ScopeConfig;
    return null;
  } catch {
    return null;
  }
}

export function saveScopeConfig(repoRoot: string, config: ScopeConfig): void {
  const dir = join(repoRoot, SCOPE_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(scopePath(repoRoot), JSON.stringify(config, null, 2) + "\n", "utf-8");
}

// ── Defaults / heuristics ─────────────────────────────────────────────────

const DEPS_PATTERNS = /^(node_modules|vendor|\.venv|venv|__pycache__|\.next|\.nuxt|dist|build|out|target|\.gradle|\.cache|\.tox|coverage|\.nyc_output|\.turbo)$/;
const GENERATED_PATTERNS = /^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Gemfile\.lock|poetry\.lock|Cargo\.lock|go\.sum|composer\.lock)$/;
const IGNORE_PATTERNS = /^(\.[a-z]+)$/;
const REFERENCE_PATTERNS = /^(reference|examples|docs|doc|wiki|specs|spec|samples|demo|demos|fixtures|testdata|test-data)$/i;

function guessTag(name: string, isDir: boolean): ScopeTag {
  if (DEPS_PATTERNS.test(name)) return "deps/generated";
  if (!isDir && GENERATED_PATTERNS.test(name)) return "deps/generated";
  if (REFERENCE_PATTERNS.test(name)) return "reference";
  if (isDir && IGNORE_PATTERNS.test(name) && name !== ".vibe") return "ignore";
  return "core";
}

// ── Top-level entry discovery ─────────────────────────────────────────────

interface TopLevelEntry {
  name: string;
  isDir: boolean;
  suggestedTag: ScopeTag;
}

function discoverTopLevel(repoRoot: string): TopLevelEntry[] {
  const entries: TopLevelEntry[] = [];
  for (const name of readdirSync(repoRoot).sort()) {
    if (name === ".git" || name === ".vibe") continue;
    let isDir = false;
    try {
      isDir = statSync(join(repoRoot, name)).isDirectory();
    } catch {
      continue;
    }
    entries.push({ name, isDir, suggestedTag: guessTag(name, isDir) });
  }
  return entries;
}

// ── Interactive terminal selector ─────────────────────────────────────────

const TAG_ORDER: ScopeTag[] = ["core", "reference", "deps/generated", "ignore"];
const TAG_COLORS: Record<ScopeTag, (s: string) => string> = {
  core: colors.green,
  reference: colors.cyan,
  "deps/generated": colors.yellow,
  ignore: colors.dim,
};

function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

/**
 * Run the interactive scope wizard.
 * Returns null if user declines or non-interactive.
 */
export async function runScopeWizard(
  repoRoot: string,
  opts: { editExisting?: boolean } = {},
): Promise<ScopeConfig | null> {
  if (!isInteractive()) return null;

  const existing = loadScopeConfig(repoRoot);
  if (!opts.editExisting && existing) return existing;

  if (!opts.editExisting) {
    const answer = await askLine("Configure training scope now? [Y/n] ");
    if (answer.toLowerCase() === "n") return null;
  }

  const topLevel = discoverTopLevel(repoRoot);
  if (topLevel.length === 0) {
    console.log(colors.dim("  No top-level entries found."));
    return null;
  }

  // Merge existing tags if editing
  const existingMap = new Map<string, ScopeTag>();
  if (existing) {
    for (const e of existing.entries) existingMap.set(e.name, e.tag);
  }

  const tags: ScopeTag[] = topLevel.map((e) =>
    existingMap.has(e.name) ? existingMap.get(e.name)! : e.suggestedTag,
  );

  // Step 1: top-level tagging
  const result = await interactiveSelect(topLevel, tags);
  if (!result) return null;

  const now = new Date().toISOString();
  const entries = topLevel.map((e, i) => ({ name: e.name, tag: result[i] }));
  let rules: ScopeRule[] = existing?.rules ?? [];

  // Step 2: optional refinement for core/reference folders
  const refinable = entries.filter((e) => e.tag === "core" || e.tag === "reference");
  if (refinable.length > 0) {
    const refine = await askLine("Add nested scope rules for core/reference folders? [y/N] ");
    if (refine.toLowerCase() === "y") {
      console.log(colors.dim("\n  Examples:"));
      console.log(colors.dim("    modules/**/reference/** -> ignore"));
      console.log(colors.dim("    modules/expo-tor-bridge/** -> core"));
      console.log(colors.dim("    src/generated/** -> deps/generated\n"));
      rules = await ruleEditor(rules);
    }
  }

  const config: ScopeConfig = {
    version: 2,
    entries,
    rules,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  saveScopeConfig(repoRoot, config);
  console.log(colors.green(`✔ Scope saved to ${SCOPE_DIR}/${SCOPE_FILE}`));
  return config;
}

/**
 * Interactive rule editor (prompt-based).
 */
export async function ruleEditor(initial: ScopeRule[]): Promise<ScopeRule[]> {
  const rules = [...initial];

  const printRules = () => {
    if (rules.length === 0) {
      console.log(colors.dim("  (no rules)"));
    } else {
      for (let i = 0; i < rules.length; i++) {
        const r = rules[i];
        const tagStr = TAG_COLORS[r.tag](`[${r.tag}]`);
        console.log(`  ${colors.dim(`${i + 1}.`)} ${r.glob.padEnd(40)} ${tagStr}`);
      }
    }
  };

  // eslint-disable-next-line no-constant-condition
  while (true) {
    console.log(colors.bold("\n  Rule Editor") + colors.dim(" — commands: add, list, delete <n>, save\n"));
    printRules();
    const cmd = (await askLine("\n  rule> ")).trim().toLowerCase();

    if (cmd === "save" || cmd === "s" || cmd === "") break;

    if (cmd === "list" || cmd === "l") {
      printRules();
      continue;
    }

    if (cmd === "add" || cmd === "a") {
      const glob = await askLine("  glob pattern (e.g. modules/**/reference/**): ");
      if (!glob.trim()) continue;
      const tagInput = await askLine("  tag (core/reference/deps/ignore) [ignore]: ");
      const tag = normalizeTagInput(tagInput.trim()) ?? "ignore";
      rules.push({ glob: glob.trim(), tag });
      console.log(colors.green(`  ✔ Added: ${glob.trim()} -> ${tag}`));
      continue;
    }

    if (cmd.startsWith("delete") || cmd.startsWith("del") || cmd.startsWith("d ") || cmd.startsWith("rm ")) {
      const numStr = cmd.replace(/^(delete|del|rm|d)\s*/, "");
      const idx = parseInt(numStr, 10) - 1;
      if (isNaN(idx) || idx < 0 || idx >= rules.length) {
        console.log(colors.yellow("  Invalid rule number."));
        continue;
      }
      const removed = rules.splice(idx, 1)[0];
      console.log(colors.dim(`  Removed: ${removed.glob} -> ${removed.tag}`));
      continue;
    }

    console.log(colors.dim("  Unknown command. Try: add, list, delete <n>, save"));
  }

  return rules;
}

function normalizeTagInput(input: string): ScopeTag | null {
  const map: Record<string, ScopeTag> = {
    core: "core",
    reference: "reference",
    ref: "reference",
    deps: "deps/generated",
    "deps/generated": "deps/generated",
    generated: "deps/generated",
    ignore: "ignore",
    skip: "ignore",
  };
  return map[input.toLowerCase()] ?? null;
}

/**
 * Run the standalone rule editor command (for `vibe scope-rules`).
 */
export async function runRuleEditor(repoRoot: string): Promise<void> {
  if (!isInteractive()) {
    console.log(colors.yellow("Rule editor requires an interactive terminal."));
    return;
  }

  const existing = loadScopeConfig(repoRoot);
  if (!existing) {
    console.log(colors.yellow("No scope config found. Run `vibe train` first to create one."));
    return;
  }

  console.log(colors.bold("\n  Nested Scope Rules\n"));
  const rules = await ruleEditor(existing.rules);
  existing.rules = rules;
  existing.updatedAt = new Date().toISOString();
  saveScopeConfig(repoRoot, existing);
  console.log(colors.green(`✔ Rules saved to ${SCOPE_DIR}/${SCOPE_FILE}`));
}

async function interactiveSelect(
  entries: TopLevelEntry[],
  tags: ScopeTag[],
): Promise<ScopeTag[] | null> {
  let cursor = 0;
  const result = [...tags];

  return new Promise<ScopeTag[] | null>((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    readline.emitKeypressEvents(process.stdin, rl);

    const render = () => {
      const lines = entries.length + 3;
      process.stdout.write(`\x1b[${lines}A\x1b[J`);
      printUI();
    };

    const printUI = () => {
      console.log(colors.bold("\n  Scope Wizard — tag each entry (↑/↓ move, ←/→ or Space cycle tag, Enter confirm, q quit)\n"));
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        const tag = result[i];
        const prefix = i === cursor ? colors.cyan("❯") : " ";
        const kind = e.isDir ? "[DIR]" : "[FILE]";
        const tagStr = TAG_COLORS[tag](`[${tag}]`);
        const name = i === cursor ? colors.bold(e.name) : e.name;
        console.log(`  ${prefix} ${kind} ${name.padEnd(30)} ${tagStr}`);
      }
    };

    printUI();

    const onKeypress = (_ch: string, key: readline.Key) => {
      if (!key) return;

      if (key.name === "q" || (key.ctrl && key.name === "c")) {
        cleanup();
        resolve(null);
        return;
      }

      if (key.name === "return") {
        cleanup();
        resolve(result);
        return;
      }

      if (key.name === "up") {
        cursor = (cursor - 1 + entries.length) % entries.length;
        render();
        return;
      }

      if (key.name === "down") {
        cursor = (cursor + 1) % entries.length;
        render();
        return;
      }

      if (key.name === "space" || key.name === "right") {
        const idx = TAG_ORDER.indexOf(result[cursor]);
        result[cursor] = TAG_ORDER[(idx + 1) % TAG_ORDER.length];
        render();
        return;
      }

      if (key.name === "left") {
        const idx = TAG_ORDER.indexOf(result[cursor]);
        result[cursor] = TAG_ORDER[(idx - 1 + TAG_ORDER.length) % TAG_ORDER.length];
        render();
        return;
      }
    };

    const cleanup = () => {
      process.stdin.removeListener("keypress", onKeypress);
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      rl.close();
    };

    process.stdin.on("keypress", onKeypress);
  });
}

function askLine(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<string>((resolve) => {
    rl.question(`${colors.cyan("?")} ${prompt}`, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ── Glob matching ─────────────────────────────────────────────────────────

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "::DOUBLE_STAR::")
    .replace(/\*/g, "[^/]*")
    .replace(/::DOUBLE_STAR::/g, ".*");
  return new RegExp(`^${escaped}$`);
}

/**
 * Resolve the effective tag for a file path using hierarchical rules.
 *
 * Resolution order (first match wins):
 *   1. Ordered glob rules
 *   2. Top-level entry match (path starts with entry name)
 *   3. Default: "core"
 */
export function resolvePathTag(filePath: string, config: ScopeConfig): ScopeTag {
  const normalized = filePath.replace(/\\/g, "/");

  // 1. Check ordered rules first (first match wins)
  for (const rule of config.rules) {
    if (globToRegExp(rule.glob).test(normalized)) {
      return rule.tag;
    }
  }

  // 2. Fall back to top-level entry match
  const firstSegment = normalized.split("/")[0];
  for (const entry of config.entries) {
    if (entry.name === firstSegment) {
      return entry.tag;
    }
  }

  // 3. Default
  return "core";
}

// ── Scope → scan behavior translation ─────────────────────────────────────

export function scopeToWeights(config: ScopeConfig): ScopeWeights {
  const corePaths: string[] = [];
  const referencePaths: string[] = [];
  const excludePaths: string[] = [];
  const includePaths: string[] = [];

  for (const entry of config.entries) {
    switch (entry.tag) {
      case "core":
        corePaths.push(entry.name);
        includePaths.push(entry.name);
        break;
      case "reference":
        referencePaths.push(entry.name);
        includePaths.push(entry.name);
        break;
      case "deps/generated":
      case "ignore":
        excludePaths.push(entry.name);
        break;
    }
  }

  return { includePaths, excludePaths, referencePaths, corePaths, rules: config.rules };
}

/**
 * Convert scope weights into exclude patterns suitable for deep scanner.
 * Includes both top-level excludes and glob rules tagged ignore/deps.
 */
export function scopeToExcludePatterns(weights: ScopeWeights): string[] {
  const patterns = weights.excludePaths.map((p) => `${p}/**`);
  // Add ignore/deps rules as exclude patterns too
  for (const rule of weights.rules) {
    if (rule.tag === "ignore" || rule.tag === "deps/generated") {
      if (!patterns.includes(rule.glob)) {
        patterns.push(rule.glob);
      }
    }
  }
  return patterns;
}

/**
 * Check if a file path falls under a reference scope (lower weight).
 * Uses hierarchical rule resolution.
 */
export function isReferencePath(filePath: string, weights: ScopeWeights, config?: ScopeConfig): boolean {
  // If full config available, use hierarchical resolution
  if (config) {
    return resolvePathTag(filePath, config) === "reference";
  }
  // Legacy fallback: simple prefix match
  return weights.referencePaths.some(
    (ref) => filePath === ref || filePath.startsWith(ref + "/"),
  );
}
