import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";

import type { FileEntry, ProjectContext } from "./deep-scanner.js";
import { getCacheDir } from "./store.js";

export interface CachedSkillIndexEntry {
  name: string;
  description?: string;
  category?: string;
  path: string;
  sourceRepo?: string;
}

export interface TrainCacheEntry {
  version: number;
  repoPath: string;
  repoName: string;
  fingerprint: string;
  contextFingerprint?: string;
  createdAt: string;
  generatedAt: string;
  fileCount: number;
  skippedCount: number;
  skills: CachedSkillIndexEntry[];
  skillSignatures?: Record<string, string>;
  mcps?: string[];
}

const CACHE_VERSION = 2;

const SKIP_DIRS = new Set([
  ".git", ".svn", ".hg",
  "node_modules", "dist", "build", ".next", ".nuxt", ".output", ".svelte-kit",
  ".turbo", ".vercel", ".cache", ".parcel-cache", "out", "storybook-static",
  "__pycache__", ".venv", "venv", ".eggs", ".mypy_cache", ".pytest_cache",
  ".ruff_cache", ".tox", "site-packages", "htmlcov",
  "target", ".gradle", ".m2", ".mvn", ".idea", "classes",
  "bin", "obj", "packages", ".bundle", "vendor", ".dart_tool", ".pub-cache",
  "_build", "deps", "Pods", "DerivedData", ".terraform",
  "coverage", ".nyc_output", "tmp", "temp", "logs",
  ".vscode", ".vs", ".eclipse", ".settings",
]);

const SKIP_FILE_PATTERNS = [
  /^package-lock\.json$/, /^yarn\.lock$/, /^pnpm-lock\.yaml$/, /^bun\.lockb$/,
  /^Gemfile\.lock$/, /^poetry\.lock$/, /^Pipfile\.lock$/, /^composer\.lock$/,
  /^Cargo\.lock$/, /^go\.sum$/, /^pubspec\.lock$/,
  /\.(png|jpg|jpeg|gif|ico|svg|webp|bmp|tiff)$/i,
  /\.(woff2?|ttf|eot|otf)$/i,
  /\.(mp3|mp4|avi|mov|wav|ogg|webm)$/i,
  /\.(pdf|doc|docx|xls|xlsx|ppt|pptx)$/i,
  /\.(zip|tar|gz|bz2|rar|7z|dmg|iso|jar|war)$/i,
  /\.(exe|dll|so|dylib|o|a|pyc|pyo|class|wasm)$/i,
  /\.(sqlite|db|mdb)$/i,
  /\.map$/, /\.min\.(js|css)$/, /\.bundle\.(js|css)$/,
  /\.(csv|tsv)$/i,
];

const SENSITIVE_PATTERNS = [
  /^\.env/i, /\.env\./i, /secrets/i, /credentials/i,
  /\.key$/, /\.pem$/, /\.p12$/, /\.pfx$/, /\.crt$/,
  /\.keystore$/, /\.jks$/, /id_rsa/, /id_ed25519/,
  /\.htpasswd$/, /\.netrc$/, /\.npmrc$/, /\.pypirc$/,
];

const SENSITIVE_CONTENT = /(?:secret|password|passwd|token|api_key|apikey|private_key|access_key|secret_key|auth_token|bearer|jwt_secret|encryption_key|signing_key|client_secret|database_url|connection_string)\s*[:=]/i;

function shouldSkipDir(name: string): boolean {
  return SKIP_DIRS.has(name) || name.startsWith(".");
}

function shouldSkipFile(name: string, relPath: string): boolean {
  if (SKIP_FILE_PATTERNS.some((p) => p.test(name))) return true;
  if (SENSITIVE_PATTERNS.some((p) => p.test(name) || p.test(relPath))) return true;
  return false;
}

async function* walkFiles(dir: string, root: string, depth = 0, maxDepth = 20): AsyncGenerator<{ abs: string; rel: string }> {
  if (depth > maxDepth) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const abs = join(dir, entry.name);
    const rel = relative(root, abs);
    if (entry.isDirectory()) {
      if (shouldSkipDir(entry.name)) continue;
      yield* walkFiles(abs, root, depth + 1, maxDepth);
    } else if (entry.isFile()) {
      yield { abs, rel };
    }
  }
}

export async function computeRepoFingerprint(repoPath: string): Promise<{ fingerprint: string; fileCount: number; skippedCount: number }> {
  const root = resolve(repoPath);
  const hasher = createHash("sha256");
  let fileCount = 0;
  let skippedCount = 0;

  for await (const { abs, rel } of walkFiles(root, root)) {
    const name = basename(rel);
    if (shouldSkipFile(name, rel)) {
      skippedCount++;
      continue;
    }

    let buf: Buffer;
    try {
      buf = await readFile(abs);
    } catch {
      skippedCount++;
      continue;
    }

    const head = buf.subarray(0, 512);
    if (head.includes(0)) {
      skippedCount++;
      continue;
    }

    const textHead = buf.subarray(0, 4000).toString("utf-8");
    if (SENSITIVE_CONTENT.test(textHead)) {
      skippedCount++;
      continue;
    }

    hasher.update(rel);
    hasher.update("\0");
    hasher.update(buf);
    hasher.update("\0");
    fileCount++;
  }

  return {
    fingerprint: hasher.digest("hex"),
    fileCount,
    skippedCount,
  };
}

export async function computeContextFingerprint(contextFiles: string[] = []): Promise<string> {
  if (contextFiles.length === 0) return "none";
  const hasher = createHash("sha256");

  for (const f of [...contextFiles].sort()) {
    const abs = resolve(f);
    hasher.update(abs);
    hasher.update("\0");
    try {
      const s = await stat(abs);
      if (!s.isFile()) {
        hasher.update("nofile");
        continue;
      }
      const content = await readFile(abs);
      hasher.update(content);
    } catch {
      hasher.update("missing");
    }
    hasher.update("\0");
  }

  return hasher.digest("hex");
}

function hashFiles(files: FileEntry[]): string {
  const hasher = createHash("sha256");
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  for (const f of sorted) {
    hasher.update(f.path);
    hasher.update("\0");
    hasher.update(f.content);
    hasher.update("\0");
  }
  return hasher.digest("hex");
}

export function computeSkillSignatures(ctx: ProjectContext, extraContext = ""): Record<string, string> {
  const securityMatcher = /(auth|token|secret|password|crypto|sign|verify|permission|role|acl|middleware|jwt|oauth|session|policy|guard)/i;
  const testMatcher = /(test|spec|__tests__|integration|e2e|playwright|vitest|jest|pytest|cargo test)/i;

  const securityFiles = [
    ...ctx.sourceFiles.filter((f) => securityMatcher.test(f.path) || securityMatcher.test(f.content.slice(0, 800))),
    ...ctx.manifests.filter((f) => /(docker|compose|package\.json|cargo\.toml|pyproject|go\.mod|\.env)/i.test(f.path)),
  ];

  const testingFiles = [
    ...ctx.sourceFiles.filter((f) => f.category === "test" || testMatcher.test(f.path)),
    ...ctx.manifests.filter((f) => /package\.json|cargo\.toml|pyproject|go\.mod/i.test(f.path)),
  ];

  const baseHash = (value: string): string => createHash("sha256").update(value).digest("hex");

  return {
    domain: baseHash([
      ctx.identity,
      hashFiles(ctx.docs),
      hashFiles(ctx.references),
      hashFiles(ctx.manifests.filter((m) => /readme|package\.json|cargo\.toml|pyproject|go\.mod/i.test(m.path))),
      extraContext,
    ].join("\n\n")),
    architecture: baseHash([
      ctx.structure.join("\n"),
      hashFiles(ctx.manifests),
      hashFiles(ctx.sourceFiles.map((f) => ({ ...f, content: "" }))),
    ].join("\n\n")),
    conventions: baseHash([
      hashFiles(ctx.sourceFiles),
      hashFiles(ctx.manifests.filter((m) => /eslint|biome|prettier|tsconfig|package\.json|editorconfig/i.test(m.path))),
    ].join("\n\n")),
    security: baseHash([
      hashFiles(securityFiles),
      hashFiles(ctx.docs.filter((d) => /security|threat|auth|permission|privacy/i.test(d.path))),
      extraContext,
    ].join("\n\n")),
    testing: baseHash([
      hashFiles(testingFiles),
      ctx.stack.testing.join(","),
      extraContext,
    ].join("\n\n")),
  };
}

function cachePathForRepo(repoPath: string): string {
  const repoHash = createHash("sha256").update(resolve(repoPath)).digest("hex").slice(0, 16);
  return join(getCacheDir(), `train-${repoHash}.json`);
}

export function loadTrainCache(repoPath: string): TrainCacheEntry | null {
  const path = cachePathForRepo(repoPath);
  if (!existsSync(path)) return null;

  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as TrainCacheEntry;
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.version !== CACHE_VERSION) return null;
    if (!parsed.fingerprint || !Array.isArray(parsed.skills)) return null;
    return parsed;
  } catch {
    // Resilient to corruption: quarantine invalid file and continue
    try {
      renameSync(path, `${path}.corrupt.${Date.now()}`);
    } catch {}
    return null;
  }
}

export function saveTrainCache(repoPath: string, entry: Omit<TrainCacheEntry, "version" | "createdAt">): void {
  const path = cachePathForRepo(repoPath);
  mkdirSync(getCacheDir(), { recursive: true });

  const payload: TrainCacheEntry = {
    version: CACHE_VERSION,
    createdAt: new Date().toISOString(),
    ...entry,
  };

  try {
    const tmp = `${path}.tmp`;
    // atomic-ish write
    writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf-8");
    renameSync(tmp, path);
  } catch {
    // best effort cache write only
  }
}

export function isCachedSkillsIndexUsable(skills: CachedSkillIndexEntry[]): boolean {
  if (!Array.isArray(skills) || skills.length === 0) return false;
  return skills.every((s) => {
    if (!s?.name || !s?.path) return false;
    try {
      return (
        existsSync(s.path) &&
        statSync(s.path).isDirectory() &&
        existsSync(join(s.path, "SKILL.md"))
      );
    } catch {
      return false;
    }
  });
}
