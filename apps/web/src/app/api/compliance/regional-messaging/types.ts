/**
 * Type definitions for the Regional Compliance Engine
 */

export type Channel = 'sms' | 'voice' | 'rvm' | 'email';

export type ConsentType = 'prior_express_written' | 'prior_express' | 'implied' | 'none';

export interface QuietHoursRange {
  startHour: number; // 0-23
  endHour: number; // 0-23, exclusive (21 means up to 8:59pm)
}

export interface QuietHoursResult {
  allowed: boolean;
  reason?: string;
  nextAllowedTime?: Date;
}

export interface FrequencyLimits {
  perDay: number;
  perWeek: number;
  perMonth: number;
}

export interface SmsDisclosures {
  firstMessage: string[];
  subsequent: string[];
  realEstate?: string[];
  ccpa?: string[];
  floridaSpecific?: string[];
  texasSpecific?: string[];
}

export interface EmailDisclosures {
  required: string[];
  realEstate?: string[];
  canSpam: string[];
  ccpa?: string[];
  floridaSpecific?: string[];
  texasSpecific?: string[];
}

export interface VoiceDisclosures {
  opener: string[];
  realEstate?: string[];
}

export interface Disclosures {
  sms: SmsDisclosures;
  email: EmailDisclosures;
  voice: VoiceDisclosures;
}

export interface ConsentRequirements {
  sms: {
    cold: ConsentType;
    inbound: ConsentType;
  };
  voice: {
    cold: ConsentType;
    inbound: ConsentType;
  };
  email: {
    cold: ConsentType;
    inbound: ConsentType;
  };
}

export interface RegionalRules {
  state: string;
  timezone: string;
  quietHours: {
    sms: QuietHoursRange | null;
    voice: QuietHoursRange | null;
    rvm: QuietHoursRange | null;
    email: null; // Email has no quiet hours federally
  };
  disclosures: Disclosures;
  consentRequirements: ConsentRequirements;
  frequencyLimits: {
    sms: FrequencyLimits;
    voice: FrequencyLimits;
    email: FrequencyLimits;
  };
  penalties: Record<string, string>;
  additionalNotes: string[];
  stateSpecific?: Record<string, any>;
}

export interface RegionInfo {
  state: string;
  timezone: string;
  areaCode?: string;
}

export interface Recipient {
  phone?: string | null;
  email?: string | null;
  address?: {
    street?: string;
    city?: string;
    state: string;
    zip?: string;
  } | null;
}

export interface DisclosureContext {
  businessName: string;
  physicalAddress?: string;
  unsubscribeUrl?: string;
  ccpaUrl?: string;
  doNotSellUrl?: string;
  privacyUrl?: string;
  isFirstMessage?: boolean;
  isRealEstate?: boolean;
  isDistressedProperty?: boolean;
  isHurricaneZone?: boolean;
  isExecutoryContract?: boolean;
}

export interface DncCheckResult {
  onDnc: boolean;
  source?: 'federal' | 'state' | 'internal';
  jurisdiction?: string | null;
  reason?: string;
}

export interface ValidationResult {
  allowed: boolean;
  modifiedMessage?: string;
  reason?: string;
  violations?: string[];
  warnings?: string[];
  disclosuresAdded?: string[];
  nextAllowedTime?: Date;
}

export interface MessageGateResult {
  allowed: boolean;
  message?: string;
  reason?: string;
  blocked?: boolean;
  modified?: boolean;
  retryAt?: Date;
}
