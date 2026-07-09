import { prisma } from '../src/db/prisma.js';
import { generateToken, hashToken } from '../src/auth/password.js';

const API = 'http://localhost:8787';
const names = ['Creovix', 'Colour Trading'];
const marker = `tenant_iso_${Date.now()}`;

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function daysAgoStart(days: number): Date {
  const start = startOfToday();
  start.setDate(start.getDate() - Math.max(0, days - 1));
  return start;
}

function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function postAnalytics(site: { siteId: string; slug: string; device: string; popupType: string; pagePath: string; pageTitle: string }) {
  const visitorId = `${marker}_${site.slug}_visitor`;
  const sessionId = `${marker}_${site.slug}_session`;
  const occurredAt = new Date().toISOString();
  const payload = {
    siteId: site.siteId,
    visitorId,
    sessionId,
    returning: false,
    pageUrl: `https://verify.local${site.pagePath}`,
    pagePath: site.pagePath,
    pageTitle: site.pageTitle,
    referrer: 'https://verify.local/referrer',
    device: site.device,
    browser: 'VerificationBrowser',
    surface: 'desktop',
    events: [
      { category: 'VISITOR', eventName: 'visitor_started', occurredAt },
      { category: 'VISITOR', eventName: 'session_started', occurredAt },
      { category: 'PAGE', eventName: 'page_viewed', occurredAt },
      { category: 'POPUP', eventName: 'popup_displayed', occurredAt, popupType: site.popupType },
      { category: 'POPUP', eventName: 'popup_clicked', occurredAt, popupType: site.popupType },
      { category: 'CHAT', eventName: 'chat_opened', occurredAt },
      { category: 'CHAT', eventName: 'message_sent', occurredAt, numericValue: site.slug === 'creovix' ? 11 : 22 },
      { category: 'CHAT', eventName: 'ai_response_completed', occurredAt, numericValue: site.slug === 'creovix' ? 33 : 44 },
      { category: 'VISITOR', eventName: 'session_ended', occurredAt, durationMs: site.slug === 'creovix' ? 12000 : 22000 },
    ],
  };

  const response = await fetch(`${API}/analytics/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  if (!response.ok || body.status !== 'ack') {
    throw new Error(`analytics ingest failed for ${site.slug}: ${response.status} ${JSON.stringify(body)}`);
  }
  return { visitorId, sessionId, accepted: body.accepted };
}

async function waitForEvents(visitorIds: string[], expectedCount: number) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const count = await prisma.analyticsEvent.count({ where: { visitorId: { in: visitorIds } } });
    if (count >= expectedCount) return count;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return prisma.analyticsEvent.count({ where: { visitorId: { in: visitorIds } } });
}

async function apiGet(path: string, token: string) {
  const response = await fetch(`${API}${path}`, { headers: { Cookie: `aire_session=${token}` } });
  const body = await response.json();
  if (!response.ok) throw new Error(`API ${path} failed: ${response.status} ${JSON.stringify(body)}`);
  return body;
}

async function expectedSummary(organizationId: string, websiteId: string) {
  const today = startOfToday();
  const base = { organizationId, websiteId, occurredAt: { gte: today } };
  const [visitors, conversations, popupDisplayed, popupClicked, chatOpened, messages, aiResponses, endedSessions, topEvents, popupRows, devices] = await Promise.all([
    prisma.analyticsEvent.findMany({ where: { ...base, visitorId: { not: null }, eventName: { in: ['visitor_started', 'session_started', 'page_viewed'] } }, distinct: ['visitorId'], select: { visitorId: true } }),
    prisma.analyticsEvent.findMany({ where: { ...base, sessionId: { not: null }, eventName: { in: ['chat_opened', 'message_sent'] } }, distinct: ['sessionId'], select: { sessionId: true } }),
    prisma.analyticsEvent.count({ where: { ...base, eventName: 'popup_displayed' } }),
    prisma.analyticsEvent.count({ where: { ...base, eventName: 'popup_clicked' } }),
    prisma.analyticsEvent.count({ where: { ...base, eventName: 'chat_opened' } }),
    prisma.analyticsEvent.count({ where: { ...base, eventName: 'message_sent' } }),
    prisma.analyticsEvent.count({ where: { ...base, eventName: 'ai_response_completed' } }),
    prisma.analyticsSession.findMany({ where: { organizationId, websiteId, startedAt: { gte: today }, endedAt: { not: null } }, select: { engaged: true } }),
    prisma.analyticsEvent.findMany({ where: { ...base, eventName: { in: ['chat_opened', 'message_sent'] }, pagePath: { not: null } }, select: { pagePath: true, pageTitle: true, sessionId: true }, take: 1000 }),
    prisma.analyticsEvent.findMany({ where: { ...base, eventName: { in: ['popup_displayed', 'popup_clicked'] }, popupType: { not: null } }, select: { popupType: true, eventName: true }, take: 1000 }),
    prisma.analyticsSession.groupBy({ by: ['device'], where: { organizationId, websiteId, startedAt: { gte: today } }, _count: { _all: true } }),
  ]);

  const byPage = new Map<string, { pagePath: string; pageTitle: string | null; sessions: Set<string>; events: number }>();
  for (const row of topEvents) {
    if (!row.pagePath) continue;
    const existing = byPage.get(row.pagePath) ?? { pagePath: row.pagePath, pageTitle: row.pageTitle, sessions: new Set<string>(), events: 0 };
    if (row.sessionId) existing.sessions.add(row.sessionId);
    existing.events += 1;
    byPage.set(row.pagePath, existing);
  }

  const byPopup = new Map<string, { popupType: string; displayed: number; clicked: number }>();
  for (const row of popupRows) {
    if (!row.popupType) continue;
    const existing = byPopup.get(row.popupType) ?? { popupType: row.popupType, displayed: 0, clicked: 0 };
    if (row.eventName === 'popup_displayed') existing.displayed += 1;
    if (row.eventName === 'popup_clicked') existing.clicked += 1;
    byPopup.set(row.popupType, existing);
  }

  return {
    today: {
      visitors: visitors.length,
      conversations: conversations.length,
      popupCtr: popupDisplayed === 0 ? 0 : popupClicked / popupDisplayed,
      popupDisplayed,
      popupClicked,
      chatOpens: chatOpened,
      messages,
      aiResponses,
      conversationsEndedWithoutEngagement: endedSessions.filter((session) => !session.engaged).length,
    },
    topPages: Array.from(byPage.values()).map((row) => ({ pagePath: row.pagePath, pageTitle: row.pageTitle, conversations: row.sessions.size, events: row.events })).sort((a, b) => b.conversations - a.conversations || b.events - a.events).slice(0, 8),
    topPopupTypes: Array.from(byPopup.values()).map((row) => ({ ...row, ctr: row.displayed === 0 ? 0 : row.clicked / row.displayed })).sort((a, b) => b.ctr - a.ctr || b.clicked - a.clicked).slice(0, 8),
    deviceBreakdown: devices.map((row) => ({ device: row.device ?? 'Unknown', sessions: row._count._all })).sort((a, b) => b.sessions - a.sessions),
  };
}

async function expectedChart(organizationId: string, websiteId: string, metric: string, days = 14) {
  const from = daysAgoStart(days);
  const eventNames = metric === 'daily_visitors' ? ['visitor_started'] : metric === 'daily_chats' ? ['chat_opened'] : metric === 'popup_ctr' ? ['popup_displayed', 'popup_clicked'] : ['chat_opened', 'message_sent'];
  const events = await prisma.analyticsEvent.findMany({
    where: { organizationId, websiteId, occurredAt: { gte: from }, eventName: { in: eventNames } },
    select: { occurredAt: true, eventName: true, visitorId: true, sessionId: true },
    take: 5000,
  });
  const daysList = Array.from({ length: days }, (_, i) => {
    const d = new Date(from);
    d.setDate(from.getDate() + i);
    return dayKey(d);
  });
  const buckets = new Map(daysList.map((key) => [key, { visitors: new Set<string>(), chats: new Set<string>(), conversations: new Set<string>(), displayed: 0, clicked: 0, messages: 0 }]));
  for (const event of events) {
    const bucket = buckets.get(dayKey(event.occurredAt));
    if (!bucket) continue;
    if (event.eventName === 'visitor_started' && event.visitorId) bucket.visitors.add(event.visitorId);
    if (event.eventName === 'chat_opened' && event.sessionId) bucket.chats.add(event.sessionId);
    if ((event.eventName === 'chat_opened' || event.eventName === 'message_sent') && event.sessionId) bucket.conversations.add(event.sessionId);
    if (event.eventName === 'popup_displayed') bucket.displayed += 1;
    if (event.eventName === 'popup_clicked') bucket.clicked += 1;
    if (event.eventName === 'message_sent') bucket.messages += 1;
  }
  return daysList.map((date) => {
    const bucket = buckets.get(date)!;
    const value = metric === 'daily_visitors' ? bucket.visitors.size : metric === 'daily_chats' ? bucket.chats.size : metric === 'popup_ctr' ? (bucket.displayed === 0 ? 0 : bucket.clicked / bucket.displayed) : bucket.conversations.size;
    return { date, value, displayed: bucket.displayed, clicked: bucket.clicked, messages: bucket.messages };
  });
}

function assertJsonEqual(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label} mismatch\nactual=${a}\nexpected=${e}`);
}

const sites = await prisma.website.findMany({
  where: { name: { in: names }, deletedAt: null },
  include: { widget: true, organization: true },
  orderBy: { name: 'asc' },
});
if (sites.length !== 2 || sites.some((site) => !site.widget)) throw new Error(`Expected both websites with active widgets; found ${sites.length}`);
const organizationId = sites[0].organizationId;
if (sites.some((site) => site.organizationId !== organizationId)) throw new Error('Verification sites are not in the same organization');

const creovix = sites.find((site) => site.name === 'Creovix')!;
const colour = sites.find((site) => site.name === 'Colour Trading')!;
const creovixPath = `/verify/${marker}/creovix`;
const colourPath = `/verify/${marker}/colour-trading`;
const creovixPopup = `${marker}_creovix_popup`;
const colourPopup = `${marker}_colour_popup`;

const posted = await Promise.all([
  postAnalytics({ siteId: creovix.widget!.siteId, slug: 'creovix', device: 'desktop', popupType: creovixPopup, pagePath: creovixPath, pageTitle: 'Creovix Verification Page' }),
  postAnalytics({ siteId: colour.widget!.siteId, slug: 'colour', device: 'mobile', popupType: colourPopup, pagePath: colourPath, pageTitle: 'Colour Trading Verification Page' }),
]);

const persisted = await waitForEvents(posted.map((entry) => entry.visitorId), 18);
if (persisted < 18) throw new Error(`Expected 18 verification events, found ${persisted}`);

const verificationRows = await prisma.analyticsEvent.findMany({
  where: { visitorId: { in: posted.map((entry) => entry.visitorId) } },
  select: { websiteId: true, eventName: true, visitorId: true, sessionId: true, pagePath: true, popupType: true },
  orderBy: [{ visitorId: 'asc' }, { eventName: 'asc' }],
});
const mismatches = verificationRows.filter((row) => {
  if (row.visitorId?.includes('_creovix_')) return row.websiteId !== creovix.id;
  if (row.visitorId?.includes('_colour_')) return row.websiteId !== colour.id;
  return true;
});
if (mismatches.length) throw new Error(`Stored websiteId mismatch: ${JSON.stringify(mismatches, null, 2)}`);

const user = await prisma.user.findFirst({ where: { memberships: { some: { organizationId } } }, select: { id: true } });
if (!user) throw new Error('No user found for verification organization');
const token = generateToken();
await prisma.session.create({ data: { userId: user.id, organizationId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 10 * 60 * 1000) } });

try {
  const [creovixSummary, colourSummary] = await Promise.all([
    apiGet(`/api/analytics/summary?websiteId=${creovix.id}`, token),
    apiGet(`/api/analytics/summary?websiteId=${colour.id}`, token),
  ]);
  const [creovixExpected, colourExpected] = await Promise.all([
    expectedSummary(organizationId, creovix.id),
    expectedSummary(organizationId, colour.id),
  ]);

  assertJsonEqual('Creovix today metrics', creovixSummary.today, creovixExpected.today);
  assertJsonEqual('Colour Trading today metrics', colourSummary.today, colourExpected.today);
  assertJsonEqual('Creovix top pages', creovixSummary.topPages, creovixExpected.topPages);
  assertJsonEqual('Colour Trading top pages', colourSummary.topPages, colourExpected.topPages);
  assertJsonEqual('Creovix popup types', creovixSummary.topPopupTypes, creovixExpected.topPopupTypes);
  assertJsonEqual('Colour Trading popup types', colourSummary.topPopupTypes, colourExpected.topPopupTypes);
  assertJsonEqual('Creovix device breakdown', creovixSummary.deviceBreakdown, creovixExpected.deviceBreakdown);
  assertJsonEqual('Colour Trading device breakdown', colourSummary.deviceBreakdown, colourExpected.deviceBreakdown);

  const metrics = ['daily_visitors', 'daily_chats', 'popup_ctr', 'conversation_trend'];
  const chartChecks: Record<string, boolean> = {};
  for (const metric of metrics) {
    const [actualCreovix, actualColour, expectedCreovix, expectedColour] = await Promise.all([
      apiGet(`/api/analytics/charts?metric=${metric}&days=14&websiteId=${creovix.id}`, token),
      apiGet(`/api/analytics/charts?metric=${metric}&days=14&websiteId=${colour.id}`, token),
      expectedChart(organizationId, creovix.id, metric),
      expectedChart(organizationId, colour.id, metric),
    ]);
    assertJsonEqual(`Creovix chart ${metric}`, actualCreovix.data, expectedCreovix);
    assertJsonEqual(`Colour Trading chart ${metric}`, actualColour.data, expectedColour);
    chartChecks[metric] = true;
  }

  const leakChecks = {
    creovixDoesNotContainColourPage: !creovixSummary.topPages.some((page: { pagePath: string }) => page.pagePath === colourPath),
    colourDoesNotContainCreovixPage: !colourSummary.topPages.some((page: { pagePath: string }) => page.pagePath === creovixPath),
    creovixDoesNotContainColourPopup: !creovixSummary.topPopupTypes.some((popup: { popupType: string }) => popup.popupType === colourPopup),
    colourDoesNotContainCreovixPopup: !colourSummary.topPopupTypes.some((popup: { popupType: string }) => popup.popupType === creovixPopup),
  };
  if (Object.values(leakChecks).some((ok) => !ok)) throw new Error(`Leak check failed: ${JSON.stringify(leakChecks)}`);

  console.log(JSON.stringify({
    marker,
    websites: {
      creovix: { websiteId: creovix.id, siteId: creovix.widget!.siteId, path: creovixPath, popupType: creovixPopup },
      colourTrading: { websiteId: colour.id, siteId: colour.widget!.siteId, path: colourPath, popupType: colourPopup },
    },
    ingest: posted,
    storedEvents: {
      totalVerificationEvents: verificationRows.length,
      websiteIdMismatches: mismatches.length,
      creovixRows: verificationRows.filter((row) => row.websiteId === creovix.id).length,
      colourTradingRows: verificationRows.filter((row) => row.websiteId === colour.id).length,
    },
    apiChecks: {
      summaryTodayMatchesWebsiteScopedDb: true,
      topPagesMatchWebsiteScopedDb: true,
      topPopupTypesMatchWebsiteScopedDb: true,
      deviceBreakdownMatchesWebsiteScopedDb: true,
      chartsMatchWebsiteScopedDb: chartChecks,
      noMarkerLeakAcrossWebsites: leakChecks,
    },
    scopedToday: {
      creovix: creovixSummary.today,
      colourTrading: colourSummary.today,
    },
  }, null, 2));
} finally {
  await prisma.session.updateMany({ where: { tokenHash: hashToken(token) }, data: { revokedAt: new Date() } });
  await prisma.$disconnect();
}
