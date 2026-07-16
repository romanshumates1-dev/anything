# DealFlow AI — Pull Request Template

## Description
Brief description of what this PR changes and why.

## Checklist
- [ ] Code compiles (`yarn workspace web typecheck` passes)
- [ ] Unit/integration tests pass (`yarn workspace web test` passes)
- [ ] Lint passes (`yarn dlx oxlint apps/web/src` passes)
- [ ] Type check 0 errors
- [ ] Linting 0 errors

## BREAKAGE_TABLE.md
If this PR claims any features are verified, add the corresponding rows to `BREAKAGE_TABLE.md` with observed evidence:

| # | Feature | File(s) | How verified (exact command) | Actual observed result | Status |

**Required for claimed features:**
- Test command + observed output pasted (NOT narrative)
- Mutation-proof: test fails on deliberate break (`grep -c "if (!hasConsent)"` etc.)
- No vacuous assertions (`expect(result).toBeDefined()` without checking what it means)

## Verification Steps Performed
(Run these before requesting review)

- [ ] Unit tests: `npx vitest run --config src/app/api/vitest.config.ts`
- [ ] Typecheck: `yarn workspace web typecheck`
- [ ] Lint: `yarn dlx oxlint@1.58.0 --no-ignore apps/web/src`
- [ ] Manual verification (if UI change): describe what you checked

## Risks & Notes
- Any database schema changes? (Yes/No)
- Any breaking API changes? (Yes/No)
- Dependencies added/removed? (Yes/No)

---
*Delete this section before merging.*