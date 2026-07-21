# Screenshots — pending capture

Prompt 1 Phase 1 requires real product screenshots on `/how-it-works`, captured
from the running dev app. This session's browser-automation surfaces were
unavailable for image capture (see `BREAKAGE_TABLE.md` "Phase 1 environment
blocker" entry): the in-app Browser pane's `screenshot`/`zoom` actions timed
out consistently across multiple tabs/attempts while every other action
(navigate, click, form fill, page-text read) worked normally, and the Chrome
extension fallback was not connected.

The `/how-it-works` page currently renders honest gray placeholder panels
(`ImagePlaceholder` component) — not broken image tags, not fabricated
images — labeled by step (Lead Import, Campaign Wizard, Negotiation Panel,
Notification, Contract Preview).

**To complete:** once a working screenshot capability is available, capture
each step from a seeded dev session (`node --env-file=.env scripts/migrate.mjs`
then sign up + promote to ADMIN, seed a few leads/campaign/conversation — see
BREAKAGE_TABLE.md for the exact commands used this session), save as
`lead-import.png`, `campaign-wizard.png`, `negotiation-panel.png`,
`notification.png`, `contract-preview.png` in this directory, and swap each
`<ImagePlaceholder>` in `src/app/(marketing)/how-it-works/page.tsx` for a real
`<Image>` tag.
