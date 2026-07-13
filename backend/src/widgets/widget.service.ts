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

export async function verifyWidgetInstallation(organizationId: string, websiteId: string) {
  await assertWebsiteOwnership(organizationId, websiteId);
  const website = await prisma.website.findUnique({
    where: { id: websiteId },
    include: { widget: true },
  });

  if (!website || website.deletedAt) {
    return { installed: false, checkedUrl: null, reason: 'Website not found.' };
  }

  const widget = website.widget ?? (await getOrCreateWidget(organizationId, websiteId));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(website.url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'AI-Revenue-Employee-Install-Verifier/1.0',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    const html = await response.text();
    const installed =
      html.includes(`data-site-id="${widget.siteId}"`) ||
      html.includes(`data-site-id='${widget.siteId}'`) ||
      (html.includes('/widget.js') && html.includes(widget.siteId));

    if (installed) {
      await prisma.widget.update({
        where: { id: widget.id },
        data: { installedAt: new Date() },
      });
    }

    return {
      installed,
      checkedUrl: website.url,
      status: response.status,
      reason: installed ? 'Widget script found on website.' : 'Widget script was not found in the page HTML.',
    };
  } catch (err) {
    return {
      installed: false,
      checkedUrl: website.url,
      reason: err instanceof Error ? err.message : 'Unable to fetch website.',
    };
  } finally {
    clearTimeout(timeout);
  }
}
