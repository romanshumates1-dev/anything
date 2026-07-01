const SQL_KEYWORDS = /\b(SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|EXEC|UNION|CREATE|OR|AND|HAVING)\b/gi;
export function sanitizeInput(input: string): string {
  return input
    .split(/\s+/)
    .map(t => t.replace(SQL_KEYWORDS, ''))
    .join(' ')
    .trim();
}
