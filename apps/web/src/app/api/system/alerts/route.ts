/**
 * System Alerts API
 * Detects critical errors and notifies via email
 */
import { NextRequest } from 'next/server';
import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';
import { sendEmailAuto as sendEmail } from '@/app/api/utils/emailProviders';

type AlertSeverity = 'CRITICAL' | 'ERROR' | 'WARNING' | 'INFO';
type AlertCategory = 'PIPELINE' | 'PAYMENT' | 'CONTRACT' | 'INTEGRATION' | 'SYSTEM';

interface Alert {
  id: string;
  severity: AlertSeverity;
  category: AlertCategory;
  title: string;
  message: string;
  metadata?: any;
  timestamp: string;
  acknowledged: boolean;
}

const ALERT_EMAIL = 'roman.shumate@dealswiftautomation.com';

// Log and send alert
async function createAlert(
  severity: AlertSeverity,
  category: AlertCategory,
  title: string,
  message: string,
  metadata?: any
): Promise<Alert> {
  const alert: Alert = {
    id: `alert_${Date.now()}_${Math.random().toString(36).substring(7)}`,
    severity,
    category,
    title,
    message,
    metadata,
    timestamp: new Date().toISOString(),
    acknowledged: false,
  };

  // Store alert in database
  await sql`
    INSERT INTO system_alerts (id, severity, category, title, message, metadata, created_at)
    VALUES (${alert.id}, ${severity}, ${category}, ${title}, ${message}, ${JSON.stringify(metadata || {})}, NOW())
  `.catch(async () => {
    // Table might not exist, create it
    await sql`
      CREATE TABLE IF NOT EXISTS system_alerts (
        id TEXT PRIMARY KEY,
        severity TEXT NOT NULL,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT,
        metadata JSONB DEFAULT '{}',
        acknowledged BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `.catch(console.error);
  });

  // Send email for CRITICAL and ERROR
  if (severity === 'CRITICAL' || severity === 'ERROR') {
    const severityColor = severity === 'CRITICAL' ? 'red' : 'orange';
    await sendEmail('system', {
      to: ALERT_EMAIL,
      subject: `[${severity}] DealFlow Alert: ${title}`,
      text: `${severity}: ${title}\nCategory: ${category}\nMessage: ${message}`,
      html: `
        <div style="font-family: Arial, sans-serif;">
          <h2 style="color: ${severityColor};">${severity}: ${title}</h2>
          <p><strong>Category:</strong> ${category}</p>
          <p><strong>Time:</strong> ${alert.timestamp}</p>
          <hr/>
          <p>${message}</p>
          ${metadata ? `<pre style="background: #f5f5f5; padding: 10px; border-radius: 4px;">${JSON.stringify(metadata, null, 2)}</pre>` : ''}
          <hr/>
          <p style="color: gray; font-size: 12px;">Alert ID: ${alert.id}</p>
        </div>
      `,
    }).catch(console.error);

    console.log(`[ALERT] ${severity} - ${category}: ${title}`);
  }

  return alert;
}

// Create alert endpoint
export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { severity, category, title, message, metadata } = body;

  if (!severity || !category || !title) {
    return Response.json({ error: 'severity, category, and title required' }, { status: 400 });
  }

  try {
    const alert = await createAlert(
      severity as AlertSeverity,
      category as AlertCategory,
      title,
      message || '',
      metadata
    );

    return Response.json({ alert, sent: true });
  } catch (error: any) {
    console.error('[ALERTS] Error:', error);
    return Response.json({ error: 'Failed to create alert' }, { status: 500 });
  }
}

// Get recent alerts
export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const url = new URL(req.url);
  const severity = url.searchParams.get('severity');
  const limit = parseInt(url.searchParams.get('limit') || '50');

  try {
    let alerts;
    if (severity) {
      alerts = await sql`
        SELECT * FROM system_alerts
        WHERE severity = ${severity}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `.catch(() => []);
    } else {
      alerts = await sql`
        SELECT * FROM system_alerts
        ORDER BY created_at DESC
        LIMIT ${limit}
      `.catch(() => []);
    }

    return Response.json({ alerts, count: alerts.length });
  } catch (error: any) {
    console.error('[ALERTS] Fetch error:', error);
    return Response.json({ alerts: [], count: 0 });
  }
}

// Run system health check and generate alerts
export async function runHealthCheck(): Promise<Alert[]> {
  const alerts: Alert[] = [];

  try {
    // Check database connection
    const dbCheck = await sql`SELECT 1 as ok`.catch(() => null);
    if (!dbCheck) {
      alerts.push(await createAlert('CRITICAL', 'SYSTEM', 'Database Connection Failed', 'Cannot connect to PostgreSQL database'));
    }

    // Check for stuck deals (in NEGOTIATING for > 7 days)
    const stuckDeals = await sql`
      SELECT COUNT(*) as count FROM leads
      WHERE status = 'NEGOTIATING'
      AND updated_at < NOW() - INTERVAL '7 days'
    `.catch(() => [{ count: 0 }]);

    if (Number(stuckDeals[0]?.count) > 10) {
      alerts.push(await createAlert('WARNING', 'PIPELINE', 'Stuck Deals Detected', `${stuckDeals[0].count} deals stuck in NEGOTIATING for >7 days`));
    }

    // Check for failed payments
    const failedPayments = await sql`
      SELECT COUNT(*) as count FROM payments
      WHERE status = 'failed'
      AND created_at > NOW() - INTERVAL '24 hours'
    `.catch(() => [{ count: 0 }]);

    if (Number(failedPayments[0]?.count) > 0) {
      alerts.push(await createAlert('ERROR', 'PAYMENT', 'Failed Payments', `${failedPayments[0].count} payments failed in last 24 hours`));
    }

    // Check for unverified wire payments > 48h
    const pendingWires = await sql`
      SELECT COUNT(*) as count FROM payments
      WHERE method = 'wire' AND status = 'pending'
      AND created_at < NOW() - INTERVAL '48 hours'
    `.catch(() => [{ count: 0 }]);

    if (Number(pendingWires[0]?.count) > 0) {
      alerts.push(await createAlert('WARNING', 'PAYMENT', 'Pending Wire Verifications', `${pendingWires[0].count} wire payments awaiting verification for >48h`));
    }

    console.log(`[HEALTH] Check complete: ${alerts.length} alerts generated`);

  } catch (error: any) {
    alerts.push(await createAlert('CRITICAL', 'SYSTEM', 'Health Check Failed', error.message));
  }

  return alerts;
}
