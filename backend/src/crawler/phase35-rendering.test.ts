import assert from 'node:assert/strict';
import test from 'node:test';
import {extract} from './extract.js';

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
