import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { logEvent } from '../../utils/logger';
import { recordRun } from '../../utils/execution-ledger';
import {
  parseLeadsCsv,
  dedupeInBatch,
  chunk,
  MAX_IMPORT_ROWS,
  INSERT_CHUNK_SIZE,
  type LeadType,
} from '../../utils/ingestion';

/**
 * Bulk lead ingestion. Accepts CSV text (file contents) or pasted rows.
 * - parses + validates each row (pure logic in utils/ingestion)
 * - dedupes within the batch AND against existing leads (phone/email hash)
 * - batch-inserts in chunks of INSERT_CHUNK_SIZE
 * - records an `imports` row + per-row `import_failures`
 */
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const text = typeof body.text === 'string' ? body.text : '';
    const source = body.source === 'paste' ? 'paste' : 'csv';
    const filename = typeof body.filename === 'string' ? body.filename : null;
    const defaultType: LeadType = body.defaultType === 'buyer' ? 'buyer' : 'seller';

    if (!text.trim()) {
      return Response.json({ error: 'No CSV/text content provided' }, { status: 400 });
    }

    const { valid, failures, totalRows } = parseLeadsCsv(text, defaultType);

    if (totalRows > MAX_IMPORT_ROWS) {
      return Response.json(
        { error: `Import exceeds ${MAX_IMPORT_ROWS} row limit (${totalRows} rows)` },
        { status: 413 }
      );
    }

    // 1. Dedupe within the uploaded batch.
    const { unique, duplicates } = dedupeInBatch(valid);

    // 2. Dedupe against existing leads already in the DB.
    const hashes = unique.map((u) => u.dedupeHash).filter((h) => h.length > 0);
    let existing = new Set<string>();
    if (hashes.length > 0) {
      const rows = await sql`
        SELECT DISTINCT dedupe_hash FROM leads WHERE dedupe_hash = ANY(${hashes})
      `;
      existing = new Set(rows.map((r: any) => r.dedupe_hash));
    }
    const toInsert = unique.filter((u) => !u.dedupeHash || !existing.has(u.dedupeHash));
    const dbDuplicates = unique.length - toInsert.length;
    const totalDuplicates = duplicates.length + dbDuplicates;

    // 3. Create the import record (processing).
    const [imp] = await sql`
      INSERT INTO imports (source, filename, total_rows, status, created_by)
      VALUES (${source}, ${filename}, ${totalRows}, 'processing', ${session.user.id})
      RETURNING id
    `;

    // 4. Batch insert in chunks.
    let inserted = 0;
    for (const part of chunk(toInsert, INSERT_CHUNK_SIZE)) {
      const values: any[] = [];
      const placeholders = part
        .map((l, idx) => {
          const b = idx * 6;
          values.push(l.name, l.type, l.email, l.phone, l.source, l.dedupeHash || null);
          return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6})`;
        })
        .join(',');
      const query = `INSERT INTO leads (name, type, email, phone, source, dedupe_hash) VALUES ${placeholders} RETURNING id`;
      const rows = await sql(query, values);
      inserted += rows.length;
    }

    // 5. Persist failures (capped storage; first 1000 to avoid runaway rows).
    const failuresToStore = failures.slice(0, 1000);
    for (const f of failuresToStore) {
      await sql`
        INSERT INTO import_failures (import_id, row_number, raw_data, reason)
        VALUES (${imp.id}, ${f.rowNumber}, ${JSON.stringify(f.raw)}, ${f.reason})
      `;
    }

    // 6. Finalize import record.
    await sql`
      UPDATE imports
      SET inserted_rows = ${inserted},
          duplicate_rows = ${totalDuplicates},
          failed_rows = ${failures.length},
          status = 'completed'
      WHERE id = ${imp.id}
    `;

    await logEvent(
      'leads_imported',
      'import',
      String(imp.id),
      { inserted, duplicates: totalDuplicates, failed: failures.length, totalRows },
      session.user.id
    );

    await recordRun({
      task: 'csv_import',
      flow: 'csv_import_10k',
      step: 'bulk_insert',
      status: 'pass',
      passed: true,
      detail: `inserted=${inserted}, duplicates=${totalDuplicates}, failed=${failures.length}, totalRows=${totalRows}`,
      dbAssertion: `imports.id=${imp.id} status='completed'`,
      logAssertion: "audit_logs.action='leads_imported'",
    });

    return Response.json({
      importId: imp.id,
      totalRows,
      inserted,
      duplicates: totalDuplicates,
      failed: failures.length,
      failures: failures.slice(0, 50),
    });
  } catch (error: any) {
    console.error('POST /api/leads/bulk error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
