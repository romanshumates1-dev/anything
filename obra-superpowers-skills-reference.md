# Obra Superpowers Skills Reference

> Downloaded from https://github.com/obra/superpowers on 2026-07-13
> These skills are now integrated into my operating methodology.

---

## Core Workflow (The Basic Loop)

1. **brainstorming** → Before ANY creative work. Refine ideas through questions, explore alternatives, present design in sections, get approval.
2. **using-git-worktrees** → After design approval. Create isolated workspace on new branch, run project setup, verify clean test baseline.
3. **writing-plans** → With approved design. Break work into bite-sized tasks (2-5 min each) with exact file paths, complete code, verification steps.
4. **subagent-driven-development** or **executing-plans** → With plan. Dispatch fresh subagent per task with two-stage review, or execute in batches with checkpoints.
5. **test-driven-development** → During implementation. RED-GREEN-REFACTOR: write failing test, watch it fail, write minimal code, watch it pass, commit.
6. **requesting-code-review** → Between tasks. Review against plan, report issues by severity. Critical issues block progress.
7. **finishing-a-development-branch** → When tasks complete. Verify tests, present options (merge/PR/keep/discard), clean up worktree.

---

## The Iron Laws

| Skill | Iron Law |
|-------|----------|
| **using-superpowers** | IF A SKILL APPLIES TO YOUR TASK, YOU DO NOT HAVE A CHOICE. YOU MUST USE IT. |
| **brainstorming** | Do NOT invoke any implementation skill until design is approved by user. |
| **test-driven-development** | NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST. Write code before test? Delete it. |
| **systematic-debugging** | NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST. |
| **verification-before-completion** | NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE. |
| **writing-skills** | NO SKILL WITHOUT A FAILING TEST FIRST. |

---

## Skill Invocation Rules

- **Check for skills BEFORE any response or action** — including clarifying questions, exploring codebase, or checking files.
- If there's even a 1% chance a skill might apply, you MUST invoke it.
- Announce "Using [skill] to [purpose]" and follow the skill exactly.
- If it has a checklist, create a todo per item.
- Process skills come first (brainstorming, systematic-debugging), then implementation skills.
- User instructions (CLAUDE.md, AGENTS.md, etc.) take precedence over skills, which override default behavior.

### Red Flags (Rationalization Detection)

| Thought | Reality |
|---------|---------|
| "This is just a simple question" | Questions are tasks. Check for skills. |
| "I need more context first" | Skill check comes BEFORE clarifying questions. |
| "Let me explore the codebase first" | Skills tell you HOW to explore. Check first. |
| "This doesn't need a formal skill" | If a skill exists, use it. |
| "I remember this skill" | Skills evolve. Read current version. |
| "The skill is overkill" | Simple things become complex. Use it. |
| "I'll just do this one thing first" | Check BEFORE doing anything. |

---

## Brainstorming (9-Step Checklist)

1. Explore project context — check files, docs, recent commits
2. Offer visual companion just-in-time (NOT upfront)
3. Ask clarifying questions — one at a time
4. Propose 2-3 approaches with trade-offs and recommendation
5. Present design in sections, get approval per section
6. Write design doc to `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` and commit
7. Spec self-review (placeholders, contradictions, ambiguity, scope)
8. User reviews written spec
9. Transition to implementation — invoke writing-plans ONLY

**Key principles:** One question at a time, multiple choice preferred, YAGNI ruthlessly, explore alternatives, incremental validation.

---

## Writing Plans

- **Announce:** "I'm using the writing-plans skill to create the implementation plan."
- **Save to:** `docs/superpowers/plans/YYYY-MM-DD-<feature-name>.md`
- **Task granularity:** Each step is one action (2-5 minutes)
- **Every plan MUST start with header** including: Goal, Architecture, Tech Stack, Global Constraints
- **No placeholders:** Every step must contain actual content. No "TBD", "TODO", "implement later", "Add appropriate error handling"
- **Self-review:** Spec coverage, placeholder scan, type consistency
- **Execution handoff:** Offer subagent-driven-development (recommended) or inline execution

---

## Subagent-Driven Development

- **Core principle:** Fresh subagent per task + task review (spec + quality) + broad final review
- **Continuous execution:** Do not pause to check in with human partner between tasks
- **Narration:** Between tool calls, narrate at most one short line
- **Model selection:** Use least powerful model that can handle each role
- **Durable progress:** Track in ledger file (`.superpowers/sdd/progress.md`), not just todos
- **File handoffs:** Everything goes through files, not pasted text
- **Never:** Skip task review, proceed with unfixed issues, dispatch multiple implementation subagents in parallel

---

## Test-Driven Development (RED-GREEN-REFACTOR)

1. **RED** - Write one minimal failing test
2. **Verify RED** - Watch it fail (MANDATORY)
3. **GREEN** - Write simplest code to pass
4. **Verify GREEN** - Watch it pass (MANDATORY)
5. **REFACTOR** - Clean up, keep tests green
6. **Repeat** - Next failing test for next feature

**The Iron Law:** If you didn't watch the test fail, you don't know if it tests the right thing.

---

## Systematic Debugging (4 Phases)

1. **Root Cause Investigation** - Read errors, reproduce, check recent changes, gather evidence, trace data flow
2. **Pattern Analysis** - Find working examples, compare against references, identify differences
3. **Hypothesis and Testing** - Form single hypothesis, test minimally, verify before continuing
4. **Implementation** - Create failing test, implement single fix, verify fix

**If 3+ fixes failed:** STOP and question the architecture.

---

## Verification Before Completion

**The Gate Function:**
1. IDENTIFY: What command proves this claim?
2. RUN: Execute the FULL command (fresh, complete)
3. READ: Full output, check exit code, count failures
4. VERIFY: Does output confirm the claim?
5. ONLY THEN: Make the claim

**Red flags:** Using "should", "probably", "seems to"; expressing satisfaction before verification; trusting agent success reports.

---

## Finishing a Development Branch

1. Verify tests pass
2. Detect environment (normal repo vs worktree vs detached HEAD)
3. Determine base branch
4. Present options (4 for normal: merge/PR/keep/discard; 3 for detached HEAD)
5. Execute choice
6. Cleanup workspace (only for merge and discard options)

---

## Dispatching Parallel Agents

- Use when 2+ independent tasks can work without shared state
- One agent per independent problem domain
- Dispatch all in same response for parallel execution
- Review and integrate after all return

---

## Writing Skills

- **TDD for documentation:** Write test (pressure scenario) → watch fail → write skill → watch pass → refactor
- **Description = When to Use, NOT What the Skill Does** (critical for discovery)
- **Bulletproofing:** Close every loophole explicitly, address spirit vs letter, build rationalization table, create red flags list
- **Token efficiency:** Getting-started workflows <150 words, frequently-loaded <200 words, other <500 words

---

## Key Anti-Patterns to Avoid

- Starting implementation on main/master without explicit consent
- Skipping task review or accepting incomplete reports
- Proceeding with unfixed Critical/Important issues
- Making subagents read whole plan file (use task-brief instead)
- Telling a reviewer what not to flag
- Dispatching multiple implementation subagents in parallel
- Skipping verification before claiming completion
- Fixing bugs without writing a failing test first
- Proposing fixes before root cause investigation
- Using "should", "probably", "seems to" instead of verified evidence