export interface ContextSignals {
  projectDecisions: string[];
  codingConventions: string[];
  architectureNotes: string[];
  todosFollowups: string[];
  toolingWorkflow: string[];
  securityRequirements: string[];
}

export type SignalConfidence = "high" | "medium" | "low";

export interface WeightedSignal {
  text: string;
  confidence: SignalConfidence;
  bucket: keyof ContextSignals;
  source: string; // heading or "general"
}

export interface ParsedContextFile {
  fileName: string;
  kind: "session-export" | "markdown";
  signals: ContextSignals;
  weighted: WeightedSignal[];
  excerpt: string;
  filterStats: { totalCandidates: number; filteredNoisy: number; retainedHigh: number; retainedMedium: number };
}

const MAX_PER_BUCKET = 16;

const EMPTY_SIGNALS: ContextSignals = {
  projectDecisions: [],
  codingConventions: [],
  architectureNotes: [],
  todosFollowups: [],
  toolingWorkflow: [],
  securityRequirements: [],
};

// Patterns that indicate high-confidence explicit constraints
const EXPLICIT_CONSTRAINT_PATTERNS = [
  /\b(?:only|exclusively|must|always|never|required|mandatory|do not|don't|shall not|forbidden)\b/i,
  /\b(?:restricted to|limited to|nothing (?:else|other)|no other)\b/i,
];

// Patterns for architectural decisions
const ARCHITECTURE_DECISION_PATTERNS = [
  /\b(?:we (?:chose|decided|picked|went with|use)|architecture|stack is|built (?:on|with)|monorepo|microservice|modular)\b/i,
  /\b(?:data ?flow|event[ -]driven|pub[ -]?sub|cqrs|ddd|hexagonal|clean architecture|layered)\b/i,
];

// Patterns for coding conventions
const CONVENTION_PATTERNS = [
  /\b(?:convention|naming|style guide|linter|formatter|eslint|prettier|biome|import order|camelCase|snake_case|PascalCase)\b/i,
  /\b(?:strict mode|no-any|readonly|immutable|functional style|prefer const|arrow function)\b/i,
];

// Patterns for security requirements
const SECURITY_PATTERNS = [
  /\b(?:security|auth|token|secret|encrypt|sign|verify|permission|rbac|acl|cors|csrf|xss|injection|sanitiz|validat)\b/i,
  /\b(?:private key|seed phrase|mnemonic|wallet|credential|api[ -]?key|bearer)\b/i,
];

export function parseContextMarkdown(fileName: string, content: string): ParsedContextFile {
  const normalized = content.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const kind = looksLikeSessionExport(lines) ? "session-export" : "markdown";

  const signals: ContextSignals = {
    projectDecisions: [],
    codingConventions: [],
    architectureNotes: [],
    todosFollowups: [],
    toolingWorkflow: [],
    securityRequirements: [],
  };

  const weighted: WeightedSignal[] = [];

  let totalCandidates = 0;
  let filteredNoisy = 0;

  const sections = splitIntoSections(lines);
  for (const section of sections) {
    const hint = section.heading.toLowerCase();
    const bullets = extractBulletLikeItems(section.lines);
    const sentences = extractSignalSentences(section.lines.join(" "));
    const candidates = [...bullets, ...sentences];

    for (const item of candidates) {
      const text = cleanItem(item);
      if (!text) continue;
      totalCandidates++;

      // Aggressively filter tool logs / JSON / shell noise
      if (isNoisyCandidate(text)) {
        filteredNoisy++;
        continue;
      }

      const forcedBucket = bucketFromHeading(hint);
      const bucket = forcedBucket ?? bucketFromText(text);
      if (!bucket) continue;

      const confidence = scoreConfidence(text, hint, kind, forcedBucket !== null);
      pushUnique(signals[bucket], text, MAX_PER_BUCKET);
      weighted.push({ text, confidence, bucket, source: section.heading });
    }
  }

  // Sort weighted signals: high first, then medium, then low
  weighted.sort((a, b) => confidenceRank(a.confidence) - confidenceRank(b.confidence));

  const retainedHigh = weighted.filter((w) => w.confidence === "high").length;
  const retainedMedium = weighted.filter((w) => w.confidence === "medium").length;

  return {
    fileName,
    kind,
    signals,
    weighted,
    excerpt: normalized.slice(0, 10000),
    filterStats: { totalCandidates, filteredNoisy, retainedHigh, retainedMedium },
  };
}

function confidenceRank(c: SignalConfidence): number {
  return c === "high" ? 0 : c === "medium" ? 1 : 2;
}

function scoreConfidence(
  text: string,
  heading: string,
  kind: "session-export" | "markdown",
  headingMatched: boolean,
): SignalConfidence {
  let score = 0;

  // Explicit constraints are highest signal
  if (EXPLICIT_CONSTRAINT_PATTERNS.some((p) => p.test(text))) score += 3;

  // Heading-matched items are more trustworthy
  if (headingMatched) score += 2;

  // Session exports with decision language are strong
  if (kind === "session-export" && /\b(?:decid|agreed|chose|go with|we will|we'll)\b/i.test(text)) score += 2;

  // Security requirements always get a boost
  if (SECURITY_PATTERNS.some((p) => p.test(text))) score += 1;

  // Architecture decisions get a boost
  if (ARCHITECTURE_DECISION_PATTERNS.some((p) => p.test(text))) score += 1;

  // Short vague items penalized
  if (text.length < 30) score -= 1;

  if (score >= 3) return "high";
  if (score >= 1) return "medium";
  return "low";
}

export function mergeContextSignals(items: ContextSignals[]): ContextSignals {
  const merged: ContextSignals = {
    projectDecisions: [],
    codingConventions: [],
    architectureNotes: [],
    todosFollowups: [],
    toolingWorkflow: [],
    securityRequirements: [],
  };

  for (const item of items) {
    for (const key of Object.keys(merged) as Array<keyof ContextSignals>) {
      for (const line of item[key] ?? []) {
        pushUnique(merged[key], line, 24);
      }
    }
  }

  return merged;
}

export function hasContextSignals(signals: ContextSignals): boolean {
  return (Object.values(signals).flat().length > 0);
}

export function formatSignalsForPrompt(signals: ContextSignals, weighted?: WeightedSignal[]): string {
  if (!hasContextSignals(signals)) return "";

  const block: string[] = [];

  // High-confidence directives get a special top section
  const highConfidence = weighted?.filter((w) => w.confidence === "high") ?? [];
  if (highConfidence.length > 0) {
    block.push("## ⚠️ CRITICAL Project Directives (from context files — these override repo scan inferences)");
    block.push("");
    block.push("The following constraints were explicitly stated by the developer and MUST be respected:");
    block.push("");
    for (const w of highConfidence.slice(0, 15)) {
      block.push(`- **[${w.bucket}]** ${w.text}`);
    }
    block.push("");
  }

  // Then the full structured signals
  block.push("## Extracted Context Signals");
  const sections: Array<[string, keyof ContextSignals]> = [
    ["Project decisions", "projectDecisions"],
    ["Coding conventions", "codingConventions"],
    ["Architecture notes", "architectureNotes"],
    ["Security requirements", "securityRequirements"],
    ["TODOs / follow-ups", "todosFollowups"],
    ["Preferred tooling / workflow", "toolingWorkflow"],
  ];

  for (const [label, key] of sections) {
    if (!signals[key].length) continue;
    block.push(`\n### ${label}`);
    block.push(...signals[key].slice(0, 14).map((v) => `- ${v}`));
  }

  return block.join("\n");
}

/**
 * Log a summary of the top extracted directives that were actually applied.
 */
export function logAppliedDirectives(
  weighted: WeightedSignal[],
  log: (msg: string) => void,
  filterStats?: ParsedContextFile["filterStats"],
): void {
  const high = weighted.filter((w) => w.confidence === "high");
  const medium = weighted.filter((w) => w.confidence === "medium");

  if (high.length === 0 && medium.length === 0 && !filterStats) return;

  if (filterStats) {
    log(
      `  Context directives: ${filterStats.totalCandidates} candidates → ${filterStats.filteredNoisy} noisy filtered → ${filterStats.retainedHigh} high, ${filterStats.retainedMedium} medium retained`,
    );
  } else {
    log(`  Context weighting: ${high.length} high-confidence, ${medium.length} medium-confidence directives`);
  }
  for (const w of high.slice(0, 5)) {
    log(`    ▸ [HIGH/${w.bucket}] ${w.text.slice(0, 120)}`);
  }
  for (const w of medium.slice(0, 3)) {
    log(`    ▸ [MED/${w.bucket}] ${w.text.slice(0, 100)}`);
  }
}

/**
 * Check if a path looks like a context file (not a repo path).
 * Context files should never be treated as repo scan targets.
 */
export function isContextFilePath(path: string): boolean {
  // Context files are typically absolute or home-relative markdown/text files
  // passed via --context flag. They should NOT be fed to the repo scanner.
  const normalized = path.replace(/\\/g, "/");
  // Heuristic: exported sessions, docs, notes — markdown files outside typical repo roots
  if (/\.(md|markdown|txt|log)$/i.test(normalized)) return true;
  return false;
}

function looksLikeSessionExport(lines: string[]): boolean {
  let score = 0;
  for (const line of lines.slice(0, 220)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^#{1,6}\s*(user|assistant|system|human|claude|opencode|tool|observation)\b/i.test(trimmed)) score++;
    if (/^\[(user|assistant|system|tool|subagent)\b.*\]/i.test(trimmed)) score++;
    if (/^(user|assistant|system|tool)\s*:/i.test(trimmed)) score++;
  }
  return score >= 3;
}

function splitIntoSections(lines: string[]): Array<{ heading: string; lines: string[] }> {
  const sections: Array<{ heading: string; lines: string[] }> = [];
  let heading = "general";
  let current: string[] = [];

  const flush = () => {
    if (current.length) sections.push({ heading, lines: current });
    current = [];
  };

  for (const line of lines) {
    const m = line.match(/^#{1,6}\s+(.+)$/);
    if (m) {
      flush();
      heading = m[1].trim();
      continue;
    }
    current.push(line);
  }
  flush();

  return sections;
}

function extractBulletLikeItems(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^[-*+]\s+/.test(trimmed)) out.push(trimmed.replace(/^[-*+]\s+/, ""));
    else if (/^\d+[.)]\s+/.test(trimmed)) out.push(trimmed.replace(/^\d+[.)]\s+/, ""));
    else if (/^TODO\s*[:\-]/i.test(trimmed)) out.push(trimmed);
  }
  return out;
}

function extractSignalSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 20 && s.length <= 260)
    .filter((s) => bucketFromText(s) !== null)
    .slice(0, 50);
}

function bucketFromHeading(heading: string): keyof ContextSignals | null {
  if (/(decision|tradeoff|rationale|choice)/i.test(heading)) return "projectDecisions";
  if (/(convention|style|lint|naming|format)/i.test(heading)) return "codingConventions";
  if (/(architecture|design|module|structure|data flow)/i.test(heading)) return "architectureNotes";
  if (/(todo|follow|next step|action item|backlog)/i.test(heading)) return "todosFollowups";
  if (/(tool|workflow|process|ci|build|deploy|devex)/i.test(heading)) return "toolingWorkflow";
  if (/(security|auth|permission|access control|crypto)/i.test(heading)) return "securityRequirements";
  return null;
}

function bucketFromText(text: string): keyof ContextSignals | null {
  const t = text.toLowerCase();
  if (/(\bdecid|agreed|chosen|go with|we will|we'll|tradeoff|rationale\b)/.test(t)) return "projectDecisions";
  if (/(\bconvention|style|naming|lint|format|idiom|strict mode|code standard\b)/.test(t)) return "codingConventions";
  if (/(\barchitecture|layer|module|service|pipeline|data flow|component|directory structure\b)/.test(t)) return "architectureNotes";
  if (/(\btodo|follow[- ]?up|next step|action item|pending|fixme\b)/.test(t)) return "todosFollowups";
  if (/(\bworkflow|tooling|cli|script|build step|ci|deploy|release process|preferred tool\b)/.test(t)) return "toolingWorkflow";
  if (/(\bsecurity|auth|token|secret|encrypt|permission|rbac|cors|csrf|xss|injection|sanitiz\b)/.test(t)) return "securityRequirements";
  return null;
}

function cleanItem(v: string): string {
  return v
    .replace(/^`+|`+$/g, "")
    .replace(/^[-*+]\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 280);
}

// ── Noise filtering ──────────────────────────────────────────────────────────
// Heuristics to reject tool transcripts, JSON blobs, shell output, and other
// non-directive noise that sometimes appears in session-export context files.

const NOISE_PATTERNS: RegExp[] = [
  // JSON objects / arrays (long)
  /[{[].{60,}[}\]]/,
  // Shell / command output markers
  /^\s*(\$|>>>|>|#!\/|❯|λ)\s/,
  /\b(exit code|stdout|stderr|SIGTERM|SIGKILL|errno|pid \d)\b/i,
  // Tool metadata / function-call artifacts
  /\b(function_call|tool_use|tool_result|<tool>|<\/tool>|<function|<result)\b/,
  /\b(observation|action_input|action_output)\s*[:=]/i,
  // Stack traces / file paths dominating the line
  /(?:at\s+\S+\s+\(.*:\d+:\d+\))/,
  /(?:\/[\w.-]+){4,}/,  // deep paths like /home/user/foo/bar/baz/qux
  // Lines that are mostly non-alphabetic (symbols, punctuation, hex)
  /^[^a-zA-Z]*$/,
  // Base64 / hex blobs
  /[A-Za-z0-9+/=]{40,}/,
  // Log-line prefixes (timestamps + levels)
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/,
  /^\[(DEBUG|INFO|WARN|ERROR|TRACE)\]/i,
  // Diff / patch markers
  /^[+-]{3}\s+(a|b)\//,
  /^@@\s+-\d+/,
  // HTTP / curl noise
  /\b(HTTP\/\d|curl|wget|GET|POST|PUT|DELETE|PATCH)\s+https?:\/\//i,
  // UUID-heavy lines (likely IDs, not directives)
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
];

/**
 * Returns true if `text` looks like tool/shell noise rather than a human directive.
 */
function isNoisyCandidate(text: string): boolean {
  // Very short fragments are handled by confidence scoring, not noise filter
  if (text.length < 8) return false;

  for (const pat of NOISE_PATTERNS) {
    if (pat.test(text)) return true;
  }

  // Ratio check: if less than 40% of chars are letters/spaces, it's noise
  const alphaSpaceCount = (text.match(/[a-zA-Z ]/g) ?? []).length;
  if (alphaSpaceCount / text.length < 0.4) return true;

  return false;
}

function pushUnique(target: string[], value: string, max: number): void {
  if (!value) return;
  const normalized = value.toLowerCase();
  if (target.some((t) => t.toLowerCase() === normalized)) return;
  if (target.length >= max) return;
  target.push(value);
}

export function emptySignals(): ContextSignals {
  return {
    projectDecisions: [],
    codingConventions: [],
    architectureNotes: [],
    todosFollowups: [],
    toolingWorkflow: [],
    securityRequirements: [],
  };
}
