# DealFlow AI - Deal Pipeline Features

## Implemented Features (2026-07-31)

### 1. Password Reset Flow
- **Forgot Password Page**: `/account/forgot-password`
- **Reset Password Page**: `/account/reset-password?token=...`
- **API Endpoints**:
  - `POST /api/auth/forgot-password` - Send reset email
  - `POST /api/auth/reset-password` - Set new password
- **Database**: `password_reset_tokens` table
- **Security**: Tokens expire in 1 hour, single-use

### 2. Contract E-Sign Pipeline
- **Purchase Agreement**: Sent to sellers when deal is agreed
- **Assignment Contract**: Sent to buyers when matched
- **Fee Agreement**: Combined with assignment contract
- **API Endpoint**: `POST /api/contracts/send`
- **Supported Providers**: Mock (dev), Documenso, DocuSign

### 3. Buyer Matching & Assignment
- **Matching Criteria**:
  - Zip code coverage
  - Price range fit
  - Property type preference
  - Verified status
  - Past close history
- **API Endpoint**: `POST /api/buyers/match`
- **Auto-Assignment**: Optional automatic buyer assignment
- **Database**: `buyer_assignments` table

### 4. Multi-Provider Email System
- **Gmail SMTP**: Free 500/day
- **AWS SES**: 50,000/day @ $0.10/1000
- **Google Workspace**: 2,000/day
- **Auto-Selection**: Picks best available provider based on quota

## Email Flow

```
Lead Outreach → Reply → Negotiation → Agreement
                                        ↓
                                  Seller Signs
                                        ↓
                          Purchase Agreement (e-sign)
                                        ↓
                              Buyer Matched
                                        ↓
                    Assignment Contract + Fee Agreement (e-sign)
                                        ↓
                              Deal Closed
                                        ↓
                           Fee Collected at Closing
```

## Configuration

### Gmail (Free - 500/day)
```env
SMTP_USER=your@gmail.com
SMTP_PASS=your-app-password
```

### AWS SES (Scale - 50k+/day)
```env
AWS_SES_ACCESS_KEY=...
AWS_SES_SECRET_KEY=...
AWS_SES_FROM_ADDRESS=noreply@yourdomain.com
```

### Google Workspace (Medium - 2k/day)
```env
GEMINI_SMTP_USER=your@workspace.com
GEMINI_SMTP_PASS=your-app-password
```

### E-Sign Provider
```env
ESIGN_PROVIDER=mock  # or documenso, docusign
DOCUMENSO_API_KEY=...
DOCUSIGN_API_KEY=...
```

## Testing

```bash
# Test email pipeline
node scripts/test-email-pipeline.mjs

# Verify deal pipeline
node scripts/verify-deal-pipeline.mjs
```

## Files Added

### Frontend
- `src/app/account/forgot-password/page.tsx`
- `src/app/account/reset-password/page.tsx`

### API Routes
- `src/app/api/auth/forgot-password/route.ts`
- `src/app/api/auth/reset-password/route.ts`
- `src/app/api/contracts/send/route.ts`
- `src/app/api/buyers/match/route.ts`

### Utilities
- `src/app/api/utils/emailProviders.ts`

### Migrations
- `db/migrations/053_password_reset_tokens.sql`
- `db/migrations/054_buyer_assignments.sql`

### Scripts
- `scripts/test-email-pipeline.mjs`
- `scripts/verify-deal-pipeline.mjs`

## CAN-SPAM Compliance

All outbound emails include:
1. Valid physical postal address
2. Unsubscribe link
3. Clear sender identification
4. Honest subject lines

The `canSpamGuard` function in `emailDriver.ts` enforces these requirements before any email is sent.
