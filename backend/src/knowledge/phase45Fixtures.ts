import { crawl, type CrawlOptions, type CrawlDependencies } from '../crawler/crawler.js';

export const fixtureOrigin = 'https://fixture.test';
export const fixturePage = (title: string, text: string, links: string[] = []) =>
  `<html><title>${title}</title><body><main><h1>${title}</h1><p>${text}</p></main><nav>${links.map(path => `<a href="${path}">${path}</a>`).join('')}</nav></body></html>`;

export function onboardingFixture(count = 5, failed?: string, dynamic = false) {
  const paths = count === 5 ? ['/', '/pricing', '/services', '/refund', '/contact'] : ['/', ...Array.from({ length: count - 1 }, (_, i) => `/services/service-${i}`)];
  if (failed && !paths.includes(failed)) paths.push(failed);
  const calls: string[] = [];
  const deps: CrawlDependencies = {
    sleep: async () => {},
    fetch: async url => {
      const path = new URL(url).pathname; calls.push(path);
      const status = !paths.includes(path) || path === failed ? 404 : 200;
      const content = dynamic && path !== '/' ? '<main id="app"><p>Loading services, please wait.</p></main><script src="/app.js"></script>' :
        fixturePage(path === '/' ? 'Business home' : path, path === '/refund' ? 'Consultation fees are non-refundable.' : path === '/pricing' ? 'Premium plan costs ₹2,499 per month.' : `Our service ${path} includes a personal design consultation with a qualified project specialist.`, path === '/' ? paths.slice(1) : []);
      return { url, status, headers: { 'content-type': 'text/html' }, body: Buffer.from(content) };
    },
    render: async url => ({ url, status: 200, html: fixturePage(new URL(url).pathname, `Our service ${new URL(url).pathname} includes a personal design consultation with a qualified project specialist.`), bodyText: '', readyState: 'complete', headingCount: 1, paragraphCount: 1, linkCount: 0, waitStrategy: ['synthetic'] }),
  };
  return { calls, deps, crawl: (options: CrawlOptions = {}) => crawl(fixtureOrigin, options, deps) };
}
