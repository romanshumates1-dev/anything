/**
 * NANP area code → APPROXIMATE region centroid (lat/lng) + label.
 *
 * Privacy by design: prospect location is derived ONLY from the phone's area
 * code — a region-level approximation, never a precise address. No new PII is
 * stored or computed. Used by the analytics globe to plot roughly where a
 * campaign is messaging. Unknown/unmapped codes return null (skipped).
 *
 * Coverage: the target states (KY, NC, GA, MO) in depth + major US metros so
 * real phone data lands somewhere sensible. Centroids are metro/region-level.
 */
export interface GeoPoint {
  lat: number;
  lng: number;
  region: string;
  /** IANA timezone — the ONLY safe way to do lead-local time (DST-correct via Intl). */
  tz: string;
}

const AREA_CODES: Record<string, GeoPoint> = {
  // ── Kentucky ── (note: western KY is CENTRAL, not Eastern)
  '502': { lat: 38.25, lng: -85.76, region: 'Louisville, KY', tz: 'America/New_York' },
  '859': { lat: 38.04, lng: -84.5, region: 'Lexington, KY', tz: 'America/New_York' },
  '270': { lat: 37.0, lng: -87.0, region: 'Western KY', tz: 'America/Chicago' },
  '364': { lat: 37.0, lng: -87.0, region: 'Western KY', tz: 'America/Chicago' },
  '606': { lat: 37.5, lng: -83.2, region: 'Eastern KY', tz: 'America/New_York' },
  // ── North Carolina ──
  '704': { lat: 35.23, lng: -80.84, region: 'Charlotte, NC', tz: 'America/New_York' },
  '980': { lat: 35.23, lng: -80.84, region: 'Charlotte, NC', tz: 'America/New_York' },
  '919': { lat: 35.78, lng: -78.64, region: 'Raleigh, NC', tz: 'America/New_York' },
  '984': { lat: 35.78, lng: -78.64, region: 'Raleigh, NC', tz: 'America/New_York' },
  '336': { lat: 36.07, lng: -79.79, region: 'Greensboro, NC', tz: 'America/New_York' },
  '743': { lat: 36.07, lng: -79.79, region: 'Greensboro, NC', tz: 'America/New_York' },
  '828': { lat: 35.6, lng: -82.55, region: 'Asheville, NC', tz: 'America/New_York' },
  '910': { lat: 34.22, lng: -78.02, region: 'Wilmington, NC', tz: 'America/New_York' },
  '252': { lat: 35.6, lng: -77.37, region: 'Eastern NC', tz: 'America/New_York' },
  // ── Georgia ──
  '404': { lat: 33.75, lng: -84.39, region: 'Atlanta, GA', tz: 'America/New_York' },
  '470': { lat: 33.75, lng: -84.39, region: 'Atlanta, GA', tz: 'America/New_York' },
  '678': { lat: 33.75, lng: -84.39, region: 'Atlanta metro, GA', tz: 'America/New_York' },
  '770': { lat: 33.95, lng: -84.35, region: 'Atlanta suburbs, GA', tz: 'America/New_York' },
  '912': { lat: 32.08, lng: -81.09, region: 'Savannah, GA', tz: 'America/New_York' },
  '478': { lat: 32.84, lng: -83.63, region: 'Macon, GA', tz: 'America/New_York' },
  '706': { lat: 33.47, lng: -82.01, region: 'Augusta, GA', tz: 'America/New_York' },
  '762': { lat: 33.47, lng: -82.01, region: 'Augusta, GA', tz: 'America/New_York' },
  '229': { lat: 31.58, lng: -84.16, region: 'Albany, GA', tz: 'America/New_York' },
  // ── Missouri + St. Louis ──
  '314': { lat: 38.63, lng: -90.2, region: 'St. Louis, MO', tz: 'America/Chicago' },
  '557': { lat: 38.63, lng: -90.2, region: 'St. Louis, MO', tz: 'America/Chicago' },
  '636': { lat: 38.65, lng: -90.6, region: 'St. Louis suburbs, MO', tz: 'America/Chicago' },
  '816': { lat: 39.1, lng: -94.58, region: 'Kansas City, MO', tz: 'America/Chicago' },
  '975': { lat: 39.1, lng: -94.58, region: 'Kansas City, MO', tz: 'America/Chicago' },
  '417': { lat: 37.21, lng: -93.29, region: 'Springfield, MO', tz: 'America/Chicago' },
  '573': { lat: 38.57, lng: -92.17, region: 'Central MO', tz: 'America/Chicago' },
  '660': { lat: 39.4, lng: -93.2, region: 'Northern MO', tz: 'America/Chicago' },
  // ── Major US metros (so any real number maps) ──
  '212': { lat: 40.71, lng: -74.0, region: 'New York, NY', tz: 'America/New_York' },
  '213': { lat: 34.05, lng: -118.24, region: 'Los Angeles, CA', tz: 'America/Los_Angeles' },
  '312': { lat: 41.88, lng: -87.63, region: 'Chicago, IL', tz: 'America/Chicago' },
  '305': { lat: 25.76, lng: -80.19, region: 'Miami, FL', tz: 'America/New_York' },
  '713': { lat: 29.76, lng: -95.37, region: 'Houston, TX', tz: 'America/Chicago' },
  '214': { lat: 32.78, lng: -96.8, region: 'Dallas, TX', tz: 'America/Chicago' },
  '512': { lat: 30.27, lng: -97.74, region: 'Austin, TX', tz: 'America/Chicago' },
  // Arizona does NOT observe DST — a deliberate DST-safety test case.
  '602': { lat: 33.45, lng: -112.07, region: 'Phoenix, AZ', tz: 'America/Phoenix' },
  '215': { lat: 39.95, lng: -75.16, region: 'Philadelphia, PA', tz: 'America/New_York' },
  '206': { lat: 47.61, lng: -122.33, region: 'Seattle, WA', tz: 'America/Los_Angeles' },
  '303': { lat: 39.74, lng: -104.99, region: 'Denver, CO', tz: 'America/Denver' },
  '617': { lat: 42.36, lng: -71.06, region: 'Boston, MA', tz: 'America/New_York' },
  '415': { lat: 37.77, lng: -122.42, region: 'San Francisco, CA', tz: 'America/Los_Angeles' },
  '202': { lat: 38.9, lng: -77.04, region: 'Washington, DC', tz: 'America/New_York' },
  '615': { lat: 36.16, lng: -86.78, region: 'Nashville, TN', tz: 'America/Chicago' },
  '901': { lat: 35.15, lng: -90.05, region: 'Memphis, TN', tz: 'America/Chicago' },
  '317': { lat: 39.77, lng: -86.16, region: 'Indianapolis, IN', tz: 'America/Indiana/Indianapolis' },
  '614': { lat: 39.96, lng: -82.99, region: 'Columbus, OH', tz: 'America/New_York' },
  '216': { lat: 41.5, lng: -81.69, region: 'Cleveland, OH', tz: 'America/New_York' },
};

const US_CENTER: GeoPoint = { lat: 39.5, lng: -98.35, region: 'United States (approx.)', tz: 'America/New_York' };

/**
 * Every US timezone a phone could plausibly sit in. Used ONLY when the area
 * code is unknown/ambiguous: the dispatch gate then requires the send to be
 * legal in ALL of them (most-restrictive interpretation) — if it could be
 * 9:05pm anywhere the number might be, we hold.
 */
export const ALL_US_TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
] as const;

/**
 * Candidate lead-local timezones for a phone.
 * Known area code → exactly one. Unknown → ALL US zones (caller must require
 * every one to pass). An unparseable phone also returns ALL (fail safe).
 */
export function timezonesForPhone(phone: string | null | undefined): string[] {
  const ac = areaCodeOf(phone);
  const hit = ac ? AREA_CODES[ac] : undefined;
  return hit ? [hit.tz] : [...ALL_US_TIMEZONES];
}

/** Extract the 3-digit area code from a phone string (handles +1, (), -, spaces). */
export function areaCodeOf(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  // Strip a leading US country code.
  const nsn = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (nsn.length < 3) return null;
  return nsn.slice(0, 3);
}

/**
 * Approximate region point for a phone. Unknown area code → US center (so a
 * dot still shows, labeled approximate) unless `strict` is set (→ null).
 */
export function regionForPhone(phone: string | null | undefined, strict = false): GeoPoint | null {
  const ac = areaCodeOf(phone);
  if (!ac) return null;
  return AREA_CODES[ac] ?? (strict ? null : US_CENTER);
}

export { AREA_CODES, US_CENTER };
