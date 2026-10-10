/** Verifies HUBSPOT_ACCESS_TOKEN works and that the configured pipeline/stage ids exist in YOUR HubSpot.
 *    npx tsx --env-file=.env.local scripts/hubspot-check.ts            (prints your pipelines and stage ids)
 * Compares against the defaults in lib/hubspot/mapping.ts (override in the Supabase `config` table, key `hubspot`). */
import { HubspotApi } from '../lib/hubspot/api'
import { DEFAULT_MAPPING } from '../lib/hubspot/mapping'

async function main() {
  const token = process.env.HUBSPOT_ACCESS_TOKEN
  if (!token) { console.error('HUBSPOT_ACCESS_TOKEN is not set'); process.exit(1) }
  const { results } = await new HubspotApi(token).getDealPipelines()
  for (const p of results) console.log(`pipeline "${p.label}" id=${p.id}\n  ` + p.stages.map((s) => `${s.label} = ${s.id}`).join('\n  '))
  const pipe = results.find((p) => p.id === DEFAULT_MAPPING.pipeline)
  if (!pipe) { console.log(`\n! default pipeline id "${DEFAULT_MAPPING.pipeline}" not found. Set config key "hubspot" to your pipeline id and stage ids.`); process.exit(2) }
  const missing = Object.entries(DEFAULT_MAPPING.stages).filter(([, id]) => !pipe.stages.some((s) => s.id === id))
  console.log(missing.length ? `\n! stages not found in "${pipe.label}": ${missing.map(([k, v]) => `${k}=${v}`).join(', ')}` : `\nOK: every mapped stage exists in "${pipe.label}".`)
  process.exit(missing.length ? 2 : 0)
}
main().catch((e) => { console.error(e.message); process.exit(1) })
