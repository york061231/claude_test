# CLAUDE.md

This file provides guidance for AI assistants working with this repository.

## Repository Overview

**Repository:** `york061231/claude_test`
**Status:** New repository — no source code, build system, or tests have been established yet.

## Project Structure

This is a freshly initialized repository. As the project develops, this section should be updated to reflect the directory layout and module organization.

```
claude_test/
├── CLAUDE.md          # AI assistant guidance (this file)
└── .git/              # Git repository
```

## Development Workflow

### Getting Started

1. Clone the repository
2. Check out or create your feature branch
3. Make changes, commit, and push

### Branch Conventions

- Feature branches should follow the pattern: `claude/<description>-<session-id>`
- Always push with: `git push -u origin <branch-name>`

### Commit Messages

- Use clear, descriptive commit messages
- Start with a verb in imperative mood (e.g., "Add", "Fix", "Update", "Remove")
- Keep the subject line under 72 characters

## Build and Test

No build system or test framework has been configured yet. When they are added, document the commands here:

- **Build:** _TBD_
- **Test:** _TBD_
- **Lint:** _TBD_
- **Format:** _TBD_

## Key Conventions

### Code Style

No language or style guidelines have been established yet. When a language is chosen and linters/formatters are configured, update this section with:

- Language and version requirements
- Linting rules and configuration
- Formatting standards
- Import ordering conventions

### General Principles

- Keep changes focused and minimal — avoid unnecessary refactoring
- Do not introduce security vulnerabilities (OWASP top 10)
- Prefer editing existing files over creating new ones
- Do not add features, abstractions, or complexity beyond what is requested

## Updating This File

This CLAUDE.md should be kept up to date as the project evolves. Update it when:

- A build system or package manager is added
- Test frameworks are configured
- CI/CD pipelines are set up
- Code style or linting rules are established
- New major directories or modules are created
- Key architectural decisions are made
