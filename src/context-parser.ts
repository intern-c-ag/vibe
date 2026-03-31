export interface ContextSignals {
  projectDecisions: string[];
  codingConventions: string[];
  architectureNotes: string[];
  todosFollowups: string[];
  toolingWorkflow: string[];
}

export interface ParsedContextFile {
  fileName: string;
  kind: "session-export" | "markdown";
  signals: ContextSignals;
  excerpt: string;
}

const MAX_PER_BUCKET = 12;

const EMPTY_SIGNALS: ContextSignals = {
  projectDecisions: [],
  codingConventions: [],
  architectureNotes: [],
  todosFollowups: [],
  toolingWorkflow: [],
};

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
  };

  const sections = splitIntoSections(lines);
  for (const section of sections) {
    const hint = section.heading.toLowerCase();
    const bullets = extractBulletLikeItems(section.lines);
    const sentences = extractSignalSentences(section.lines.join(" "));
    const candidates = [...bullets, ...sentences];

    for (const item of candidates) {
      const text = cleanItem(item);
      if (!text) continue;

      const forcedBucket = bucketFromHeading(hint);
      const bucket = forcedBucket ?? bucketFromText(text);
      if (!bucket) continue;
      pushUnique(signals[bucket], text, MAX_PER_BUCKET);
    }
  }

  return {
    fileName,
    kind,
    signals,
    excerpt: normalized.slice(0, 10000),
  };
}

export function mergeContextSignals(items: ContextSignals[]): ContextSignals {
  const merged: ContextSignals = {
    projectDecisions: [],
    codingConventions: [],
    architectureNotes: [],
    todosFollowups: [],
    toolingWorkflow: [],
  };

  for (const item of items) {
    for (const key of Object.keys(merged) as Array<keyof ContextSignals>) {
      for (const line of item[key]) {
        pushUnique(merged[key], line, 20);
      }
    }
  }

  return merged;
}

export function hasContextSignals(signals: ContextSignals): boolean {
  return (Object.values(signals).flat().length > 0);
}

export function formatSignalsForPrompt(signals: ContextSignals): string {
  if (!hasContextSignals(signals)) return "";

  const block: string[] = ["## Extracted Context Signals"]; 
  const sections: Array<[string, keyof ContextSignals]> = [
    ["Project decisions", "projectDecisions"],
    ["Coding conventions", "codingConventions"],
    ["Architecture notes", "architectureNotes"],
    ["TODOs / follow-ups", "todosFollowups"],
    ["Preferred tooling / workflow", "toolingWorkflow"],
  ];

  for (const [label, key] of sections) {
    if (!signals[key].length) continue;
    block.push(`\n### ${label}`);
    block.push(...signals[key].slice(0, 12).map((v) => `- ${v}`));
  }

  return block.join("\n");
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
  return null;
}

function bucketFromText(text: string): keyof ContextSignals | null {
  const t = text.toLowerCase();
  if (/(\bdecid|agreed|chosen|go with|we will|we'll|tradeoff|rationale\b)/.test(t)) return "projectDecisions";
  if (/(\bconvention|style|naming|lint|format|idiom|strict mode|code standard\b)/.test(t)) return "codingConventions";
  if (/(\barchitecture|layer|module|service|pipeline|data flow|component|directory structure\b)/.test(t)) return "architectureNotes";
  if (/(\btodo|follow[- ]?up|next step|action item|pending|fixme\b)/.test(t)) return "todosFollowups";
  if (/(\bworkflow|tooling|cli|script|build step|ci|deploy|release process|preferred tool\b)/.test(t)) return "toolingWorkflow";
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

function pushUnique(target: string[], value: string, max: number): void {
  if (!value) return;
  const normalized = value.toLowerCase();
  if (target.some((t) => t.toLowerCase() === normalized)) return;
  if (target.length >= max) return;
  target.push(value);
}

export function emptySignals(): ContextSignals {
  return { ...EMPTY_SIGNALS, projectDecisions: [], codingConventions: [], architectureNotes: [], todosFollowups: [], toolingWorkflow: [] };
}
