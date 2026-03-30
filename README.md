# skillsmith

> Learn how you code. Generate reusable Claude Code skills from your repos.

## Quick Start

```bash
# Train on your repos
skillsmith train ~/projects/my-app ~/projects/api-server

# Set up skills in a new project
skillsmith init .

# Push your skill library to GitHub
skillsmith push
```

## What It Does

**`skillsmith train <path...>`** — Scans your repos, detects patterns (stack, conventions, architecture), and uses Claude Code to generate reusable `.claude` skills. Sensitive files are automatically skipped.

**`skillsmith init [dir]`** — Sets up `.claude/skills/` in a project using your trained skill library.

**`skillsmith push [repo]`** — Pushes your skill library to a GitHub repo for sharing and reuse.

**`skillsmith list`** — Shows all your trained skills.

**`skillsmith config [key] [value]`** — Get/set configuration.

## How Training Works

1. Scans project structure and dependencies
2. Detects stack (languages, frameworks, tools)
3. Samples representative code (skips secrets, env files, credentials)
4. Feeds analysis to Claude Code to generate SKILL.md files
5. Stores skills in `~/.config/skillsmith/skills/`

### What Gets Skipped

- `.env*`, `*secret*`, `*credential*`, `*.key`, `*.pem`
- `node_modules/`, `.git/`, `dist/`, `build/`
- Files matching `.gitignore`
- Any file containing secrets/tokens in content

## Requirements

- Node.js >= 18
- [Claude Code](https://docs.anthropic.com/claude-code) installed and authenticated
- `gh` CLI (for push command)

## License

MIT
