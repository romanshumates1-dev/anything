/**
 * Minimal HTML-entity escaping for values interpolated into a hand-built HTML
 * response string (mock-checkout / mock-sign confirmation pages). Prevents
 * reflected XSS via query-string values like contractId/envelopeId
 * (BREAKAGE_TABLE #34).
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
