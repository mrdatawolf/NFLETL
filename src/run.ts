// CLI entrypoint: parse tally reports into their own SQLite db, then scan
// all configured sources (raptor, sawfilers, porter, tally) into the shared
// bronze PGlite database. Meant to be invoked once per run via cron/start.sh,
// not left running — no built-in scheduler.
import { runTallyEtl } from './tally/etl.js';
import { db, initDb } from './db.js';
import { scanAllSources } from './ingest.js';

async function main(): Promise<number> {
  const tallyResult = await runTallyEtl();

  await initDb();
  const scanResults = await scanAllSources();

  console.log('[bronze] scan complete', scanResults);

  const tallyFailed = tallyResult.failed > 0;
  const scanFailed = scanResults.some((result) => result.status === 'error');
  return tallyFailed || scanFailed ? 1 : 0;
}

main()
  .then(async (code) => {
    await db.close();
    process.exit(code);
  })
  .catch(async (error) => {
    console.error('Run failed', error);
    await db.close();
    process.exit(1);
  });
