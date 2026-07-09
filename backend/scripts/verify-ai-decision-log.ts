import { prisma } from '../src/db/prisma.js';
import { generateToken, hashToken } from '../src/auth/password.js';

const API = 'http://localhost:8787';
const marker = `decision_log_${Date.now()}`;
const siteNames = ['Creovix', 'Colour Trading'];

type Site = Awaited<ReturnType<typeof loadSites>>[number];

function event(type: string, zone: string, ts: number, intensity = 0.8) {
  return { type, zone, ts, intensity, surface: 'desktop' };
}

async function loadSites() {
  const sites = await prisma.website.findMany({
    where: { name: { in: siteNames }, deletedAt: null },
    include: { widget: true, organization: true },
    orderBy: { name: 'asc' },
  });
  if (sites.length !== 2 || sites.some((site) => !site.widget)) {
    throw new Error(`Expected Creovix and Colour Trading with widgets; found ${sites.length}`);
  }
  const organizationId = sites[0].organizationId;
  if (sites.some((site) => site.organizationId !== organizationId)) {
    throw new Error('Verification sites must belong to the same organization');
  }
  return sites;
}

async function postEvents(site: Site, slug: string, sessionKind: string, events: unknown[]) {
  const sessionId = `${marker}_${slug}_${sessionKind}_session`;
  const visitorId = `${marker}_${slug}_${sessionKind}_visitor`;
  const payload = {
    siteId: site.widget!.siteId,
    visitorId,
    sessionId,
    returning: false,
    surface: 'desktop',
    pageUrl: `https://verify.local/${slug}/${sessionKind}`,
    pagePath: `/verify/${marker}/${slug}/${sessionKind}`,
    pageTitle: `${site.name} ${sessionKind} decision verification`,
    referrer: 'https://verify.local/referrer',
    device: 'desktop',
    browser: 'VerificationBrowser',
    events,
  };

  const response = await fetch(`${API}/events?sprint42=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  if (!response.ok || body.status !== 'ack') {
    throw new Error(`/events failed for ${sessionId}: ${response.status} ${JSON.stringify(body)}`);
  }
  return { sessionId, visitorId, body };
}

async function postWidgetOutcomes(site: Site, sessionId: string, visitorId: string, popupType: string) {
  const occurredAt = new Date().toISOString();
  const response = await fetch(`${API}/analytics/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      siteId: site.widget!.siteId,
      visitorId,
      sessionId,
      returning: false,
      pageUrl: `https://verify.local/outcome/${sessionId}`,
      pagePath: `/verify/${marker}/outcome`,
      pageTitle: 'Decision log outcome verification',
      device: 'desktop',
      browser: 'VerificationBrowser',
      surface: 'desktop',
      events: [
        { category: 'POPUP', eventName: 'popup_displayed', occurredAt, popupType },
        { category: 'POPUP', eventName: 'popup_clicked', occurredAt, popupType },
        { category: 'POPUP', eventName: 'popup_dismissed', occurredAt, popupType },
        { category: 'CHAT', eventName: 'chat_opened', occurredAt },
      ],
    }),
  });
  const body = await response.json();
  if (!response.ok || body.status !== 'ack') {
    throw new Error(`/analytics/events outcomes failed: ${response.status} ${JSON.stringify(body)}`);
  }
}

async function waitForLog(sessionId: string, predicate: (log: NonNullable<Awaited<ReturnType<typeof findLatestLog>>>) => boolean) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const log = await findLatestLog(sessionId);
    if (log && predicate(log)) return log;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  const log = await findLatestLog(sessionId);
  throw new Error(`Timed out waiting for decision log ${sessionId}. Last row: ${JSON.stringify(log, null, 2)}`);
}

function findLatestLog(sessionId: string) {
  return prisma.aiDecisionLog.findFirst({
    where: { sessionId },
    orderBy: { occurredAt: 'desc' },
  });
}

async function apiGet(path: string, token: string) {
  const response = await fetch(`${API}${path}`, { headers: { Cookie: `aire_session=${token}` } });
  const body = await response.json();
  if (!response.ok) throw new Error(`API ${path} failed: ${response.status} ${JSON.stringify(body)}`);
  return body;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const sites = await loadSites();
const creovix = sites.find((site) => site.name === 'Creovix')!;
const colour = sites.find((site) => site.name === 'Colour Trading')!;
const organizationId = creovix.organizationId;

const suppressed = await postEvents(creovix, 'creovix', 'suppressed', [
  event('content_dwell', 'other', 3_000, 0.2),
  event('content_dwell', 'other', 8_000, 0.2),
  event('content_dwell', 'other', 13_000, 0.2),
]);

const colourSuppressed = await postEvents(colour, 'colour', 'suppressed', [
  event('idle', 'other', 4_000, 1),
  event('content_dwell', 'other', 8_000, 0.2),
]);

const generated = await postEvents(creovix, 'creovix', 'generated', [
  event('content_dwell', 'pricing', 10_000, 0.9),
  event('pricing_focus', 'pricing', 18_000, 0.9),
  event('zone_revisit', 'pricing', 28_000, 0.9),
  event('pricing_focus', 'pricing', 36_000, 0.9),
]);

const suppressedLog = await waitForLog(suppressed.sessionId, (log) => log.decision === 'Suppressed');
assert(suppressedLog.websiteId === creovix.id, 'Suppressed Creovix log stored under the wrong website');
assert(suppressedLog.popupSuppressed, 'Suppressed log did not set popupSuppressed');
assert(!suppressedLog.popupGenerated, 'Suppressed log incorrectly set popupGenerated');
assert(Boolean(suppressedLog.suppressionReason || suppressedLog.reason), 'Suppressed log is missing the exact reason');
assert(Boolean(suppressedLog.behaviorSummary), 'Suppressed log is missing behavior summary');
assert(Boolean(suppressedLog.intentSummary), 'Suppressed log is missing intent summary');
assert(suppressedLog.confidenceScore !== null, 'Suppressed log is missing confidence score');

const colourLog = await waitForLog(colourSuppressed.sessionId, (log) => log.decision === 'Suppressed');
assert(colourLog.websiteId === colour.id, 'Colour Trading log stored under the wrong website');

const generatedLog = await waitForLog(generated.sessionId, (log) => log.decision === 'Popup Generated' || log.decision === 'Suppressed');
if (generatedLog.decision !== 'Popup Generated') {
  throw new Error(`Expected popup generation, but pipeline suppressed it: ${generatedLog.suppressionReason ?? generatedLog.reason ?? 'unknown reason'}`);
}

assert(generated.body.popup, 'Generated /events response did not deliver a popup artifact to the widget');
assert(generatedLog.websiteId === creovix.id, 'Generated Creovix log stored under the wrong website');
assert(generatedLog.popupGenerated, 'Generated log did not set popupGenerated');
assert(!generatedLog.popupSuppressed, 'Generated log incorrectly set popupSuppressed');
assert(Boolean(generatedLog.generatedPopupType), 'Generated log is missing popup type');
assert(Boolean(generatedLog.generatedPopupTitle), 'Generated log is missing popup title');
assert(Boolean(generatedLog.ctaText), 'Generated log is missing CTA text');
assert(generatedLog.llmUsed, 'Generated log did not record LLM usage');
assert(generatedLog.validationPassed, 'Generated log did not record validation pass');

await postWidgetOutcomes(creovix, generated.sessionId, generated.visitorId, generatedLog.generatedPopupType!);
const outcomeLog = await waitForLog(
  generated.sessionId,
  (log) => log.popupDisplayed && log.popupClicked && log.popupDismissed && log.chatOpened,
);

const user = await prisma.user.findFirst({ where: { memberships: { some: { organizationId } } }, select: { id: true } });
assert(user, 'No user found for verification organization');
const token = generateToken();
await prisma.session.create({
  data: {
    userId: user.id,
    organizationId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  },
});

try {
  const [creovixDecisionApi, colourDecisionApi] = await Promise.all([
    apiGet(`/api/analytics/decision-log?websiteId=${creovix.id}&search=${marker}&limit=100`, token),
    apiGet(`/api/analytics/decision-log?websiteId=${colour.id}&search=${marker}&limit=100`, token),
  ]);

  const creovixLogs = creovixDecisionApi.logs as Array<{ websiteId: string; sessionId: string; decision: string }>;
  const colourLogs = colourDecisionApi.logs as Array<{ websiteId: string; sessionId: string; decision: string }>;
  assert(creovixLogs.some((log) => log.sessionId === suppressed.sessionId), 'Dashboard API did not return Creovix suppressed log');
  assert(creovixLogs.some((log) => log.sessionId === generated.sessionId), 'Dashboard API did not return Creovix generated log');
  assert(colourLogs.some((log) => log.sessionId === colourSuppressed.sessionId), 'Dashboard API did not return Colour Trading log');
  assert(creovixLogs.every((log) => log.websiteId === creovix.id), 'Creovix dashboard API leaked another website decision');
  assert(colourLogs.every((log) => log.websiteId === colour.id), 'Colour Trading dashboard API leaked another website decision');

  console.log(JSON.stringify({
    marker,
    websites: {
      creovix: { websiteId: creovix.id, siteId: creovix.widget!.siteId },
      colourTrading: { websiteId: colour.id, siteId: colour.widget!.siteId },
    },
    sessions: {
      suppressed: {
        sessionId: suppressed.sessionId,
        decision: suppressedLog.decision,
        behavior: suppressedLog.behaviorSummary,
        intent: suppressedLog.intentSummary,
        confidenceScore: suppressedLog.confidenceScore,
        reason: suppressedLog.suppressionReason ?? suppressedLog.reason,
      },
      generated: {
        sessionId: generated.sessionId,
        decision: generatedLog.decision,
        strategy: generatedLog.salesStrategy,
        popupType: generatedLog.generatedPopupType,
        cta: generatedLog.ctaText,
        llmUsed: generatedLog.llmUsed,
        validationPassed: generatedLog.validationPassed,
        outcome: {
          displayed: outcomeLog.popupDisplayed,
          clicked: outcomeLog.popupClicked,
          dismissed: outcomeLog.popupDismissed,
          chatOpened: outcomeLog.chatOpened,
          finalOutcome: outcomeLog.finalOutcome,
        },
      },
      tenantIsolation: {
        colourSessionId: colourSuppressed.sessionId,
        colourWebsiteId: colourLog.websiteId,
        creovixApiRows: creovixLogs.length,
        colourTradingApiRows: colourLogs.length,
        noCrossWebsiteLeak: true,
      },
    },
  }, null, 2));
} finally {
  await prisma.session.updateMany({ where: { tokenHash: hashToken(token) }, data: { revokedAt: new Date() } });
  await prisma.$disconnect();
}
