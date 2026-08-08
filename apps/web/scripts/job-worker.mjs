#!/usr/bin/env node
/**
 * Job Worker - Processes pending jobs from the queue
 * Run: node --env-file=.env scripts/job-worker.mjs
 *
 * IMPORTANT: Valid campaign_lead_queue statuses:
 *   queued, sent, replied, interested, rejected, dead
 *
 * Valid job statuses:
 *   pending, processing, completed, failed, dead
 */
import { neon } from '@neondatabase/serverless';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

const POLL_INTERVAL = 100; // 0.1 seconds - maximum speed polling
const BATCH_SIZE = 200; // Process 200 jobs per batch for high throughput

// AWS SES Client for email
let sesClient = null;
if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  sesClient = new SESClient({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
  console.log(`AWS SES configured (region: ${process.env.AWS_REGION || 'us-east-1'})`);
}

// AWS SNS Client for SMS
let snsClient = null;
if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  snsClient = new SNSClient({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
  console.log(`AWS SNS configured for SMS`);
}

// Valid statuses for campaign_lead_queue (from database constraint)
const VALID_QUEUE_STATUSES = ['queued', 'sent', 'replied', 'interested', 'rejected', 'dead'];

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

let running = true;
let processed = 0;
let failed = 0;

process.on('SIGINT', () => {
  console.log('\nShutting down worker...');
  running = false;
});

async function processJob(job) {
  console.log(`  Processing job #${job.id} (${job.type})`);

  try {
    // Lock the job
    const [locked] = await sql`
      UPDATE jobs
      SET status = 'processing', locked_until = now() + interval '5 minutes', updated_at = now()
      WHERE id = ${job.id} AND status = 'pending'
      RETURNING id
    `;

    if (!locked) {
      console.log(`  Job #${job.id} already taken`);
      return;
    }

    // Process based on type
    let result = { success: true };

    switch (job.type) {
      case 'send_email':
      case 'send_message':
        // Simulate email send (in production, this would call the email provider)
        result = await processSendJob(job);
        break;

      case 'execute_campaign_sends':
        // Deprecated - mark as dead and skip
        console.log(`  Job #${job.id} uses deprecated type, marking dead`);
        await sql`UPDATE jobs SET status = 'dead', error_message = 'Deprecated job type' WHERE id = ${job.id}`;
        return;

      case 'execute_campaign_sends_v2':
        result = await processExecuteCampaignSends(job);
        break;

      case 'pipeline_health_check':
        result = await processHealthCheck(job);
        break;

      case 'calculate_regional_fees':
        result = await processRegionalFees(job);
        break;

      case 'ai_reply':
        result = await processAiReply(job);
        break;

      default:
        console.log(`  Unknown job type: ${job.type}, marking complete`);
    }

    if (result.success) {
      await sql`
        UPDATE jobs
        SET status = 'completed', locked_until = NULL, updated_at = now()
        WHERE id = ${job.id}
      `;
      console.log(`  ✓ Job #${job.id} completed`);
      processed++;
    } else {
      const attempts = (job.attempts || 0) + 1;
      const maxAttempts = job.max_attempts || 3;
      const newStatus = attempts >= maxAttempts ? 'dead' : 'failed';

      await sql`
        UPDATE jobs
        SET status = ${newStatus},
            attempts = ${attempts},
            error_message = ${result.error || 'Unknown error'},
            locked_until = NULL,
            updated_at = now()
        WHERE id = ${job.id}
      `;
      console.log(`  ✗ Job #${job.id} ${newStatus}: ${result.error}`);
      failed++;
    }

  } catch (error) {
    console.error(`  Error processing job #${job.id}:`, error.message);
    await sql`
      UPDATE jobs
      SET status = 'failed',
          error_message = ${error.message},
          locked_until = NULL,
          updated_at = now()
      WHERE id = ${job.id}
    `.catch(() => {});
    failed++;
  }
}

async function processSendJob(job) {
  const payload = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;
  const leadId = payload.leadId || payload.lead_id;
  const email = payload.email || payload.to;

  // Get organization info for compliance
  const [org] = await sql`SELECT id, name FROM organizations LIMIT 1`.catch(() => [{}]);
  const unsubUrl = process.env.UNSUBSCRIBE_URL || `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:4000'}/unsubscribe`;
  const postalAddress = process.env.BUSINESS_ADDRESS || '123 Main St, Suite 100, Anytown, ST 12345';

  // Build compliant email message
  const subject = payload.subject || `Quick question about your property`;
  let body = payload.body || `Hi ${payload.name || 'there'},

I noticed your property and wanted to reach out. I'm a local real estate investor and I help homeowners who might be looking for a quick, hassle-free sale.

Would you be interested in receiving a no-obligation cash offer? I can close on your timeline and handle all the paperwork.

Let me know if you'd like to chat!

Best regards,
${org?.name || 'DealFlow AI'}`;

  // Append CAN-SPAM footer if not present
  if (!body.includes(unsubUrl)) {
    body += `\n\n---\nTo unsubscribe: ${unsubUrl}\n${postalAddress}`;
  }

  // Check which email provider is configured
  const fromAddress = process.env.EMAIL_FROM_ADDRESS || 'noreply@dealflow.ai';
  const fromName = process.env.EMAIL_FROM_NAME || org?.name || 'DealFlow AI';

  let sent = false;
  let provider = 'mock';

  if (sesClient && email) {
    // REAL SEND via AWS SES (your own infrastructure)
    provider = 'aws-ses';
    try {
      await sesClient.send(new SendEmailCommand({
        Source: `${fromName} <${fromAddress}>`,
        Destination: { ToAddresses: [email] },
        Message: {
          Subject: { Data: subject },
          Body: { Text: { Data: body } }
        },
        ConfigurationSetName: process.env.AWS_SES_CONFIG_SET || undefined,
      }));
      sent = true;
      console.log(`    SENT [AWS SES] to ${email} (lead ${leadId})`);
    } catch (error) {
      console.error(`    AWS SES FAILED to ${email}:`, error.message);
      // In sandbox mode, can only send to verified emails - don't fail the job
      if (error.message.includes('not verified')) {
        console.log(`    (Sandbox mode - recipient not verified)`);
        sent = true; // Mark as sent to continue pipeline
        provider = 'aws-ses-sandbox';
      } else {
        return { success: false, error: error.message };
      }
    }
  } else {
    // MOCK SEND - no provider configured
    console.log(`    [MOCK] Send to ${email || 'unknown'} (lead ${leadId})`);
  }

  // Update queue status
  if (leadId) {
    await sql`
      UPDATE campaign_lead_queue
      SET status = 'sent', last_sent_at = now(), updated_at = now()
      WHERE lead_id = ${leadId}
    `.catch(() => {});

    // Record message event
    await sql`
      INSERT INTO message_events (lead_id, type, status, metadata, created_at)
      VALUES (${leadId}, 'email', 'sent', ${JSON.stringify({ subject, provider, sent })}::jsonb, now())
    `.catch(() => {});
  }

  return { success: true };
}

async function processExecuteCampaignSends(job) {
  const payload = typeof job.payload === 'string' ? JSON.parse(job.payload) : (job.payload || {});
  const batchSize = payload.batchSize || 500; // Large batch for high throughput (1000-10000 per minute target)

  // ATOMIC: Get AND lock queued leads in one transaction to prevent race conditions
  // Uses UPDATE ... RETURNING to atomically claim leads before processing
  const leads = await sql`
    WITH to_send AS (
      SELECT DISTINCT ON (l.email) clq.id as queue_id, clq.lead_id, clq.expected_value, clq.touch_number as orig_touch, l.name, l.email
      FROM campaign_lead_queue clq
      JOIN leads l ON l.id = clq.lead_id
      WHERE clq.status = 'queued'
        AND clq.scheduled_for <= now()
        AND l.email IS NOT NULL
      ORDER BY l.email, clq.expected_value DESC
      LIMIT ${batchSize}
    )
    UPDATE campaign_lead_queue
    SET status = 'sent',
        touch_number = campaign_lead_queue.touch_number + 1,
        last_sent_at = now(),
        updated_at = now()
    FROM to_send
    WHERE campaign_lead_queue.id = to_send.queue_id
      AND campaign_lead_queue.status = 'queued'
    RETURNING campaign_lead_queue.id, to_send.lead_id, to_send.expected_value, campaign_lead_queue.touch_number as new_touch, to_send.name, to_send.email
  `;

  console.log(`    Claimed and marked ${leads.length} leads as sent`);

  let processed = 0;
  for (const lead of leads) {
    try {
      // Create send job for each lead (already marked as sent, no race condition)
      await sql`
        INSERT INTO jobs (type, payload, status, max_attempts)
        VALUES ('send_email', ${JSON.stringify({
          leadId: lead.lead_id,
          email: lead.email,
          name: lead.name,
          touch: lead.new_touch
        })}, 'pending', 3)
      `;

      processed++;
    } catch (e) {
      console.error(`    Error creating job for lead ${lead.lead_id}:`, e.message);
    }
  }

  console.log(`    Processed ${processed}/${leads.length} leads`);

  // Check if there are more queued leads - if so, schedule another batch job
  // IMPORTANT: Only create ONE batch job at a time to prevent race conditions
  const [remaining] = await sql`
    SELECT COUNT(*)::int as count FROM campaign_lead_queue WHERE status = 'queued'
  `.catch(() => [{ count: 0 }]);

  if (remaining.count > 0) {
    // Check if there's already a pending batch job - don't create duplicates
    // IMPORTANT: Exclude current job (still 'processing' until this function returns)
    const [existingBatch] = await sql`
      SELECT id FROM jobs
      WHERE type = 'execute_campaign_sends_v2'
        AND status IN ('pending', 'processing')
        AND id != ${job.id}
      LIMIT 1
    `.catch(() => [null]);

    if (!existingBatch) {
      console.log(`    ${remaining.count} leads still queued - scheduling next batch`);
      await sql`
        INSERT INTO jobs (type, payload, status, max_attempts)
        VALUES ('execute_campaign_sends_v2', ${JSON.stringify({ batchSize })}::jsonb, 'pending', 5)
      `;
    } else {
      console.log(`    ${remaining.count} leads still queued - batch job already pending`);
    }
  } else {
    console.log(`    All leads processed - campaign batch complete`);
  }

  return { success: true, processed };
}

async function processHealthCheck(job) {
  console.log('    Running health check...');

  // Check for stuck jobs
  const stuck = await sql`
    UPDATE jobs
    SET status = 'pending', locked_until = NULL
    WHERE status = 'processing' AND locked_until < now()
    RETURNING id
  `;
  if (stuck.length > 0) {
    console.log(`    Reset ${stuck.length} stuck jobs`);
  }

  // Check warmup status
  const [warmup] = await sql`SELECT paused, paused_reason FROM email_warmup_config LIMIT 1`.catch(() => [{}]);
  if (warmup?.paused) {
    console.log(`    Warning: Warmup is paused - ${warmup.paused_reason}`);
  }

  // Schedule next health check (exponential backoff would be tracked in payload)
  const payload = typeof job.payload === 'string' ? JSON.parse(job.payload) : (job.payload || {});
  const currentInterval = payload.interval || 1;
  const maxInterval = payload.maxInterval || 8;
  const nextInterval = Math.min(currentInterval * 2, maxInterval);

  // Note: In production, you'd schedule this with a proper job scheduler
  console.log(`    Next health check in ${nextInterval} hours`);

  return { success: true };
}

async function processRegionalFees(job) {
  console.log('    Calculating regional fees...');
  // In production, this would update lead fees based on regional data
  return { success: true };
}

async function processAiReply(job) {
  const payload = typeof job.payload === 'string' ? JSON.parse(job.payload) : (job.payload || {});
  const leadId = payload.leadId || payload.lead_id;
  const inboundMessage = payload.message || payload.content || '';

  console.log(`    Processing AI reply for lead ${leadId || 'unknown'}`);

  if (!leadId) {
    return { success: false, error: 'No lead ID provided' };
  }

  // Get lead info
  const [lead] = await sql`
    SELECT l.*, clq.expected_value, clq.offer_min, clq.offer_max, clq.touch_number
    FROM leads l
    LEFT JOIN campaign_lead_queue clq ON clq.lead_id = l.id
    WHERE l.id = ${leadId}
  `.catch(() => [null]);

  if (!lead) {
    return { success: false, error: 'Lead not found' };
  }

  // Analyze sentiment and intent from inbound message
  const lowerMsg = inboundMessage.toLowerCase();
  let sentiment = 'neutral';
  let intent = 'unknown';
  let extractedPrice = null;

  // Try AI-based classification first (if Bedrock is configured)
  if (process.env.AWS_ACCESS_KEY_ID && process.env.BEDROCK_MODEL_CLASSIFY) {
    try {
      const { BedrockRuntimeClient, ConverseCommand } = await import('@aws-sdk/client-bedrock-runtime');
      const client = new BedrockRuntimeClient({
        region: process.env.AWS_REGION || 'us-east-1',
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        },
      });

      const classifyPrompt = `Classify this real estate seller response. Reply with JSON only.

Message: "${inboundMessage.slice(0, 500)}"

Return: {"sentiment": "positive|negative|neutral", "intent": "interested|opt_out|question|negotiating|unknown", "extractedPrice": null or number, "confidence": 0-1}`;

      const response = await client.send(new ConverseCommand({
        modelId: process.env.BEDROCK_MODEL_CLASSIFY,
        messages: [{ role: 'user', content: [{ text: classifyPrompt }] }],
        inferenceConfig: { maxTokens: 200, temperature: 0.1 },
      }));

      const aiText = response.output?.message?.content?.[0]?.text || '';
      const jsonMatch = aiText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        sentiment = parsed.sentiment || sentiment;
        intent = parsed.intent || intent;
        extractedPrice = parsed.extractedPrice;
        console.log(`    AI classified: sentiment=${sentiment}, intent=${intent}, confidence=${parsed.confidence}`);
      }
    } catch (aiErr) {
      console.log(`    AI classification failed, using rule-based: ${aiErr.message}`);
      // Fall through to rule-based
    }
  }

  // Fallback: Rule-based sentiment/intent detection
  if (intent === 'unknown') {
    if (/not interested|no thanks|stop|unsubscribe|remove|do not contact|take me off/i.test(lowerMsg)) {
      sentiment = 'negative';
      intent = 'opt_out';
    } else if (/interested|yes|tell me more|how much|what.*offer|sounds good|let's talk/i.test(lowerMsg)) {
      sentiment = 'positive';
      intent = 'interested';
    } else if (/\?|when|where|who|what|how|can you/i.test(lowerMsg)) {
      sentiment = 'neutral';
      intent = 'question';
    } else if (/price|offer|money|cash|pay|\$|thousand|k\b/i.test(lowerMsg)) {
      sentiment = 'positive';
      intent = 'negotiating';
      // Try to extract price from message
      const priceMatch = lowerMsg.match(/\$?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*(?:k|thousand)?/i);
      if (priceMatch) {
        let price = parseFloat(priceMatch[1].replace(/,/g, ''));
        if (/k\b|thousand/i.test(priceMatch[0])) price *= 1000;
        if (price > 10000 && price < 10000000) extractedPrice = price;
      }
    }
  }

  // Update lead status based on intent
  let newStatus = 'replied';
  if (intent === 'opt_out') {
    newStatus = 'rejected';
  } else if (intent === 'interested' || intent === 'negotiating') {
    newStatus = 'interested';
  }

  // Update queue status
  await sql`
    UPDATE campaign_lead_queue
    SET status = ${newStatus},
        reply_sentiment = ${sentiment},
        updated_at = now()
    WHERE lead_id = ${leadId}
  `.catch(() => {});

  // Update lead phase in metadata
  let newPhase = 'engaged';
  if (intent === 'interested') newPhase = 'qualifying';
  if (intent === 'negotiating') newPhase = 'negotiating';
  if (intent === 'opt_out') newPhase = 'lost';

  await sql`
    UPDATE leads
    SET metadata = metadata || ${JSON.stringify({ phase: newPhase, lastReply: inboundMessage.slice(0, 200), replySentiment: sentiment })}::jsonb,
        updated_at = now()
    WHERE id = ${leadId}
  `.catch(() => {});

  // Generate AI response if not opt-out
  if (intent !== 'opt_out') {
    const offerMin = (lead.offer_min || 1000000) / 100;
    const offerMax = (lead.offer_max || 3000000) / 100;
    const leadName = lead.name || 'there';
    const propertyAddr = lead.address || 'your property';

    let responseTemplate = '';

    // Try AI-generated response first
    if (process.env.AWS_ACCESS_KEY_ID && process.env.BEDROCK_MODEL_NEGOTIATE) {
      try {
        const { BedrockRuntimeClient, ConverseCommand } = await import('@aws-sdk/client-bedrock-runtime');
        const client = new BedrockRuntimeClient({
          region: process.env.AWS_REGION || 'us-east-1',
          credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          },
        });

        const responsePrompt = `You are a friendly real estate investor responding to a property owner. Write a brief, professional reply.

Context:
- Owner name: ${leadName}
- Property: ${propertyAddr}
- Their message: "${inboundMessage.slice(0, 300)}"
- Their intent: ${intent}
- Sentiment: ${sentiment}
- Our offer range: $${Math.floor(offerMin/1000)}K-$${Math.floor(offerMax/1000)}K
${extractedPrice ? `- They mentioned price: $${extractedPrice}` : ''}

Guidelines:
- Be warm and personal, not salesy
- Keep it under 100 words
- If they asked a question, answer it directly
- If they're negotiating, acknowledge their number and bridge toward a conversation
- Include a soft call-to-action (call or meeting)
- No excessive punctuation or emojis

Write the response only, no explanations:`;

        const response = await client.send(new ConverseCommand({
          modelId: process.env.BEDROCK_MODEL_NEGOTIATE,
          messages: [{ role: 'user', content: [{ text: responsePrompt }] }],
          inferenceConfig: { maxTokens: 300, temperature: 0.7 },
        }));

        const aiResponse = response.output?.message?.content?.[0]?.text?.trim();
        if (aiResponse && aiResponse.length > 20) {
          responseTemplate = aiResponse;
          console.log(`    AI generated personalized response (${aiResponse.length} chars)`);
        }
      } catch (aiErr) {
        console.log(`    AI response generation failed: ${aiErr.message}`);
      }
    }

    // Fallback: Template-based responses
    if (!responseTemplate) {
      if (intent === 'question') {
        responseTemplate = `Thanks for your question! I'd be happy to explain more about how we work. We buy properties as-is for cash, typically closing in 14-21 days. There are no fees, commissions, or repairs needed on your end. Would you like to discuss a potential offer for your property?`;
      } else if (intent === 'interested' || intent === 'negotiating') {
        responseTemplate = `Great to hear from you! Based on comparable sales in your area, I estimate we could offer somewhere in the $${Math.floor(offerMin/1000)}K-$${Math.floor(offerMax/1000)}K range, but I'd need to see the property to give you an exact number. Would you be available for a quick call or walkthrough this week?`;
      } else {
        responseTemplate = `Thanks for getting back to me! I understand you might have questions. We're local investors who buy properties directly from homeowners - no agents, no fees, no repairs needed. Is there anything specific you'd like to know about the process?`;
      }
    }

    // Create follow-up send job
    await sql`
      INSERT INTO jobs (type, payload, status, max_attempts)
      VALUES ('send_email', ${JSON.stringify({
        leadId,
        email: lead.email,
        name: lead.name,
        subject: 'Re: Your Property',
        body: responseTemplate,
        isReply: true,
        aiGenerated: !!responseTemplate && responseTemplate.length > 0
      })}::jsonb, 'pending', 3)
    `;

    console.log(`    Generated ${intent} response for lead ${leadId}`);
  } else {
    console.log(`    Lead ${leadId} opted out - no response sent`);

    // Record opt-out in suppression list
    await sql`
      INSERT INTO suppression_list (email, phone, reason, organization_id, created_at)
      VALUES (${lead.email}, ${lead.phone}, 'opt_out_reply', ${lead.organization_id || 'default'}, now())
      ON CONFLICT (email, organization_id) DO NOTHING
    `.catch(() => {});
  }

  // Record the interaction
  await sql`
    INSERT INTO message_events (lead_id, type, status, metadata, created_at)
    VALUES (${leadId}, 'ai_reply', 'processed', ${JSON.stringify({
      inboundMessage: inboundMessage.slice(0, 500),
      sentiment,
      intent,
      extractedPrice,
      newStatus,
      newPhase
    })}::jsonb, now())
  `.catch(() => {});

  // If price was extracted and we're negotiating, log to negotiation_events
  if (extractedPrice && intent === 'negotiating') {
    await sql`
      INSERT INTO negotiation_events (lead_id, event_type, amount_cents, metadata, created_at)
      VALUES (${leadId}, 'counter_offer_received', ${Math.round(extractedPrice * 100)}, ${JSON.stringify({
        source: 'ai_extraction',
        rawMessage: inboundMessage.slice(0, 200)
      })}::jsonb, now())
    `.catch(() => {});
    console.log(`    Logged counter-offer: $${extractedPrice.toLocaleString()}`);
  }

  return { success: true, sentiment, intent, newStatus, extractedPrice };
}

let lastCampaignCheck = 0;
const CAMPAIGN_CHECK_INTERVAL = 30000; // Check every 30 seconds

async function pollJobs() {
  while (running) {
    try {
      // Periodically ensure campaign is running (prevents stalls)
      const now = Date.now();
      if (now - lastCampaignCheck > CAMPAIGN_CHECK_INTERVAL) {
        lastCampaignCheck = now;
        await ensureCampaignRunning();
      }

      // Get pending jobs
      const jobs = await sql`
        SELECT id, type, payload, attempts, max_attempts
        FROM jobs
        WHERE status = 'pending'
          AND (locked_until IS NULL OR locked_until < now())
        ORDER BY created_at ASC
        LIMIT ${BATCH_SIZE}
      `;

      if (jobs.length > 0) {
        console.log(`\n[${new Date().toLocaleTimeString()}] Found ${jobs.length} pending jobs - processing in parallel`);

        // Process jobs in parallel batches of 50 for maximum throughput
        const PARALLEL_BATCH = 50;
        for (let i = 0; i < jobs.length; i += PARALLEL_BATCH) {
          if (!running) break;
          const batch = jobs.slice(i, i + PARALLEL_BATCH);
          await Promise.all(batch.map(job => processJob(job).catch(e => console.error(`Job ${job.id} error:`, e.message))));
        }
      }

    } catch (error) {
      console.error('Poll error:', error.message);
    }

    if (running) {
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
    }
  }
}

async function ensureCampaignRunning() {
  // Check if there are queued leads but no pending/processing batch jobs
  const [queued] = await sql`
    SELECT COUNT(*)::int as count
    FROM campaign_lead_queue
    WHERE status = 'queued' AND scheduled_for <= now()
  `.catch(() => [{ count: 0 }]);

  if (queued.count === 0) {
    console.log('No queued leads ready to send');
    return;
  }

  const [existingBatch] = await sql`
    SELECT id FROM jobs
    WHERE type = 'execute_campaign_sends_v2'
      AND status IN ('pending', 'processing')
    LIMIT 1
  `.catch(() => [null]);

  if (!existingBatch) {
    console.log(`Found ${queued.count} queued leads but no active batch job - creating one...`);
    await sql`
      INSERT INTO jobs (type, payload, status, max_attempts)
      VALUES ('execute_campaign_sends_v2', '{"batchSize": 500}'::jsonb, 'pending', 5)
    `;
    console.log('Batch job created - campaign will resume');
  } else {
    console.log(`Campaign already has active batch job #${existingBatch.id}`);
  }
}

// Main
console.log('');
console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║  JOB WORKER - HIGH THROUGHPUT MODE                         ║');
console.log('╠════════════════════════════════════════════════════════════╣');
console.log('║  Polling every 100ms for pending jobs                      ║');
console.log('║  Batch size: 200 jobs per cycle                            ║');
console.log('║  Parallel processing: 50 concurrent jobs                   ║');
console.log('║  Target: 1000-10000 messages per minute                    ║');
console.log('║  Press Ctrl+C to stop                                      ║');
console.log('╚════════════════════════════════════════════════════════════╝');
console.log('');

// Ensure campaign is running on startup
ensureCampaignRunning().then(() => {
  pollJobs().then(() => {
    console.log(`\nWorker stopped. Processed: ${processed}, Failed: ${failed}`);
    process.exit(0);
  });
}).catch(err => {
  console.error('Startup error:', err.message);
  process.exit(1);
});
