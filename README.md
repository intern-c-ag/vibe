# vibe

One command to set up Claude Code with skills, agents, and MCPs — learned from how you actually code.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/intern-c-ag/vibe/master/install.sh | bash
```

## Usage

```bash
cd ~/my-project
vibe
```

That's it. Vibe scans your project, generates a `.claude/` folder with agents, skills, commands, and config tailored to your stack, discovers and installs relevant MCP servers, installs Claude Code if needed, and launches it.

### Train on your repos

The real power: teach vibe how *you* code, then carry that everywhere.

```bash
# Learn from your existing projects
vibe train ~/projects/solana-app ~/projects/api-server

# Now every project gets your patterns
cd ~/new-project && vibe
```

Training is now local-first by default: it scans your code (skips secrets) and generates deterministic skills directly from the deep scanner output — no Claude call required.

If you want AI enrichment (web research + Claude-generated skills), opt in explicitly:

```bash
vibe train . --ai
```

You can also add multiple external context files (docs or Opencode/Claude markdown exports):

```bash
# Local mode: parsed context signals feed deterministic skill generation
vibe train . \
  --context ~/exports/opencode-session.md \
  --context ~/docs/architecture-notes.md

# AI mode: same parsed signals are injected into the Claude prompt
vibe train . --ai \
  --context ~/exports/claude-session.md \
  --context ~/docs/roadmap.md
```

Session-style markdown exports are parsed for structured signals (decisions, conventions, architecture notes, TODOs, tooling/workflow). Plain markdown gracefully falls back to raw excerpt context.

### All commands

```
vibe                     Set up project + launch Claude Code
vibe train <path...>     Learn patterns from your repos (local mode by default)
vibe init                Set up project without launching
vibe mcp                 Discover and install MCP servers
vibe push [repo]         Push skill library to GitHub
vibe list                List trained skills
vibe config [key] [val]  Get or set configuration
```

### Flags

```
--ai                 Use Claude + web research during `vibe train`
--context <file>     Add extra context file (repeatable)
--force-retrain      Ignore cache and force skill regeneration (train only)
--force              Overwrite existing files
--new                Fresh session (skip resume)
--no-claude          Skip Claude Code install/launch
```

## What gets generated

```
.claude/
├── agents/          Specialized sub-agents (research, commits, testing, review)
├── skills/          Auto-generated + trained skills for your stack
├── commands/        Slash commands (/commit, /review, /test, /fix)
├── config/          Project configuration
└── settings.json
```

Everything is generated dynamically based on your actual project — not from a static template.

## Requirements

- Node.js >= 18
- [Claude Code](https://docs.anthropic.com/claude-code) (installed automatically if missing)
- `gh` CLI (only for `push`)

## Update

```bash
curl -fsSL https://raw.githubusercontent.com/intern-c-ag/vibe/master/install.sh | bash
```

## Uninstall

```bash
rm -rf ~/.vibe ~/.local/bin/vibe ~/.config/vibe
```
