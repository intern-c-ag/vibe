import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

export interface StackInfo {
  languages: string[];
  frameworks: string[];
  buildTools: string[];
  testing: string[];
  database: string[];
  runtime: string;
}

export interface FilePattern {
  pattern: string;
  description: string;
  examples: string[];
}

export interface FileSample {
  path: string;
  content: string;
  language: string;
}

export interface RepoProfile {
  name: string;
  path: string;
  stack: StackInfo;
  structure: string[];
  patterns: FilePattern[];
  conventions: string[];
  sampleFiles: FileSample[];
}

const SENSITIVE_PATTERNS = [
  /^\.env/i, /secrets/i, /credentials/i, /\.key$/, /\.pem$/, /\.p12$/,
  /\.keystore$/, /\.jks$/, /id_rsa/, /id_ed25519/,
];

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '__pycache__',
  '.venv', 'venv', 'vendor', 'target', '.terraform', 'coverage',
]);

const SENSITIVE_CONTENT_RE = /(?:secret|password|token|api_key|apikey|private_key)\s*[:=]/i;

const LANG_MAP: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
  '.py': 'python', '.go': 'go', '.rs': 'rust', '.java': 'java', '.rb': 'ruby',
  '.php': 'php', '.cs': 'csharp', '.cpp': 'cpp', '.c': 'c', '.swift': 'swift',
  '.kt': 'kotlin', '.scala': 'scala', '.vue': 'vue', '.svelte': 'svelte',
  '.html': 'html', '.css': 'css', '.scss': 'scss', '.sql': 'sql',
  '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell', '.yaml': 'yaml', '.yml': 'yaml',
  '.json': 'json', '.toml': 'toml', '.md': 'markdown', '.graphql': 'graphql',
};

const CODE_EXTENSIONS = new Set(Object.keys(LANG_MAP));

function isSensitivePath(filePath: string): boolean {
  const base = path.basename(filePath);
  return SENSITIVE_PATTERNS.some(p => p.test(base));
}

function hasSensitiveContent(content: string): boolean {
  // Only check first 50 lines for performance
  const head = content.split('\n', 50).join('\n');
  return SENSITIVE_CONTENT_RE.test(head);
}

function getGitFiles(repoPath: string): string[] | null {
  try {
    const out = execSync('git ls-files', { cwd: repoPath, maxBuffer: 10 * 1024 * 1024, encoding: 'utf-8' });
    return out.trim().split('\n').filter(Boolean);
  } catch {
    return null;
  }
}

function walkDir(dir: string, root: string, maxDepth = 10, depth = 0): string[] {
  if (depth > maxDepth) return [];
  const results: string[] = [];
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  for (const e of entries) {
    if (e.name.startsWith('.env')) continue;
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      results.push(...walkDir(path.join(dir, e.name), root, maxDepth, depth + 1));
    } else if (e.isFile()) {
      results.push(path.relative(root, path.join(dir, e.name)));
    }
  }
  return results;
}

function getDirTree(repoPath: string, maxDepth = 3, depth = 0, prefix = ''): string[] {
  if (depth >= maxDepth) return [];
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(repoPath, { withFileTypes: true }); } catch { return []; }
  const dirs = entries.filter(e => e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.')).sort((a, b) => a.name.localeCompare(b.name));
  const result: string[] = [];
  for (const d of dirs) {
    result.push(`${prefix}${d.name}/`);
    result.push(...getDirTree(path.join(repoPath, d.name), maxDepth, depth + 1, prefix + '  '));
  }
  return result;
}

function readJsonSafe(filePath: string): any {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { return null; }
}

function readFileSafe(filePath: string): string | null {
  try { return fs.readFileSync(filePath, 'utf-8'); } catch { return null; }
}

function detectStack(repoPath: string): StackInfo {
  const stack: StackInfo = { languages: [], frameworks: [], buildTools: [], testing: [], database: [], runtime: '' };
  const langs = new Set<string>();
  const frameworks = new Set<string>();
  const buildTools = new Set<string>();
  const testing = new Set<string>();
  const database = new Set<string>();

  // package.json
  const pkg = readJsonSafe(path.join(repoPath, 'package.json'));
  if (pkg) {
    langs.add('TypeScript/JavaScript');
    buildTools.add('npm');
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (allDeps) {
      // Frameworks
      if (allDeps.react) frameworks.add('React');
      if (allDeps.next) frameworks.add('Next.js');
      if (allDeps.vue) frameworks.add('Vue');
      if (allDeps.nuxt) frameworks.add('Nuxt');
      if (allDeps.svelte || allDeps['@sveltejs/kit']) frameworks.add('Svelte');
      if (allDeps.express) frameworks.add('Express');
      if (allDeps.fastify) frameworks.add('Fastify');
      if (allDeps['@nestjs/core']) frameworks.add('NestJS');
      if (allDeps.angular || allDeps['@angular/core']) frameworks.add('Angular');
      if (allDeps.electron) frameworks.add('Electron');
      if (allDeps['react-native']) frameworks.add('React Native');
      if (allDeps.astro) frameworks.add('Astro');
      if (allDeps.remix || allDeps['@remix-run/react']) frameworks.add('Remix');
      // Build tools
      if (allDeps.vite) buildTools.add('Vite');
      if (allDeps.webpack) buildTools.add('Webpack');
      if (allDeps.esbuild) buildTools.add('esbuild');
      if (allDeps.rollup) buildTools.add('Rollup');
      if (allDeps.turbo) buildTools.add('Turborepo');
      // Testing
      if (allDeps.jest) testing.add('Jest');
      if (allDeps.vitest) testing.add('Vitest');
      if (allDeps.mocha) testing.add('Mocha');
      if (allDeps.cypress) testing.add('Cypress');
      if (allDeps.playwright || allDeps['@playwright/test']) testing.add('Playwright');
      // Database
      if (allDeps.prisma || allDeps['@prisma/client']) database.add('Prisma');
      if (allDeps.mongoose) database.add('MongoDB');
      if (allDeps.pg) database.add('PostgreSQL');
      if (allDeps.mysql2 || allDeps.mysql) database.add('MySQL');
      if (allDeps.redis || allDeps.ioredis) database.add('Redis');
      if (allDeps.typeorm) database.add('TypeORM');
      if (allDeps.sequelize) database.add('Sequelize');
      if (allDeps.drizzle || allDeps['drizzle-orm']) database.add('Drizzle');
    }
    stack.runtime = 'Node.js';
  }

  // tsconfig.json
  if (fs.existsSync(path.join(repoPath, 'tsconfig.json'))) {
    langs.add('TypeScript');
  }

  // pyproject.toml / requirements.txt
  const pyproject = readFileSafe(path.join(repoPath, 'pyproject.toml'));
  if (pyproject || fs.existsSync(path.join(repoPath, 'requirements.txt'))) {
    langs.add('Python');
    stack.runtime = stack.runtime || 'Python';
    if (pyproject) {
      if (/django/i.test(pyproject)) frameworks.add('Django');
      if (/flask/i.test(pyproject)) frameworks.add('Flask');
      if (/fastapi/i.test(pyproject)) frameworks.add('FastAPI');
      if (/pytest/i.test(pyproject)) testing.add('pytest');
      if (/poetry/i.test(pyproject)) buildTools.add('Poetry');
      if (/sqlalchemy/i.test(pyproject)) database.add('SQLAlchemy');
    }
  }

  // go.mod
  const gomod = readFileSafe(path.join(repoPath, 'go.mod'));
  if (gomod) {
    langs.add('Go');
    stack.runtime = stack.runtime || 'Go';
    if (/gin-gonic/i.test(gomod)) frameworks.add('Gin');
    if (/echo/i.test(gomod)) frameworks.add('Echo');
    if (/fiber/i.test(gomod)) frameworks.add('Fiber');
  }

  // Cargo.toml
  const cargo = readFileSafe(path.join(repoPath, 'Cargo.toml'));
  if (cargo) {
    langs.add('Rust');
    stack.runtime = stack.runtime || 'Rust';
    buildTools.add('Cargo');
    if (/actix/i.test(cargo)) frameworks.add('Actix');
    if (/axum/i.test(cargo)) frameworks.add('Axum');
    if (/tokio/i.test(cargo)) frameworks.add('Tokio');
  }

  // Dockerfile
  if (fs.existsSync(path.join(repoPath, 'Dockerfile')) || fs.existsSync(path.join(repoPath, 'docker-compose.yml'))) {
    buildTools.add('Docker');
  }

  // Makefile
  if (fs.existsSync(path.join(repoPath, 'Makefile'))) buildTools.add('Make');

  stack.languages = [...langs];
  stack.frameworks = [...frameworks];
  stack.buildTools = [...buildTools];
  stack.testing = [...testing];
  stack.database = [...database];
  return stack;
}

function categorizeFile(relPath: string): string {
  const lower = relPath.toLowerCase();
  if (/test|spec|__tests__/.test(lower)) return 'test';
  if (/component|widget/i.test(lower)) return 'component';
  if (/hook|use[A-Z]/.test(relPath)) return 'hook';
  if (/util|helper|lib/i.test(lower)) return 'util';
  if (/model|schema|entity/i.test(lower)) return 'model';
  if (/route|controller|handler|api/i.test(lower)) return 'route';
  if (/service|provider/i.test(lower)) return 'service';
  if (/middleware/i.test(lower)) return 'middleware';
  if (/config/i.test(lower)) return 'config';
  if (/style|css|scss/i.test(lower)) return 'style';
  return 'other';
}

function selectDiverseSamples(files: string[], repoPath: string, max = 20): FileSample[] {
  // Group by category, pick from each
  const byCategory = new Map<string, string[]>();
  const codeFiles = files.filter(f => CODE_EXTENSIONS.has(path.extname(f)));

  for (const f of codeFiles) {
    if (isSensitivePath(f)) continue;
    const cat = categorizeFile(f);
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(f);
  }

  const selected: FileSample[] = [];
  const categories = [...byCategory.keys()].sort();

  // Round-robin across categories
  let round = 0;
  while (selected.length < max) {
    let added = false;
    for (const cat of categories) {
      if (selected.length >= max) break;
      const list = byCategory.get(cat)!;
      if (round < list.length) {
        const filePath = list[round];
        const fullPath = path.join(repoPath, filePath);
        const content = readFileSafe(fullPath);
        if (!content) continue;
        if (hasSensitiveContent(content)) continue;
        const lines = content.split('\n');
        const truncated = lines.slice(0, 200).join('\n');
        const ext = path.extname(filePath);
        selected.push({ path: filePath, content: truncated, language: LANG_MAP[ext] || ext.slice(1) });
        added = true;
      }
    }
    if (!added) break;
    round++;
  }

  return selected;
}

function detectPatterns(files: string[], samples: FileSample[]): { patterns: FilePattern[]; conventions: string[] } {
  const patterns: FilePattern[] = [];
  const conventions: string[] = [];

  // Naming convention detection
  const fileNames = files.map(f => path.basename(f, path.extname(f)));
  const camelCount = fileNames.filter(n => /^[a-z][a-zA-Z0-9]*$/.test(n) && /[A-Z]/.test(n)).length;
  const pascalCount = fileNames.filter(n => /^[A-Z][a-zA-Z0-9]*$/.test(n)).length;
  const kebabCount = fileNames.filter(n => /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(n)).length;
  const snakeCount = fileNames.filter(n => /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(n)).length;

  const namingCounts = [
    { name: 'camelCase', count: camelCount },
    { name: 'PascalCase', count: pascalCount },
    { name: 'kebab-case', count: kebabCount },
    { name: 'snake_case', count: snakeCount },
  ].sort((a, b) => b.count - a.count);

  if (namingCounts[0].count > 5) {
    conventions.push(`File naming: predominantly ${namingCounts[0].name}`);
  }

  // Directory structure patterns
  const topDirs = new Set(files.map(f => f.split('/')[0]).filter(Boolean));
  if (topDirs.has('src')) conventions.push('Source code in src/ directory');
  if (topDirs.has('lib')) conventions.push('Library code in lib/ directory');
  if (topDirs.has('app')) conventions.push('App directory structure (Next.js/Rails style)');
  if (topDirs.has('pages')) conventions.push('Pages-based routing');
  if (topDirs.has('components')) conventions.push('Top-level components directory');

  // Import style from samples
  let esImports = 0, cjsRequires = 0;
  const indexExports: string[] = [];
  const barrelFiles: string[] = [];

  for (const s of samples) {
    const lines = s.content.split('\n');
    for (const line of lines) {
      if (/^import\s/.test(line)) esImports++;
      if (/require\(/.test(line)) cjsRequires++;
    }
    if (path.basename(s.path).startsWith('index.')) {
      if (/export\s/.test(s.content)) barrelFiles.push(s.path);
    }
  }

  if (esImports > cjsRequires && esImports > 5) {
    patterns.push({ pattern: 'ES Modules', description: 'Uses ES module import/export syntax', examples: [] });
  } else if (cjsRequires > esImports && cjsRequires > 5) {
    patterns.push({ pattern: 'CommonJS', description: 'Uses require/module.exports syntax', examples: [] });
  }

  if (barrelFiles.length > 2) {
    patterns.push({ pattern: 'Barrel exports', description: 'Uses index files to re-export modules', examples: barrelFiles.slice(0, 3) });
  }

  // Test patterns
  const testFiles = files.filter(f => /\.(test|spec)\.[jt]sx?$/.test(f));
  const testDirFiles = files.filter(f => /__tests__/.test(f));
  if (testFiles.length > 0) {
    patterns.push({ pattern: 'Co-located tests', description: 'Test files alongside source files (.test/.spec)', examples: testFiles.slice(0, 3) });
  }
  if (testDirFiles.length > 0) {
    patterns.push({ pattern: '__tests__ directories', description: 'Tests in dedicated __tests__ folders', examples: testDirFiles.slice(0, 3) });
  }

  // Error handling
  let tryCatchCount = 0;
  let errorClassCount = 0;
  for (const s of samples) {
    if (/try\s*\{/.test(s.content)) tryCatchCount++;
    if (/class\s+\w*Error\s+extends/.test(s.content)) errorClassCount++;
  }
  if (errorClassCount > 0) {
    patterns.push({ pattern: 'Custom error classes', description: 'Defines custom Error subclasses', examples: [] });
  }
  if (tryCatchCount > samples.length * 0.3) {
    conventions.push('Frequent try/catch error handling');
  }

  // Type patterns (TypeScript)
  const tsFiles = samples.filter(s => s.language === 'typescript');
  if (tsFiles.length > 0) {
    let interfaceCount = 0, typeCount = 0;
    for (const s of tsFiles) {
      interfaceCount += (s.content.match(/^interface\s/gm) || []).length;
      typeCount += (s.content.match(/^type\s/gm) || []).length;
    }
    if (interfaceCount > typeCount && interfaceCount > 3) {
      conventions.push('Prefers interfaces over type aliases');
    } else if (typeCount > interfaceCount && typeCount > 3) {
      conventions.push('Prefers type aliases over interfaces');
    }
  }

  return { patterns, conventions };
}

export async function scanRepo(repoPath: string): Promise<RepoProfile> {
  const absPath = path.resolve(repoPath);
  const name = path.basename(absPath);

  // Get file list
  let files = getGitFiles(absPath);
  if (!files) {
    files = walkDir(absPath, absPath);
  }

  // Filter out sensitive and skipped files
  files = files.filter(f => {
    const parts = f.split('/');
    if (parts.some(p => SKIP_DIRS.has(p) || p.startsWith('.env'))) return false;
    if (isSensitivePath(f)) return false;
    return true;
  });

  const structure = getDirTree(absPath);
  const stack = detectStack(absPath);
  const samples = selectDiverseSamples(files, absPath);
  const { patterns, conventions } = detectPatterns(files, samples);

  return {
    name,
    path: absPath,
    stack,
    structure,
    patterns,
    conventions,
    sampleFiles: samples,
  };
}
