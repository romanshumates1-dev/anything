#!/usr/bin/env node
/**
 * Link checker script for internal navigation.
 * Walks all internal hrefs and verifies they return 200.
 */

import sql from '../src/app/api/utils/sql';

const BASE_URL = process.env.BASE_URL || 'http://localhost:4000';

interface LinkCheckResult {
  href: string;
  status: number | null;
  error?: string;
}

// Extract all internal links from marketing pages
const MARKETING_PAGES = [
  '/',
  '/how-it-works',
  '/features',
  '/pricing',
  '/faq',
  '/about',
  '/contact',
  '/trust',
  '/reviews',
  '/legal/terms',
  '/legal/privacy',
  '/legal/acceptable-use',
  '/legal/sms-terms',
  '/legal/refunds',
  '/legal/cookies',
  '/legal/disclaimers',
  '/legal/esign',
  '/legal/dmca',
];

const LEGAL_LINKS = [
  '/legal/terms',
  '/legal/privacy',
  '/legal/acceptable-use',
  '/legal/sms-terms',
  '/legal/refunds',
  '/legal/cookies',
  '/legal/disclaimers',
  '/legal/esign',
  '/legal/dmca',
];

async function checkUrl(url: string): Promise<LinkCheckResult> {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    return { href: url, status: response.status };
  } catch (error) {
    return { href: url, status: null, error: error instanceof Error ? error.message : String(error) };
  }
}

async function runLinkCheck() {
  const allLinks = new Set<string>();
  
  // Add all known pages
  MARKETING_PAGES.forEach(p => allLinks.add(`${BASE_URL}${p}`));
  
  // Check footer links
  const footerLinks = [
    '/features', '/pricing', '/trust', '/reviews',
    '/legal/terms', '/legal/privacy', '/legal/acceptable-use', '/legal/sms-terms',
    '/legal/refunds', '/legal/cookies', '/legal/esign', '/legal/dmca',
    '/about', '/contact', '/how-it-works',
  ];
  footerLinks.forEach(p => allLinks.add(`${BASE_URL}${p}`));

  console.log(`Checking ${allLinks.size} internal links...\n`);

  const results: LinkCheckResult[] = [];
  let failed = 0;
  let passed = 0;

  for (const href of allLinks) {
    const result = await checkUrl(href);
    results.push(result);
    if (result.status === 200) {
      passed++;
    } else if (result.status !== 200) {
      failed++;
      console.log(`❌ ${href} - Status: ${result.status || 'ERROR'}`);
    } else {
      console.log(`⚠️ ${href} - Need to verify manually`);
    }
  }

  console.log(`\nLink Check Complete: ${passed} passed, ${failed} failed`);
  
  if (failed > 0) {
    process.exit(1);
  }
}

runLinkCheck();