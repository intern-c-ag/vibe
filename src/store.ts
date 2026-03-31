import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";

const CONFIG_DIR = join(homedir(), ".config", "vibe");
const SKILLS_DIR = join(CONFIG_DIR, "skills");
const CACHE_DIR = join(CONFIG_DIR, "cache");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export function ensureDirs(): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  if (!existsSync(SKILLS_DIR)) mkdirSync(SKILLS_DIR, { recursive: true });
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
}

export function getSkillsDir(): string {
  ensureDirs();
  return SKILLS_DIR;
}

export function getConfigDir(): string {
  ensureDirs();
  return CONFIG_DIR;
}

export function getCacheDir(): string {
  ensureDirs();
  return CACHE_DIR;
}

export interface SkillEntry {
  name: string;
  description: string;
  category: string;
  sourceRepo: string;
  createdAt: string;
  path: string;
}

export function listSkills(): SkillEntry[] {
  ensureDirs();
  const skills: SkillEntry[] = [];

  if (!existsSync(SKILLS_DIR)) return skills;

  for (const dir of readdirSync(SKILLS_DIR)) {
    const skillDir = join(SKILLS_DIR, dir);
    if (!statSync(skillDir).isDirectory()) continue;

    const skillMd = join(skillDir, "SKILL.md");
    const metaFile = join(skillDir, "meta.json");

    if (!existsSync(skillMd)) continue;

    let meta: Partial<SkillEntry> = {};
    if (existsSync(metaFile)) {
      try {
        meta = JSON.parse(readFileSync(metaFile, "utf-8"));
      } catch {}
    }

    const content = readFileSync(skillMd, "utf-8");
    const descMatch = content.match(/^##\s*Description\s*\n+(.+)/m);

    skills.push({
      name: dir,
      description: meta.description || descMatch?.[1]?.trim() || "—",
      category: meta.category || "general",
      sourceRepo: meta.sourceRepo || "unknown",
      createdAt: meta.createdAt || "unknown",
      path: skillDir,
    });
  }

  return skills;
}

export interface Config {
  githubRepo?: string;
  defaultBranch?: string;
  [key: string]: string | undefined;
}

export function getConfig(): Config {
  ensureDirs();
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
  } catch {
    return {};
  }
}

export function setConfig(key: string, value: string): void {
  ensureDirs();
  const config = getConfig();
  (config as Record<string, string>)[key] = value;
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function saveSkillMeta(skillDir: string, meta: Partial<SkillEntry>): void {
  const metaFile = join(skillDir, "meta.json");
  writeFileSync(metaFile, JSON.stringify({ ...meta, createdAt: new Date().toISOString() }, null, 2));
}
