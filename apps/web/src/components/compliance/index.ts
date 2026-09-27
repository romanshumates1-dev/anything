export { TCPAConsentAcknowledgment } from './TCPAConsentAcknowledgment';
export { MessagingComplianceWall } from './MessagingComplianceWall';
export { ContractDisclaimer } from './ContractDisclaimer';
export { RealEstateDisclaimer } from './RealEstateDisclaimer';
export { FairHousingNotice } from './FairHousingNotice';
export { ComplianceFooter } from './ComplianceFooter';
export { LegalDisclaimerBanner } from './LegalDisclaimerBanner';
// NOTE: `generateCANSPAMFooterHTML` was removed (2026-09-26). It lived in this
// 'use client' file and built unsubscribe tokens as
// `base64(contactId:EMAIL_UNSUB_SECRET)` — reversible encoding, not an HMAC, so
// every generated link would have handed the secret to whoever received the
// email, and in the browser the env var is undefined anyway (silently falling
// back to a hardcoded 'dev-secret'). Real footers are minted server-side by
// `app/api/utils/emailDriver.ts` `withCanSpamFooter(body, { unsubscribeUrl,
// postalAddress })`, which receives an already-signed URL. This component now
// renders only what the server hands it and never forges a token.
export { CANSPAMFooter } from './CANSPAMFooter';
