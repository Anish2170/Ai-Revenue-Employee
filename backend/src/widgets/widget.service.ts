/**
 * Widget service — generates the public identity of a website's widget and the
 * copy-paste install snippet.
 *
 * `siteId` is the human handle in the embed tag (e.g. "site_x83kf92").
 * `widgetPublicKey` is a longer, independently-rotatable public token reserved
 * for future signed/origin-verified requests (verification NOT implemented yet).
 */
import { randomBytes } from 'node:crypto';
import { prisma } from '../db/prisma.js';
import { config } from '../config/index.js';
import { assertWebsiteOwnership } from '../websites/website.service.js';
import { UnsafeUrlError, safeFetch } from '../security/ssrf.js';
import * as cheerio from 'cheerio';

export function hasWidgetScript(html: string, pageUrl: string, siteId: string): boolean {
  const $ = cheerio.load(html);
  return $('script[src][data-site-id]').toArray().some(node => {
    if ($(node).attr('data-site-id') !== siteId) return false;
    if ($(node).closest('template,noscript').length) return false;
    try {
      const src = new URL($(node).attr('src')!, pageUrl);
      const expected = new URL(`${config.widgetBaseUrl}/widget.js`);
      return src.origin === expected.origin && src.pathname === expected.pathname;
    } catch { return false; }
  });
}

function randomSiteId(): string {
  return `site_${randomBytes(6).toString('hex')}`; // e.g. site_9f3a1c7e2b04
}

function randomPublicKey(): string {
  return `pk_${randomBytes(24).toString('base64url')}`;
}

/** Get the website's widget, creating it (with fresh ids) on first access. */
export async function getOrCreateWidget(organizationId: string, websiteId: string) {
  await assertWebsiteOwnership(organizationId, websiteId);
  let widget = await prisma.widget.findUnique({ where: { websiteId } });
  if (!widget) {
    widget = await prisma.widget.create({
      data: { websiteId, siteId: randomSiteId(), widgetPublicKey: randomPublicKey() },
    });
  }
  return widget;
}

/** Build the install snippet the dashboard shows. */
export function buildScriptSnippet(siteId: string): string {
  return `<script src="${config.widgetBaseUrl}/widget.js" data-site-id="${siteId}"></script>`;
}

export async function getWidgetView(organizationId: string, websiteId: string) {
  const widget = await getOrCreateWidget(organizationId, websiteId);
  return {
    siteId: widget.siteId,
    widgetPublicKey: widget.widgetPublicKey,
    status: widget.status,
    installed: widget.installedAt !== null,
    installedAt: widget.installedAt,
    lastRequestAt: widget.lastRequestAt,
    requestCount: widget.requestCount,
    scriptSnippet: buildScriptSnippet(widget.siteId),
  };
}

/** Injectable read-only probe shared by the owner route and installation tests. */
export async function inspectWidgetInstallation(url: string, siteId: string, deps: { fetch?: typeof safeFetch } = {}) {
  try {
    const response = await (deps.fetch ?? safeFetch)(url, { timeoutMs: 12000, maxBytes: 2 * 1024 * 1024,
      headers: { 'User-Agent': 'AI-Revenue-Employee-Install-Verifier/1.0', Accept: 'text/html,application/xhtml+xml' } });
    const base = { checkedUrl: response.url, status: response.status };
    if (response.status < 200 || response.status >= 300) return { ...base, installed: false, verificationStatus: 'inconclusive' as const, reason: `The website returned HTTP ${response.status}; installation could not be checked.` };
    const html = response.body.toString('utf8');
    if (hasWidgetScript(html, response.url, siteId)) return { ...base, installed: true, verificationStatus: 'installed' as const, reason: 'Widget script found on website.' };
    // HTTP HTML cannot establish what Next Script, effects or tag managers add.
    // Never turn a missing static tag into proof of removal on a JavaScript page.
    if (/<script\b/iu.test(html)) {
      return { ...base, installed: false, verificationStatus: 'inconclusive' as const, reason: 'No matching widget script was found in the page HTML. JavaScript-installed widgets cannot be verified while browser rendering is unavailable. Check the live page and your install snippet.' };
    }
    return { ...base, installed: false, verificationStatus: 'missing' as const, reason: 'The matching widget script was not found on this page. Check that the site ID and script URL match your install snippet.' };
  } catch (err) {
    return { installed: false, verificationStatus: 'inconclusive' as const, checkedUrl: url,
      reason: err instanceof UnsafeUrlError ? 'This website URL cannot be reached from the service. Please use a public HTTP or HTTPS website.' : 'Unable to load the website to verify installation. Please try again shortly.' };
  }
}

export async function verifyWidgetInstallation(organizationId: string, websiteId: string, deps: Parameters<typeof inspectWidgetInstallation>[2] = {}) {
  await assertWebsiteOwnership(organizationId, websiteId);
  const website = await prisma.website.findUnique({
    where: { id: websiteId },
    include: { widget: true },
  });

  if (!website || website.deletedAt) {
    return { installed: false, checkedUrl: null, reason: 'Website not found.' };
  }

  const widget = website.widget ?? (await getOrCreateWidget(organizationId, websiteId));
  const result = await inspectWidgetInstallation(website.url, widget.siteId, deps);
  // An inconclusive HTTP check is not proof that a verified embed was removed.
  if (result.verificationStatus !== 'inconclusive') {
    await prisma.widget.update({ where: { id: widget.id }, data: { installedAt: result.installed ? widget.installedAt ?? new Date() : null } });
  }
  return result;
}
