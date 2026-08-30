import sql from '@/app/api/utils/sql';
import { callAI } from '@/app/api/utils/ai-provider';

const BRIEF_STALE_MS = 24 * 60 * 60 * 1000;

const SYSTEM_PROMPT = `You are a call prep assistant for a real estate investor. Given the lead's context, produce a concise 3-5 bullet call brief that helps the caller:
1. Greet by name and reference the property
2. Acknowledge any distress signals or motivation (pre-foreclosure, probate, vacancy, tax lien, etc.)
3. Ask the right opening question
4. Know what price range or terms might work (based on equity/ARV if available)
5. Flag any compliance notes (prior DNC request on other channel, recent contact, etc.)

Keep each bullet under 20 words. No filler, no greetings script. The caller is experienced — just give them the intel.`;

export interface CallBrief {
  brief: string;
  generatedAt: string;
  stale: boolean;
}

export async function generateCallBrief(
  leadId: number,
  organizationId: string
): Promise<CallBrief> {
  const [lead] = await sql`
    SELECT l.*,
      (SELECT json_agg(json_build_object('role', h.role, 'content', h.content))
       FROM (SELECT * FROM jsonb_array_elements(COALESCE(ac.history, '[]'::jsonb)) WITH ORDINALITY ORDER BY ordinality DESC LIMIT 5) h(role, content, ordinality)
      ) as recent_messages
    FROM leads l
    LEFT JOIN ai_conversations ac ON ac.lead_id = l.id
    WHERE l.id = ${leadId} AND l.organization_id = ${organizationId}
    LIMIT 1
  `;
  if (!lead) throw new Error(`Lead ${leadId} not found`);

  const meta = lead.metadata ?? {};
  const cached = meta.call_brief;
  if (cached && cached.generated_at) {
    const age = Date.now() - new Date(cached.generated_at).getTime();
    if (age < BRIEF_STALE_MS) {
      return { brief: cached.text, generatedAt: cached.generated_at, stale: false };
    }
  }

  const context = [
    `Name: ${lead.name || 'Unknown'}`,
    `Phone: ${lead.phone}`,
    lead.email ? `Email: ${lead.email}` : null,
    meta.property_address ? `Property: ${meta.property_address}` : null,
    meta.county ? `County: ${meta.county}` : null,
    meta.signals?.length ? `Signals: ${meta.signals.join(', ')}` : null,
    meta.equity ? `Equity: ${meta.equity}` : null,
    meta.arv ? `ARV: ${meta.arv}` : null,
    meta.mortgage_balance ? `Mortgage: ${meta.mortgage_balance}` : null,
    lead.status ? `Lead status: ${lead.status}` : null,
    lead.recent_messages ? `Recent conversation:\n${JSON.stringify(lead.recent_messages)}` : null,
  ].filter(Boolean).join('\n');

  const response = await callAI({
    messages: [{ role: 'user', content: `Prepare a call brief for this lead:\n\n${context}` }],
    system: SYSTEM_PROMPT,
    maxTokens: 300,
  });

  const generatedAt = new Date().toISOString();
  await sql`
    UPDATE leads
    SET metadata = jsonb_set(
      COALESCE(metadata, '{}'::jsonb),
      '{call_brief}',
      ${JSON.stringify({ text: response.text, generated_at: generatedAt })}::jsonb
    )
    WHERE id = ${leadId}
  `;

  return { brief: response.text, generatedAt, stale: false };
}

export async function getOrGenerateBrief(
  leadId: number,
  organizationId: string
): Promise<CallBrief | null> {
  try {
    return await generateCallBrief(leadId, organizationId);
  } catch {
    return null;
  }
}
