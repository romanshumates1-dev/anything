/**
 * Contact import service — extends the existing lead ingestion to support
 * campaign-specific contact lists in .txt / pasted / CSV format.
 *
 * Supports:
 *  - "Name, Phone" or "Phone, Name" (comma/tab separated)
 *  - "Name Phone" (space separated, phone must contain 7+ digits)
 *  - CSV with headers: name,phone,email (bonus)
 */

export interface ParsedContact {
  name: string;
  phone: string;       // normalized digits-only, kept raw for now
  raw: string;
  valid: boolean;
  error?: string;
}

const STRONG_YES = /\b(yes|yeah|yep|i am|interested|selling|sell it|i'm in|let'?s talk)\b/i;
const STRONG_NO = /\b(no|not interested|not selling|don'?t want|never)\b/i;

export function parseContactList(rawText: string, defaultCountry = 'US'): ParsedContact[] {
  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const results: ParsedContact[] = [];

  for (const line of lines) {
    // Try CSV parse first (handles quoted fields)
    let parts: string[];
    if (line.includes(',') || line.includes('\t')) {
      parts = splitCsvLine(line).map(p => p.trim()).filter((p, idx, arr) => p !== '' || idx > 0);
    } else {
      parts = [line];
    }

    let name = '';
    let phoneRaw = '';

    if (parts.length >= 2) {
      // Determine which part is phone (contains 7+ digits)
      const digitsA = parts[0].replace(/\D/g, '');
      const digitsB = parts[1].replace(/\D/g, '');
      if (digitsA.length >= 7) {
        phoneRaw = parts[0];
        name = parts.slice(1).join(' ');
      } else {
        name = parts[0];
        phoneRaw = parts.slice(1).join(' ');
      }
    } else if (parts.length === 1) {
      // Single token — try to split name and phone by regex
      const match = line.match(/(.*?)(\+?\d[\d\s().-]{6,}\d)/);
      if (match) {
        name = match[1].trim();
        phoneRaw = match[2].trim();
      } else {
        phoneRaw = line;
      }
    }

    // Validate phone — must contain at least 10 digits
    const digits = phoneRaw.replace(/\D/g, '');
    if (digits.length < 10) {
      results.push({
        name: name || 'Unknown',
        phone: phoneRaw,
        raw: line,
        valid: false,
        error: 'Invalid phone number (too few digits)',
      });
      continue;
    }

    // Normalize to E.164-ish: bare 10-digit US numbers get +1
    const hasPlus = phoneRaw.trim().startsWith('+');
    let normalized: string;
    if (!hasPlus && digits.length === 10) {
      // Default bare 10-digit US numbers to +1
      normalized = '+1' + digits;
    } else {
      normalized = (hasPlus ? '+' : '') + digits;
    }

    results.push({
      name: name || 'Unknown',
      phone: normalized,
      raw: line,
      valid: true,
    });
  }

  return results;
}

/** Split one CSV line honoring double-quoted fields. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',' || ch === '\t') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export function dedupeContacts(contacts: ParsedContact[]): ParsedContact[] {
  const seen = new Set<string>();
  const unique: ParsedContact[] = [];
  for (const c of contacts) {
    if (!c.valid) {
      unique.push(c); // keep invalid rows in output for error reporting
      continue;
    }
    if (seen.has(c.phone)) continue;
    seen.add(c.phone);
    unique.push(c);
  }
  return unique;
}