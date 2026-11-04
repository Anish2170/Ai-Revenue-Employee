import assert from 'node:assert/strict';
import test from 'node:test';
import {extract} from './extract.js';
import { hasLoadingPlaceholder, usefulBusinessText } from './contentPolicy.js';
import { crawl } from './crawler.js';

test('hydrated short authoritative fact is not misclassified as unresolved JS shell',()=>{
 const page=extract('<main id="app"><h1>Garden Room</h1><p>Garden Room starts at €120 per night, excluding breakfast.</p></main><script src="/app.js"></script>','https://hotel.invalid/');
 assert.equal(page.needsRendering,false);
 assert.match(page.text,/excluding breakfast/);
});
test('loading text remains unresolved despite already visible fact',()=>{
 const page=extract('<main id="app"><p>Room starts at €120 per night.</p><p>Loading prices, please wait.</p></main>','https://hotel.invalid/');
 assert.equal(page.needsRendering,true);
});
test('explicit busy state still requires render after short-fact exception',()=>{
 const page=extract('<main id="app" aria-busy="true"><p>Room starts at €120 per night.</p></main>','https://hotel.invalid/');
 assert.equal(page.needsRendering,true);
});

const strengthDescription = 'A program focused strictly on nervous system adaptation, structural loading, and mastering the fundamentals of absolute power. Our training services include strength coaching and personalized exercise programs.';
test('GYM structural loading prose is useful static content and does not require rendering', async () => {
 const html = `<main id="app"><h1>Power & Strength Training</h1><p>${strengthDescription}</p></main><script src="/_next/static/app.js"></script>`;
 const page = extract(html, 'https://gym.invalid/');
 assert.equal(page.needsRendering, false);
 assert.equal(usefulBusinessText(strengthDescription), true);
 const result = await crawl('https://gym.invalid/', {}, {
  fetch: async url => ({ url, status: new URL(url).pathname === '/' ? 200 : 404, headers: { 'content-type': 'text/html' }, body: Buffer.from(html) }),
  render: async () => { throw Error('Static GYM page must not launch a browser'); }, sleep: async () => {},
 });
 assert.equal(result.manifest.completeWithinScope, true);
 assert.equal(result.manifest.rendered, 0);
 assert.equal(result.pages.length, 1);
 assert.match(result.pages[0].text, /structural loading/);
});
for (const text of ['Loading...', 'Loading prices', 'Loading services, please wait.', 'Please wait while room prices load.', 'We are preparing your hotel information. Content loads shortly.', 'Room starts at €120.\n\nLoading']) {
 test(`real loading placeholder remains unresolved: ${text}`, () => {
  assert.equal(hasLoadingPlaceholder(text), true);
  assert.equal(extract(`<main id="app"><p>${text}</p></main><script src="/app.js"></script>`, 'https://gym.invalid/').needsRendering, true);
 });
}
for (const text of ['Progressive loading improves strength.', 'Download our training program.', 'Our loading dock services are available Monday to Friday.', strengthDescription]) {
 test(`business wording is not a loading placeholder: ${text.slice(0, 45)}`, () => assert.equal(hasLoadingPlaceholder(text), false));
}
for (const description of [
 'Schedule a 1-on-1 diagnostic audit with an elite coach. We will assess your mobility restrictions, body composition, and construct a training split.',
 'Select a discipline, pick a gym location, and claim your initial coached workout pass. 100% free of charge.',
 'Have a question about lift biomechanics, plateau adjustments, or macro balancing? Send a direct message to our coaching staff.',
 'Experience our elite facilities, strength gear, and classes for 3 consecutive days with no commitments.',
]) {
 test(`short server-rendered fitness description is readable: ${description.slice(0, 45)}`, () => {
  const page = extract(`<main id="app"><h1>Fitness enquiry</h1><p>${description}</p><form><label>Name<input name="name" /></label><button>Submit</button></form></main><script src="/_next/app.js"></script>`, 'https://gym.invalid/book');
  assert.equal(usefulBusinessText(description), true);
  assert.equal(page.needsRendering, false);
  assert.match(page.text, new RegExp(description.slice(0, 10)));
  assert.ok(!page.text.includes('Submit'));
 });
}

test('HTTP-only crawl reports unresolved JavaScript without loading a browser or fetching scripts', async () => {
 const origin = 'https://gym.invalid', resources: string[] = [];
 const result = await crawl(origin, {}, {
  fetch: async (url, options) => {
   resources.push(url); assert.equal(options.allowedOrigin, origin);
   return { url, status: new URL(url).pathname === '/robots.txt' || new URL(url).pathname === '/sitemap.xml' ? 404 : 200, headers: { 'content-type': 'text/html' }, body: Buffer.from('<main id="app">Loading services...</main><script src="/app.js"></script>') };
  },
  sleep: async () => {},
 });
 assert.equal(result.pages.length, 0); assert.equal(result.manifest.rendered, 0);
 assert.equal(result.manifest.maxRenderedPages, 0); assert.equal(result.manifest.completeWithinScope, false);
 assert.ok(result.manifest.entries.some(entry => entry.reason === 'browser_rendering_unavailable'));
 assert.ok(resources.every(url => new URL(url).origin === origin && !url.endsWith('.js')));
});
