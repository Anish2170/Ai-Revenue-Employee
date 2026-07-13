import * as cheerio from 'cheerio';
import { generateDecision, llmAvailable } from '../llm/index.js';
import type { CrawledPage } from '../context/types.js';
import type { DiscoveredActionCandidate, DiscoveredActionGraph, DiscoveredActionIntent } from './discovered-action.types.js';
import { DISCOVERED_ACTION_INTENTS } from './discovered-action.types.js';

export interface RawDiscoveredAction {
  label: string;
  url: string;
  pageUrl: string;
  pagePath: string;
  pageTitle: string;
  pageDescription: string;
  domLocation: string;
  anchorText: string;
  surroundingHeading: string;
  context: string;
  rankSignals: DiscoveredActionCandidate['rankSignals'];
}

const MIN_RULE_CONFIDENCE_FOR_LLM = 0.82;
const MIN_GRAPH_CONFIDENCE = 0.5;

const UI_LABEL_PATTERN = /^(search|search input|search trigger|search button|toggle theme|theme toggle|theme|dark mode|light mode|menu|menu toggle|hamburger|previous|prev|next|back|close|expand|collapse|language|select language|accept cookies|reject cookies|cookies|cookie settings|sort|filter|share|share button|social|print|download|table of contents|skip to content)$/i;
const UI_TEXT_PATTERN = /\b(search|searchbox|cookie|cookies|consent|pagination|breadcrumb|table of contents|social|share|theme|dark mode|light mode|language switcher|locale|menu toggle|hamburger|newsletter close|sort|filter)\b/i;
const UI_CONTROL_PATTERN = /\b(search|theme|dark|light|cookie|consent|pagination|breadcrumb|share|social|language|locale|sort|filter)\b/i;
const SOCIAL_HOST_PATTERN = /(^|\.)(facebook|twitter|x|linkedin|instagram|youtube|tiktok|pinterest)\.com$/i;
const BUSINESS_PATH_PATTERN = /\b(demo|sales|pricing|plans?|contact|support|help|trial|signup|sign-up|login|sign-in|docs?|documentation|api|enterprise|careers?|jobs|partners?|integrations?|case-stud(?:y|ies)|customers?)\b/i;

const INTENT_RULES: Array<{ intent: DiscoveredActionIntent; rule: string; patterns: RegExp[]; base: number }> = [
  { intent: 'book_demo', rule: 'demo_or_sales_consultation', base: 0.9, patterns: [/\b(book|schedule|request)\s+(a\s+)?(demo|call|consultation)\b/i, /\b(talk|speak)\s+(to|with)\s+(sales|an advisor|advisor|an expert|expert|specialist)\b/i, /\bcontact\s+sales\b/i, /\bmeet\s+(an\s+)?expert\b/i] },
  { intent: 'pricing', rule: 'pricing_or_plans', base: 0.9, patterns: [/\b(pricing|plans?|compare plans?|view plans?|see pricing)\b/i] },
  { intent: 'contact', rule: 'contact_team', base: 0.86, patterns: [/\b(contact|contact sales|get in touch|talk to us|reach us)\b/i] },
  { intent: 'support', rule: 'support_help_ticket', base: 0.88, patterns: [/\b(support|help center|customer support|submit ticket|open ticket)\b/i] },
  { intent: 'free_trial', rule: 'trial_get_started', base: 0.88, patterns: [/\b(start|try|get started).{0,16}(free|trial)\b/i, /\bstart free trial\b/i, /\btry free\b/i] },
  { intent: 'login', rule: 'auth_login', base: 0.95, patterns: [/\b(log in|login|sign in)\b/i] },
  { intent: 'signup', rule: 'auth_signup', base: 0.9, patterns: [/\b(sign up|signup|create account|register)\b/i] },
  { intent: 'documentation', rule: 'docs_guides_api', base: 0.9, patterns: [/\b(documentation|developer docs|api docs|docs|guides)\b/i] },
  { intent: 'enterprise', rule: 'enterprise', base: 0.86, patterns: [/\b(enterprise|enterprise solutions|for enterprise)\b/i] },
  { intent: 'careers', rule: 'careers', base: 0.82, patterns: [/\b(careers|jobs|open roles|join our team)\b/i] },
  { intent: 'partners', rule: 'partners', base: 0.84, patterns: [/\b(partners|partner program|become a partner)\b/i] },
  { intent: 'integrations', rule: 'integrations', base: 0.84, patterns: [/\b(integrations|apps|marketplace)\b/i] },
  { intent: 'case_studies', rule: 'case_studies', base: 0.84, patterns: [/\b(case studies|customers|success stories)\b/i] },
];

export function extractActionsFromHtml(html: string, page: CrawledPage): RawDiscoveredAction[] {
  const $ = cheerio.load(html);
  const description = $('meta[name="description"]').attr('content')?.trim() ?? '';
  const actions: RawDiscoveredAction[] = [];

  $('a[href], button, [role="button"], input[type="submit"], input[type="button"], form').each((_i, el) => {
    const node = $(el);
    const tag = String(el.tagName ?? '').toLowerCase();
    const href = tag === 'form' ? node.attr('action') : node.attr('href');
    const label = actionLabel($, node, tag);
    if (!label || label.length < 2) return;

    let url = page.url;
    if (href) {
      try {
        url = new URL(href, page.url).toString();
      } catch {
        return;
      }
    }
    if (!isActionUrl(url, page.url)) return;
    if (isIgnoredUiAction($, node, tag, label, url)) return;

    const location = domLocation($, node);
    const heading = nearestHeading($, node);
    const sectionText = normalize(node.closest('section, header, footer, nav, main, article, div, form').text()).slice(0, 500);
    const signals = rankSignals($, node, page, location, sectionText, tag);
    actions.push({
      label,
      url,
      pageUrl: page.url,
      pagePath: page.path,
      pageTitle: page.title,
      pageDescription: description,
      domLocation: location,
      anchorText: tag === 'a' ? label : '',
      surroundingHeading: heading,
      context: [heading, sectionText].filter(Boolean).join(' | '),
      rankSignals: signals,
    });
  });

  return dedupeRaw(actions);
}

export async function buildActionGraph(rawActions: RawDiscoveredAction[]): Promise<DiscoveredActionGraph> {
  const frequency = new Map<string, number>();
  for (const action of rawActions) frequency.set(action.url, (frequency.get(action.url) ?? 0) + 1);

  const candidates: DiscoveredActionCandidate[] = [];
  for (const raw of rawActions) {
    raw.rankSignals.internalLinkFrequency = frequency.get(raw.url) ?? 1;
    const classified = await classifyAction(raw);
    if (!classified || classified.confidence < MIN_GRAPH_CONFIDENCE) continue;
    candidates.push({ ...raw, ...classified, why: whySelected(raw, classified.confidence) });
  }

  const rawByIntent = new Map<DiscoveredActionIntent, DiscoveredActionCandidate[]>();
  for (const candidate of candidates) {
    const list = rawByIntent.get(candidate.intent) ?? [];
    list.push(candidate);
    rawByIntent.set(candidate.intent, list);
  }

  const groupedCandidates = collapseDuplicateCandidates(candidates);
  const byIntent = new Map<DiscoveredActionIntent, DiscoveredActionCandidate[]>();
  for (const candidate of groupedCandidates) {
    const list = byIntent.get(candidate.intent) ?? [];
    list.push(candidate);
    byIntent.set(candidate.intent, list);
  }

  return {
    generatedAt: new Date().toISOString(),
    source: 'crawl',
    nodes: Array.from(byIntent.entries()).map(([intent, list]) => {
      const ranked = [...list].sort((a, b) => rankScore(b) - rankScore(a));
      return { intent, preferred: ranked[0], candidates: ranked, rawCandidates: rawByIntent.get(intent) ?? ranked };
    }),
  };
}


function collapseDuplicateCandidates(candidates: DiscoveredActionCandidate[]): DiscoveredActionCandidate[] {
  const grouped = new Map<string, DiscoveredActionCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.intent}|${normalizeUrlForGrouping(candidate.url)}`;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { ...candidate, rankSignals: { ...candidate.rankSignals, occurrenceCount: 1 } });
      continue;
    }
    existing.rankSignals.heroCta ||= candidate.rankSignals.heroCta;
    existing.rankSignals.navigation ||= candidate.rankSignals.navigation;
    existing.rankSignals.footer ||= candidate.rankSignals.footer;
    existing.rankSignals.form ||= candidate.rankSignals.form;
    existing.rankSignals.pricingSection ||= candidate.rankSignals.pricingSection;
    existing.rankSignals.contactSection ||= candidate.rankSignals.contactSection;
    existing.rankSignals.card ||= candidate.rankSignals.card;
    existing.rankSignals.button ||= candidate.rankSignals.button;
    existing.rankSignals.homepage ||= candidate.rankSignals.homepage;
    existing.rankSignals.internalLinkFrequency += candidate.rankSignals.internalLinkFrequency;
    existing.rankSignals.occurrenceCount = (existing.rankSignals.occurrenceCount ?? 1) + 1;
    existing.confidence = Math.max(existing.confidence, candidate.confidence);
    if (rankScore(candidate) > rankScore(existing)) {
      existing.label = candidate.label;
      existing.pageUrl = candidate.pageUrl;
      existing.pagePath = candidate.pagePath;
      existing.pageTitle = candidate.pageTitle;
      existing.domLocation = candidate.domLocation;
      existing.anchorText = candidate.anchorText;
      existing.surroundingHeading = candidate.surroundingHeading;
      existing.why = candidate.why;
    }
  }
  return Array.from(grouped.values()).map((candidate) => ({
    ...candidate,
    why: `${candidate.why}; ${candidate.rankSignals.occurrenceCount ?? 1} occurrence${(candidate.rankSignals.occurrenceCount ?? 1) === 1 ? '' : 's'}`,
  }));
}

function normalizeUrlForGrouping(url: string): string {
  const parsed = new URL(url);
  parsed.hash = '';
  parsed.search = '';
  return parsed.toString().replace(/\/$/, '');
}
async function classifyAction(raw: RawDiscoveredAction): Promise<Pick<DiscoveredActionCandidate, 'intent' | 'confidence' | 'detectionMethod' | 'rule'> | null> {
  const text = `${raw.label} ${raw.url} ${raw.surroundingHeading} ${raw.pageTitle} ${raw.pageDescription}`;
  let best: Pick<DiscoveredActionCandidate, 'intent' | 'confidence' | 'detectionMethod' | 'rule'> | null = null;
  for (const rule of INTENT_RULES) {
    if (!rule.patterns.some((pattern) => pattern.test(text))) continue;
    const confidence = Math.min(0.99, rule.base + signalBoost(raw));
    if (!best || confidence > best.confidence) best = { intent: rule.intent, confidence, detectionMethod: 'rule', rule: rule.rule };
  }
  if (best && best.confidence >= MIN_RULE_CONFIDENCE_FOR_LLM) return best;
  if (!llmAvailable()) return best;

  try {
    const llm = await generateDecision({
      system: 'Classify the business intent of a discovered website action. Return only one existing intent and confidence. Never create or change URLs.',
      user: `Label: ${raw.label}\nContext: ${raw.context || raw.pageTitle}\nDestination: ${new URL(raw.url).pathname}\nAllowed intents: ${DISCOVERED_ACTION_INTENTS.join(', ')}`,
      schema: {
        type: 'object',
        properties: {
          intent: { type: 'string' },
          confidence: { type: 'number' },
        },
        required: ['intent', 'confidence'],
      },
    });
    if (!isLlmIntent(llm)) return best;
    const method = best ? 'hybrid' : 'llm';
    return { intent: llm.intent, confidence: clamp(llm.confidence), detectionMethod: method, rule: best?.rule ?? null };
  } catch {
    return best;
  }
}


function isIgnoredUiAction($: cheerio.CheerioAPI, node: cheerio.Cheerio<any>, tag: string, label: string, url: string): boolean {
  const cleanLabel = normalize(label).toLowerCase();
  const attrs = [node.attr('id'), node.attr('class'), node.attr('aria-label'), node.attr('title'), node.attr('name'), node.attr('type'), node.attr('role'), node.attr('placeholder'), node.attr('data-testid'), node.attr('data-action')]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const href = node.attr('href') ?? '';
  const context = normalize(node.closest('nav, header, footer, section, div, form').text()).toLowerCase();

  if (UI_LABEL_PATTERN.test(cleanLabel)) return true;
  if (isUiOnlyControl(tag, cleanLabel, attrs, context, url)) return true;
  if (UI_TEXT_PATTERN.test(`${attrs} ${cleanLabel}`) && !BUSINESS_PATH_PATTERN.test(`${cleanLabel} ${url}`)) return true;
  if (tag === 'button' && !BUSINESS_PATH_PATTERN.test(`${cleanLabel} ${url} ${context}`)) return true;
  if (href.startsWith('#') || new URL(url).hash) return true;
  if (node.closest('[class*="breadcrumb" i], [aria-label*="breadcrumb" i], [class*="pagination" i], [class*="cookie" i], [id*="cookie" i], [class*="consent" i], [id*="consent" i]').length) return true;
  if (isSocialUrl(url) || /\b(icon|social|share)\b/i.test(attrs) && !BUSINESS_PATH_PATTERN.test(`${cleanLabel} ${url}`)) return true;
  if (/\b(download|pdf|print)\b/i.test(`${cleanLabel} ${attrs}`) && !/\b(case stud|guide|whitepaper|report)\b/i.test(context)) return true;

  return false;
}

function isUiOnlyControl(tag: string, cleanLabel: string, attrs: string, context: string, url: string): boolean {
  const haystack = `${cleanLabel} ${attrs}`;
  if (!UI_CONTROL_PATTERN.test(haystack)) return false;

  if (/\b(search|searchbox)\b/i.test(haystack)) return true;
  if (/\b(theme|dark|light)\b/i.test(haystack)) return true;
  if (/\b(cookie|consent)\b/i.test(haystack)) return true;
  if (/\b(pagination|breadcrumb|sort|filter|language|locale|share|social)\b/i.test(`${haystack} ${context}`)) return true;
  return tag === 'button' || tag === 'input';
}
function isSocialUrl(url: string): boolean {
  try {
    return SOCIAL_HOST_PATTERN.test(new URL(url).hostname);
  } catch {
    return false;
  }
}
function actionLabel($: cheerio.CheerioAPI, node: cheerio.Cheerio<any>, tag: string): string {
  return normalize(node.attr('aria-label') ?? node.attr('title') ?? node.attr('value') ?? node.text() ?? (tag === 'form' ? 'Submit form' : ''));
}

function domLocation($: cheerio.CheerioAPI, node: cheerio.Cheerio<any>): string {
  const parts: string[] = [];
  let current = node;
  for (let i = 0; i < 4 && current.length; i += 1) {
    const el = current.get(0) as { tagName?: string } | undefined;
    const tag = String(el?.tagName ?? '').toLowerCase();
    if (!tag) break;
    const id = current.attr('id');
    const cls = (current.attr('class') ?? '').split(/\s+/).filter(Boolean).slice(0, 2).join('.');
    parts.unshift(`${tag}${id ? `#${id}` : ''}${cls ? `.${cls}` : ''}`);
    current = current.parent();
  }
  return parts.join(' > ');
}

function nearestHeading($: cheerio.CheerioAPI, node: cheerio.Cheerio<any>): string {
  const section = node.closest('section, main, article, header, footer, div, form');
  return normalize(section.find('h1,h2,h3,h4').first().text());
}

function rankSignals($: cheerio.CheerioAPI, node: cheerio.Cheerio<any>, page: CrawledPage, location: string, sectionText: string, tag: string): RawDiscoveredAction['rankSignals'] {
  const loc = location.toLowerCase();
  const text = sectionText.toLowerCase();
  const classes = `${node.attr('class') ?? ''} ${node.parent().attr('class') ?? ''}`.toLowerCase();
  return {
    heroCta: /\bhero\b/.test(loc + classes) || node.parents('section,div').first().is('[class*="hero" i], [id*="hero" i]'),
    navigation: loc.includes('nav') || loc.includes('header'),
    footer: loc.includes('footer'),
    form: tag === 'form' || loc.includes('form'),
    pricingSection: text.includes('pricing') || text.includes('plans'),
    contactSection: text.includes('contact') || text.includes('get in touch'),
    card: /\b(card|tile)\b/.test(loc + classes),
    button: tag === 'button' || node.is('[role="button"], .button, .btn, [class*="btn" i], [class*="button" i]'),
    homepage: page.path === '/' || page.pageType === 'home',
    internalLinkFrequency: 1,
    prominence: (tag === 'button' ? 2 : 0) + (/\b(primary|cta|button|btn)\b/.test(classes) ? 2 : 0),
  };
}

function rankScore(candidate: DiscoveredActionCandidate): number {
  const s = candidate.rankSignals;
  return candidate.confidence * 100
    + (s.heroCta ? 40 : 0)
    + (s.homepage ? 26 : 0)
    + (s.navigation ? 24 : 0)
    + urlSemanticScore(candidate)
    + (s.button ? 15 : 0)
    + Math.min(18, s.internalLinkFrequency * 2)
    + s.prominence * 4
    + (s.footer ? -8 : 0);
}

function urlSemanticScore(candidate: DiscoveredActionCandidate): number {
  const path = new URL(candidate.url).pathname.toLowerCase();
  const text = `${candidate.label} ${path}`.toLowerCase();
  if (candidate.intent === 'book_demo') {
    if (/\b(book|request|schedule)[-_]?(a[-_]?)?demo\b|\bdemo\b/.test(text)) return 42;
    if (/\b(talk|speak)[-_]?(to[-_]?)?sales\b|\bsales\b/.test(text)) return 30;
    if (/\bcontact\b/.test(text)) return -18;
  }
  if (candidate.intent === 'contact' && /\b(book|request|schedule)[-_]?(a[-_]?)?demo\b|\bdemo\b/.test(text)) return 30;
  return BUSINESS_PATH_PATTERN.test(text) ? 10 : 0;
}

function signalBoost(raw: RawDiscoveredAction): number {
  const s = raw.rankSignals;
  return (s.heroCta ? 0.04 : 0) + (s.navigation ? 0.03 : 0) + (s.button ? 0.02 : 0) + (s.homepage ? 0.02 : 0);
}

function whySelected(raw: RawDiscoveredAction, confidence: number): string {
  const reasons = [];
  if (raw.rankSignals.heroCta) reasons.push('hero CTA');
  if (raw.rankSignals.navigation) reasons.push('navigation link');
  if (raw.rankSignals.button) reasons.push('button prominence');
  if (raw.rankSignals.homepage) reasons.push('homepage priority');
  if (raw.rankSignals.internalLinkFrequency > 1) reasons.push(`${raw.rankSignals.internalLinkFrequency} internal links`);
  reasons.push(`classification confidence ${confidence.toFixed(2)}`);
  return reasons.join(', ');
}

function isActionUrl(url: string, pageUrl: string): boolean {
  const dest = new URL(url);
  const page = new URL(pageUrl);
  if (dest.origin !== page.origin) return false;
  if (['#', 'javascript:', 'mailto:', 'tel:'].some((prefix) => url.startsWith(prefix))) return false;
  return true;
}

function dedupeRaw(actions: RawDiscoveredAction[]): RawDiscoveredAction[] {
  const seen = new Set<string>();
  return actions.filter((action) => {
    const key = `${action.label.toLowerCase()}|${action.url}|${action.domLocation}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isLlmIntent(value: unknown): value is { intent: DiscoveredActionIntent; confidence: number } {
  if (!value || typeof value !== 'object') return false;
  const raw = value as { intent?: unknown; confidence?: unknown };
  return typeof raw.intent === 'string' && DISCOVERED_ACTION_INTENTS.includes(raw.intent as DiscoveredActionIntent) && typeof raw.confidence === 'number';
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function clamp(value: number): number {
  return Math.max(0, Math.min(0.99, value));
}










