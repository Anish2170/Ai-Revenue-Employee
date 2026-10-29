export const BUSINESS_ACTION_DESTINATION_TYPES = ['URL', 'CHAT', 'WHATSAPP', 'PHONE', 'EMAIL'] as const;
export type BusinessActionDestinationType = (typeof BUSINESS_ACTION_DESTINATION_TYPES)[number];

export interface BusinessActionConfig {
  actionId: string;
  label: string;
  destinationType: BusinessActionDestinationType;
  destination: string;
  enabled: boolean;
  /** Server-produced provenance, never accepted from a public widget/model. */
  authority?: { source: 'owner' | 'discovered'; websiteId: string; actionId: string; label: string; destinationType: BusinessActionDestinationType; destination: string; confidence?: number };
}

export interface BusinessActionWithStats extends BusinessActionConfig {
  id: string;
  isStarter: boolean;
  sortOrder: number;
  usageCount: number;
  ctr: number;
  lastUsed: Date | null;
}