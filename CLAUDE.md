# CLAUDE.md

This file provides guidance for AI assistants working with this repository.

## Repository Overview

**Repository:** `york061231/claude_test`
**Remote:** `http://127.0.0.1:22614/git/york061231/claude_test`
**Status:** New repository — no source code, build system, or tests have been established yet.
**Last Updated:** 2026-02-25

## Project Structure

This is a freshly initialized repository containing only this guidance file.

```
claude_test/
├── CLAUDE.md          # AI assistant guidance (this file)
└── .git/              # Git repository metadata
```

As the project develops, update this section to reflect the actual directory layout and module organization.

## Branch Structure

| Branch | Purpose |
|--------|---------|
| `master` | Primary integration branch |
| `claude/<description>-<session-id>` | AI-driven feature/change branches |

### Current Branches

- `master` — initial commit with CLAUDE.md
- `claude/claude-md-mm1fviyqyciclzl1-J81bm` — active AI feature branch

## Development Workflow

### Getting Started

1. Clone the repository
2. Check out or create your designated feature branch
3. Make focused, minimal changes
4. Commit with a descriptive message
5. Push to origin

### Branch Conventions

- AI feature branches must follow the pattern: `claude/<description>-<session-id>`
- The `<session-id>` suffix must match the current Claude session identifier
- Always push with: `git push -u origin <branch-name>`
- Never push to `master` or another session's branch without explicit permission

### Git Push Requirements

- Branch names **must** start with `claude/` and end with the matching session ID, or push will fail with HTTP 403
- Retry pattern for network failures: wait 2s, 4s, 8s, 16s between attempts (up to 4 retries)
- Example: `git push -u origin claude/<description>-<session-id>`

### Commit Messages

- Start with a verb in imperative mood: `Add`, `Fix`, `Update`, `Remove`, `Refactor`
- Keep the subject line under 72 characters
- Add a blank line before the body if a longer description is needed
- Reference related context (e.g., issue numbers, session IDs) in the commit body

**Good examples:**
```
Add user authentication module
Fix null pointer in payment handler
Update CLAUDE.md with branch conventions
```

## Build and Test

No build system or test framework has been configured yet. When added, document commands here:

| Task | Command |
|------|---------|
| Build | _TBD_ |
| Test | _TBD_ |
| Lint | _TBD_ |
| Format | _TBD_ |

## Key Conventions

### Code Style

No language or style guidelines have been established yet. When a language is chosen and tooling is configured, update this section with:

- Language and version requirements
- Linting rules and configuration files
- Formatting standards and tools
- Import ordering conventions

### General Principles for AI Assistants

- **Minimal changes:** Keep edits focused and scoped to what was requested. Do not refactor surrounding code.
- **No new files unless necessary:** Prefer editing existing files over creating new ones.
- **No over-engineering:** Avoid adding abstractions, utilities, or helpers for one-off tasks.
- **No speculative features:** Do not add functionality beyond what was explicitly requested.
- **Security first:** Do not introduce OWASP Top 10 vulnerabilities (XSS, SQLi, command injection, etc.).
- **No comments on unchanged code:** Only add comments where logic is genuinely non-obvious.
- **No backwards-compat shims:** If something is removed, remove it completely rather than aliasing it.

### Confirmation Before Risky Actions

Always confirm with the user before:
- Deleting files or branches
- Force-pushing or resetting commits
- Modifying shared infrastructure (CI/CD, permissions)
- Pushing to branches other than the designated feature branch

## Updating This File

Keep this CLAUDE.md current as the project evolves. Update it when:

- A language, runtime, or package manager is chosen
- A build system is configured
- Test frameworks are added
- CI/CD pipelines are set up
- Linting or formatting tools are established
- New major directories or modules are introduced
- Key architectural decisions are made
