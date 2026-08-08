# DealFlow AI - System Overview

## Quick Links
- [Deal Pipeline Features](./DEAL-PIPELINE-FEATURES.md)
- [Operations Status](../OPERATIONS-STATUS.md)
- [Production Validation](../PRODUCTION-VALIDATION-COMPLETE.md)

## Core Features

### 1. Lead Management
- Lead import from multiple sources
- Lead scoring and qualification
- Stage tracking (NEW → CONTACTED → ENGAGED → NEGOTIATING → SIGNED → ASSIGNED)

### 2. Outreach Channels
- **Email**: Free 500/day (Gmail), scale to 50k+/day (AWS SES)
- **SMS**: A2P 10DLC compliant
- **Direct Mail**: Postal campaigns
- **Voice/RVM**: Ringless voicemail

### 3. AI Negotiation
- Automated reply classification
- Price negotiation within bounds
- Escalation to human for edge cases

### 4. Contract Pipeline
- Purchase Agreement (seller e-sign)
- Assignment Contract (buyer e-sign)
- Fee Agreement (buyer e-sign)
- Mock provider for dev, Documenso/DocuSign for production

### 5. Buyer Network
- Buyer database with coverage areas
- Automatic matching by zip/price/type
- Quality scoring by close history

## Authentication

### Standard Auth
- Email/password login
- Social auth (Google, Apple)
- Password reset via email

### Endpoints
- `POST /api/auth/forgot-password` - Request reset
- `POST /api/auth/reset-password` - Set new password

## Email Provider Tiers

| Provider | Daily Limit | Cost | Setup |
|----------|-------------|------|-------|
| Gmail SMTP | 500 | Free | SMTP_USER + SMTP_PASS |
| Google Workspace | 2,000 | Free | GEMINI_SMTP_USER + PASS |
| AWS SES | 50,000+ | $0.10/1000 | AWS_SES_ACCESS_KEY |

## Database

PostgreSQL via Supabase with tables:
- `leads`, `buyer_leads`, `buyers`
- `contracts`, `buyer_assignments`
- `negotiations`, `message_events`
- `password_reset_tokens`

## Compliance

- CAN-SPAM enforced on all emails
- TCPA compliance for SMS/calls
- DNC registry checks
- Opt-out tracking
