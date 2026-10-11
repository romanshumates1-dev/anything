# Gemini CLI Workspace Setup Design

**Date:** 2026-10-11  
**Status:** Approved for specification review

## Overview

Set up Google's official Gemini CLI as a standalone coding agent for this Windows workspace. It will run from the terminal; this setup cannot replace the model or add tools to the already-running Copilot SDK conversation.

## Design

- Install the official stable `@google/gemini-cli@latest` globally using the available Node.js/npm toolchain. Prefer the stable channel over preview or nightly to get current, validated releases.
- Authenticate interactively with the user's Google account using the CLI's Google OAuth flow. Do not create, request, store, or print an API key. Free usage and model access depend on Google's current eligibility, quotas, and terms and are not guaranteed by this setup.
- Add a concise root `GEMINI.md` with workspace-specific coding conventions and focused verification commands. Do not copy credentials or unrelated project documentation into it.
- Keep the CLI's normal confirmation behavior for edits and commands. Do not enable YOLO/auto-approval modes.

## Verification

1. Compare the installed CLI version with the current npm `latest` version.
2. Complete Google OAuth in the user's browser; confirm the CLI can make a read-only request in this workspace.
3. In a separate temporary directory, have the CLI make one bounded edit to a disposable fixture and verify the resulting file. Remove only the named temporary test files afterward.
4. Confirm the root `GEMINI.md` is syntactically plain Markdown and contains no secrets.

If OAuth cannot be completed in this environment, report that exact limitation and provide the command to finish sign-in locally rather than claiming an authenticated test passed.

## Out of Scope

- Integrating Gemini CLI into the live Copilot SDK conversation or configuring an MCP bridge for future chats.
- Changing DealFlow application code, dependencies, or existing MCP configuration.
- Enabling paid API credentials, organization billing, or unattended/auto-approved execution.
