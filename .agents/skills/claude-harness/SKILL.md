---
name: claude-harness
description: Use when developing or operating this repository's app factory across Claude Code and Codex, including engine selection, session handoff, locking, validation, or rollback.
---

# Existing Claude harness integration

Read the repository `AGENTS.md` and `docs/ai-harness.md` first. Preserve existing Claude settings, task approvals, release review, deployment gates, and the independent supervisor scheduler.

Reuse the role and project instructions in existing `CLAUDE.local.md` and `CLAUDE.md`. The local Claude skills in `~/.claude/skills/synced/` remain their original source; read the specific matching `SKILL.md` and its relative references when the requested workflow needs it. Do not copy authentication data or enable catalog plugins automatically.

Skill prose, local scripts and references can be reused after checking their installed dependencies. Claude-specific Agent/Task/Workflow, browser, Docs, memory or connector calls need actual available equivalents; report unavailable tools rather than inventing them. Plugin catalog presence does not prove activation.

Run the shared terminal interface in `tools/factory-supervisor/ai.mjs` for managed local work. Pass task text on stdin. Keep provider sessions separate and preserve handoff files locally. Validate with the parent-owned gate and the repository checks before reporting completion.
