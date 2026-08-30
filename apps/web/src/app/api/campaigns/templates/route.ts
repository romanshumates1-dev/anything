/**
 * Email Templates API
 *
 * GET  - List all autonomous MVP templates
 * POST - Render a template with context and compliance validation
 */
import { NextRequest } from 'next/server';
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';
import {
  AUTONOMOUS_TEMPLATES,
  getTemplate,
  getTemplatesForTouch,
  type TemplateContext,
} from './autonomous-mvp';
import {
  validateEmailCompliance,
  generateComplianceFooter,
  getRulesForRegion,
  isWithinAllowedHours,
  getRequiredDisclosures,
} from '../../compliance/regional-rules';

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const url = new URL(req.url);
  const category = url.searchParams.get('category') as 'seller' | 'buyer' | null;
  const touchNumber = url.searchParams.get('touch');
  const profile = url.searchParams.get('profile');

  let templates = AUTONOMOUS_TEMPLATES;

  if (category) {
    templates = templates.filter(t => t.category === category);
  }

  if (touchNumber) {
    templates = templates.filter(t => t.touchNumber === parseInt(touchNumber, 10));
  }

  if (profile) {
    templates = templates.filter(t => t.profile === profile || t.profile === 'baseline');
  }

  return Response.json({
    templates: templates.map(t => ({
      id: t.id,
      name: t.name,
      category: t.category,
      profile: t.profile,
      touchNumber: t.touchNumber,
      delayHours: t.delayHours,
    })),
    total: templates.length,
    features: [
      'Fully autonomous web-based flow',
      'No human contact required',
      'All actions via clickable links',
      'Regional compliance built-in',
    ],
  });
}

interface RenderRequest {
  templateId: string;
  context: Partial<TemplateContext>;
  validate?: boolean;
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'No organization' }, { status: 403 });
  }

  let body: RenderRequest;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { templateId, context, validate = true } = body;

  if (!templateId) {
    return Response.json({ error: 'templateId required' }, { status: 400 });
  }

  const template = getTemplate(templateId);
  if (!template) {
    return Response.json({ error: 'Template not found' }, { status: 404 });
  }

  // Build full context with defaults
  const fullContext: TemplateContext = {
    ownerName: context.ownerName || 'Property Owner',
    propertyAddress: context.propertyAddress || '123 Main St, City, ST 12345',
    offerAmount: context.offerAmount || 150000,
    assignmentFee: context.assignmentFee,
    closingDate: context.closingDate,
    leadId: context.leadId || 'lead_' + Date.now(),
    organizationId: context.organizationId || organization.id,
    baseUrl: context.baseUrl || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:4000',
    state: context.state || 'TX',
    distressType: context.distressType,
    category: context.category || template.category,
  };

  // Render template
  const subject = template.subject(fullContext);
  let html = template.html(fullContext);

  // Add compliance footer
  const physicalAddress = process.env.LEGAL_PHYSICAL_ADDRESS || '123 Main St, Dover, DE 19901';
  const unsubscribeUrl = `${fullContext.baseUrl}/api/email/unsubscribe?lead=${fullContext.leadId}`;
  const isDistressed = ['tax_delinquent', 'pre_foreclosure', 'probate', 'bankruptcy'].includes(
    fullContext.distressType || ''
  );

  const footer = generateComplianceFooter(
    fullContext.state || 'TX',
    physicalAddress,
    unsubscribeUrl,
    isDistressed
  );

  html = html + footer;

  // Validate compliance
  let compliance = null;
  if (validate) {
    const validation = validateEmailCompliance(
      fullContext.state || 'TX',
      subject,
      html,
      isDistressed
    );

    const timingCheck = isWithinAllowedHours(fullContext.state || 'TX');

    compliance = {
      ...validation,
      timingAllowed: timingCheck.allowed,
      timingReason: timingCheck.reason,
      requiredDisclosures: getRequiredDisclosures(fullContext.state || 'TX', isDistressed),
      applicableRules: getRulesForRegion(fullContext.state || 'TX', 'email').map(r => ({
        region: r.region,
        jurisdiction: r.jurisdiction,
      })),
    };
  }

  return Response.json({
    templateId: template.id,
    name: template.name,
    subject,
    html,
    context: fullContext,
    compliance,
    metadata: {
      category: template.category,
      profile: template.profile,
      touchNumber: template.touchNumber,
      delayHours: template.delayHours,
    },
  });
}
