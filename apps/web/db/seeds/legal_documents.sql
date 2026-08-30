-- ============================================================================
-- Legal documents seed - standard SaaS templates
-- These are editable templates - administrators can update content
-- ============================================================================

-- Terms of Service
INSERT INTO legal_documents (id, document_type, title, content, version) VALUES
('legal_tos_1', 'terms_of_service', 'Terms of Service', '# Terms of Service

Last updated: July 2026

## 1. Acceptance of Terms
By accessing or using DealFlow AI, you agree to be bound by these Terms of Service.

## 2. Service Description
DealFlow AI provides automated SMS marketing, lead management, and contract generation services.

## 3. Accounts and Subscriptions
- Each organization must maintain at least one verified account
- Subscription plans and limits are defined in-app
- Cancellation requires 30 days notice

## 4. Acceptable Use
You agree not to:
- Send unsolicited messages in violation of CAN-SPAM or TCPA
- Use the service for illegal purposes
- Exceed your subscription limits

## 5. Limitations
- The service is provided "as-is" without warranties
- We are not liable for message delivery failures
- Data retention: 30 days for messages, 7 years for contracts', '1.0.0')
ON CONFLICT (id) DO UPDATE SET content = excluded.content;

-- Privacy Policy
INSERT INTO legal_documents (id, document_type, title, content, version) VALUES
('legal_privacy_1', 'privacy_policy', 'Privacy Policy', '# Privacy Policy

Last updated: July 2026

## 1. Information We Collect
- Account information (name, email, organization)
- Lead data you import
- Messages sent through the platform
- Usage metrics

## 2. How We Use Information
- Provide and improve our services
- Process payments
- Comply with legal obligations

## 3. Data Sharing
We do not sell or rent your data. We share only as required:
- With Twilio for SMS delivery
- With payment processors for billing
- When required by law

## 4. Your Rights
- Access your data
- Request corrections
- Delete your account (subject to retention requirements)', '1.0.0')
ON CONFLICT (id) DO UPDATE SET content = excluded.content;

-- Acceptable Use Policy
INSERT INTO legal_documents (id, document_type, title, content, version) VALUES
('legal_aup_1', 'acceptable_use', 'Acceptable Use Policy', '# Acceptable Use Policy

## 1. Prohibited Uses
- Illegal activities
- Harassment or abuse
- Spam or unsolicited messages
- Impersonation

## 2. SMS Compliance
- All messages must comply with 10DLC regulations
- Recipients must have opted in
- Include clear opt-out instructions', '1.0.0')
ON CONFLICT (id) DO UPDATE SET content = excluded.content;

-- Refund Policy
INSERT INTO legal_documents (id, document_type, title, content, version) VALUES
('legal_refund_1', 'refund_policy', 'Refund Policy', '# Refund Policy

## 1. Subscription Refunds
- Within 7 days: Full refund
- After 7 days: No refunds, but credits issued

## 2. Usage-Based Charges
- SMS overages are final sale
- Enterprise customers may negotiate custom terms', '1.0.0')
ON CONFLICT (id) DO UPDATE SET content = excluded.content;