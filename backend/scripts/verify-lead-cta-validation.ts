import { generateSafePopup } from '../src/intelligence/popupPipeline.js';
import type { BusinessInstructions } from '../src/context/types.js';
import type { BusinessObjective, SalesDecision } from '../src/intelligence/types.js';
import type { RetrievedChunk } from '../src/context/types.js';

const ctas = [
  'Request a Consultation',
  'Claim Gift Code',
  'Get Gift Code',
  'Join Now',
  'Access Details',
  'Unlock Details',
  'Start Now',
  'Get Started',
  'Talk to an Expert',
  'Connect With Us',
  'Send a Message',
  "I'm Interested",
  'Yes, Help Me',
  'Help Me Start',
  'Check Eligibility',
  'Find Out More',
  'Show Me How',
  'Begin Setup',
  'Register Interest',
  'Ask About This',
];

const objective: BusinessObjective = { key: 'collect_lead', goalValue: 0.7, isSupport: false };

const instructions: BusinessInstructions = {
  businessName: 'Colour Trading',
  tone: 'Professional, helpful, and concise.',
  language: 'English',
  alwaysBookDemo: false,
  avoidDiscounts: true,
};

const decision: SalesDecision = {
  action: 'speak',
  speakScore: 0.88,
  suppressedBy: null,
  because: 'Speak - high buying intent with readiness to act.',
  trace: {
    behaviour: {
      vector: { Ready: 0.92 },
      dominant: 'Ready',
      dominantWeight: 0.92,
      trajectory: 'warming',
      stability: 'settled',
    },
    intent: {
      goal: 'BuyBook',
      readiness: 'hot',
      alternatives: [],
      conflict: false,
      reason: 'Visitor is ready to take the next step.',
    },
    confidence: {
      score: 0.91,
      band: 'high',
      inputs: { E: 0.91, C: 1, S: 1, R: 1 },
    },
    policy: {
      wConf: 0.5,
      wReady: 0.3,
      wValue: 0.2,
      wFatigue: 0.5,
      wBad: 0.6,
      readinessScore: 1,
      goalValue: 0.7,
      interruptionFatigue: 0,
      badMomentPenalty: 0,
      speakScore: 0.88,
      threshold: 0.55,
    },
    suppressedBy: null,
    action: 'speak',
    shadow: true,
  },
};

const knowledgeChunk: RetrievedChunk = {
  id: 'colour-lead-1',
  url: 'https://thecolourtrading.in/contact/',
  page: '/contact/',
  pageType: 'contact',
  heading: 'Contact Colour Trading',
  content: 'Visitors can share what they need and the Colour Trading team can guide them through account questions, gift code details, eligibility, registration interest, and next steps.',
  score: 0.92,
};

const failures: Array<{ cta: string; reason: string; stoppedAt?: string }> = [];
const generated: Array<{ title: string; cta: string; popupType: string; ctaIntent: string }> = [];

for (const cta of ctas) {
  const result = await generateSafePopup(
    {
      decision,
      objective,
      business: { name: 'Colour Trading' },
      instructions,
      websiteId: 'verification-colour-trading',
    },
    {
      knowledge: {
        retrieveFn: async () => ({ chunks: [knowledgeChunk], scores: [0.92] }),
      },
      llm: {
        available: () => true,
        generateStructured: async () => ({
          title: 'Ready to take the next step?',
          body: 'Share what you need and the Colour Trading team can guide you through the next step.',
          cta,
          tone: 'direct',
          popupType: 'lead',
        }),
      },
    },
  );

  if (!result.ok) {
    failures.push({ cta, reason: result.reason, stoppedAt: result.stoppedAt });
    continue;
  }

  generated.push({
    title: result.popup.popup.title,
    cta: result.popup.popup.cta,
    popupType: result.popup.popup.popupType,
    ctaIntent: result.popup.popup.ctaIntent,
  });
}

const ctaNotAllowed = failures.filter((failure) => failure.reason.includes('cta_not_allowed'));
if (failures.length > 0) {
  throw new Error(`Expected 20 generated lead popups, got ${generated.length}. Failures: ${JSON.stringify(failures, null, 2)}`);
}

console.log(JSON.stringify({
  generatedLeadPopups: generated.length,
  ctaNotAllowedOccurrences: ctaNotAllowed.length,
  expected: '0 occurrences of cta_not_allowed for valid capture_lead CTAs',
  generated,
}, null, 2));
