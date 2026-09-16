import { defineCloudflareConfig } from '@opennextjs/cloudflare';

/**
 * OpenNext → Cloudflare Workers adapter configuration.
 *
 * The incremental cache is intentionally left at the default (disabled) while
 * we bring the app up. Enabling the R2 incremental cache requires an extra R2
 * binding, which arrives in a later phase alongside the bucket that hosts the
 * desktop installer. See:
 *   https://opennext.js.org/cloudflare/caching
 *
 * To enable it later:
 *   import r2IncrementalCache from '@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache';
 *   export default defineCloudflareConfig({ incrementalCache: r2IncrementalCache });
 * …and add to wrangler.jsonc:
 *   "r2_buckets": [{ "binding": "NEXT_INC_CACHE_R2_BUCKET", "bucket_name": "..." }]
 */
export default defineCloudflareConfig({});
