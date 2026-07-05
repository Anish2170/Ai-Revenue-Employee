/**
 * CLI entry for ingestion: `npm run ingest -- <url>`.
 *
 * Calls the SAME ingestService.ingest() as the HTTP route — one pipeline.
 * Example: npm run ingest -- http://localhost:3000
 */
import { ingest } from '../src/services/ingestService.js';

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error('Usage: npm run ingest -- <url>\n  e.g. npm run ingest -- http://localhost:3000');
    process.exit(1);
  }

  try {
    const result = await ingest(url);
    console.log('\n✓ Ingestion complete:');
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('\n✗ Ingestion failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

void main();
