export const DISCOVERED_ACTION_INTENTS = [
  'book_demo',
  'pricing',
  'contact',
  'support',
  'free_trial',
  'login',
  'signup',
  'documentation',
  'enterprise',
  'careers',
  'partners',
  'integrations',
  'case_studies',
] as const;

export type DiscoveredActionIntent = (typeof DISCOVERED_ACTION_INTENTS)[number];
export type ActionDetectionMethod = 'rule' | 'llm' | 'hybrid';

export interface DiscoveredActionCandidate {
  intent: DiscoveredActionIntent;
  label: string;
  url: string;
  pageUrl: string;
  pagePath: string;
  pageTitle: string;
  pageDescription: string;
  domLocation: string;
  anchorText: string;
  surroundingHeading: string;
  confidence: number;
  detectionMethod: ActionDetectionMethod;
  rule: string | null;
  why: string;
  rankSignals: {
    heroCta: boolean;
    navigation: boolean;
    footer: boolean;
    form: boolean;
    pricingSection: boolean;
    contactSection: boolean;
    card: boolean;
    button: boolean;
    homepage: boolean;
    internalLinkFrequency: number;
    occurrenceCount?: number;
    prominence: number;
  };
}

export interface DiscoveredActionGraphNode {
  intent: DiscoveredActionIntent;
  preferred: DiscoveredActionCandidate;
  candidates: DiscoveredActionCandidate[];
  rawCandidates?: DiscoveredActionCandidate[];
}

export interface DiscoveredActionGraph {
  generatedAt: string;
  source: 'crawl';
  nodes: DiscoveredActionGraphNode[];
}


