# Implementation Plan: Fix MCP Servers and Skills Integration

## Goal
Fix broken MCP server configurations and ensure superpowers skills are genuinely integrated into Cline's agent skills.

## Architecture
- Fix `cline_mcp_settings.json` with verified correct npm packages
- Add superpowers skills to both project `.clinerules` AND global VS Code settings
- Verify each MCP server can start

## Tech Stack
- Cline VS Code extension
- Node.js/npx for MCP servers
- obra/superpowers skills framework

## Global Constraints
- All MCP servers must use correct, existing npm packages
- Skills must be in both project-level and global custom instructions
- No broken configurations that would crash Cline on startup

---

## Task 1: Verify All MCP Package Names
- [x] `@modelcontextprotocol/server-github` ✅
- [x] `@modelcontextprotocol/server-filesystem` ✅
- [x] `@playwright/mcp` ✅
- [x] `@brave/brave-search-mcp-server` ✅ (was wrong)
- [x] `@modelcontextprotocol/server-postgres` ✅ (was wrong)
- [x] `@modelcontextprotocol/server-memory` ✅
- [x] `firecrawl-mcp` ✅ (was wrong)
- [x] `figma-mcp-server` ✅
- [x] `sentry-mcp-server` ✅
- [x] `@supabase/mcp-server-supabase` ✅ (was wrong)
- [x] `linear-mcp-server` ✅
- [x] `@cloudflare/mcp-server-cloudflare` ✅ (was wrong)
- [x] `@upstash/context7-mcp` ✅ (was wrong)
- [x] Git: `@mseep/git-mcp-server` ✅ (no official package exists)
- [ ] Sequential Thinking: preserve existing `github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking`

## Task 2: Rewrite `cline_mcp_settings.json` with Correct Packages
- Remove broken packages
- Add correct package names
- Proper env variable configuration

## Task 3: Add Superpowers Skills to Global Cline Settings
- Read current VS Code settings
- Add superpowers skills to global custom instructions
- Keep project `.clinerules` as backup

## Task 4: Verify Each Server Starts
- Test at least 3 servers to confirm they launch

## Task 5: Document API Key Requirements
- List all servers that need credentials
- Provide guidance on where to get them