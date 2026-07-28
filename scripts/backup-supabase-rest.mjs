import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { once } from 'node:events'
import { basename, join, resolve } from 'node:path'
import { createGzip } from 'node:zlib'

const apiUrl = process.env.SUPABASE_URL?.replace(/\/+$/, '')
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const outputDir = resolve(process.argv[2] || '')
const pageSize = 1000

if (!apiUrl || !serviceKey || !process.argv[2]) {
  throw new Error('Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/backup-supabase-rest.mjs OUTPUT_DIR')
}
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(apiUrl)) {
  throw new Error('SUPABASE_URL is not a valid hosted Supabase URL')
}

await mkdir(outputDir, { recursive: true, mode: 0o700 })
await chmod(outputDir, 0o700)

const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  Accept: 'application/json',
}

const schemaResponse = await fetch(`${apiUrl}/rest/v1/`, { headers })
if (!schemaResponse.ok) throw new Error(`OpenAPI inventory failed: HTTP ${schemaResponse.status}`)
const schema = await schemaResponse.json()
const schemaPath = join(outputDir, 'postgrest-openapi.json')
await writeFile(schemaPath, JSON.stringify(schema, null, 2), { mode: 0o600 })

const definitions = schema.definitions ?? schema.components?.schemas ?? {}
const tables = Object.keys(definitions).filter(name => /^[a-z][a-z0-9_]*$/.test(name)).sort()
if (tables.length === 0) throw new Error('No public tables discovered through PostgREST')

async function sha256(filePath) {
  const hash = createHash('sha256')
  const stream = createReadStream(filePath)
  stream.on('data', chunk => hash.update(chunk))
  await once(stream, 'end')
  return hash.digest('hex')
}

async function writeChunk(stream, value) {
  if (!stream.write(value)) await once(stream, 'drain')
}

const manifest = {
  format: 'ziiitv-supabase-rest-backup-v1',
  created_at: new Date().toISOString(),
  source_host: new URL(apiUrl).host,
  consistency: 'best-effort per-table REST pagination; not a transaction snapshot',
  tables: [],
}

for (const table of tables) {
  const fileName = `${table}.ndjson.gz`
  const filePath = join(outputDir, fileName)
  const gzip = createGzip({ level: 9 })
  const output = createWriteStream(filePath, { mode: 0o600 })
  gzip.pipe(output)

  let offset = 0
  let rowCount = 0
  let expectedTotal = null

  while (true) {
    const response = await fetch(`${apiUrl}/rest/v1/${encodeURIComponent(table)}?select=*`, {
      headers: {
        ...headers,
        Prefer: 'count=exact',
        Range: `${offset}-${offset + pageSize - 1}`,
        'Range-Unit': 'items',
      },
    })
    if (!response.ok) {
      gzip.destroy()
      output.destroy()
      throw new Error(`${table} backup failed: HTTP ${response.status}`)
    }
    const rows = await response.json()
    if (!Array.isArray(rows)) throw new Error(`${table} returned a non-array payload`)

    const contentRange = response.headers.get('content-range')
    const totalText = contentRange?.split('/')[1]
    if (totalText && totalText !== '*') expectedTotal = Number(totalText)

    for (const row of rows) await writeChunk(gzip, `${JSON.stringify(row)}\n`)
    rowCount += rows.length
    offset += rows.length
    if (rows.length < pageSize || (expectedTotal !== null && rowCount >= expectedTotal)) break
  }

  gzip.end()
  await once(output, 'close')
  await chmod(filePath, 0o600)
  if (expectedTotal !== null && rowCount !== expectedTotal) {
    throw new Error(`${table} count mismatch: exported=${rowCount} expected=${expectedTotal}`)
  }

  const digest = await sha256(filePath)
  manifest.tables.push({ name: table, rows: rowCount, file: fileName, sha256: digest })
  process.stdout.write(`${table}: ${rowCount}\n`)
}

manifest.openapi_sha256 = await sha256(schemaPath)
const manifestPath = join(outputDir, 'manifest.json')
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 })
await chmod(manifestPath, 0o600)

const verify = JSON.parse(await readFile(manifestPath, 'utf8'))
if (verify.tables.length !== tables.length) throw new Error('Manifest verification failed')
process.stdout.write(`BACKUP_OK ${basename(outputDir)} ${tables.length} tables\n`)
