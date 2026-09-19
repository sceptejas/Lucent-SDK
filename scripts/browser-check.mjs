#!/usr/bin/env node
/**
 * Browser-compatibility gate.
 *
 * v0 failed this in the most basic way possible: `import` threw
 * `ReferenceError: Buffer is not defined`, because it computed discriminators and
 * PDA seeds with `Buffer.from` at module load. Bundlers no longer polyfill Node
 * globals, so a package that touches them is unusable in the browser even though
 * it works perfectly in Node — and the browser is where the protocol's users are.
 *
 * Testing this in Node is not enough, and not just because of my own code:
 * `@solana/kit` ships separate entries per condition, so a plain `import` in Node
 * pulls the Node build, which reaches for `ws` and its Node built-ins. A browser
 * resolves a different graph. So this gate:
 *
 *   1. bundles the SDK with esbuild under `platform: browser`, which applies the
 *      browser export condition and fails loudly on an unresolvable built-in;
 *   2. scans the browser bundle for Node globals;
 *   3. imports that bundle with `Buffer` and `process` removed and exercises the
 *      public API, which is the failure v0 had.
 *
 * Deterministic, no network, no browser needed — so it can run in CI.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const work = mkdtempSync(join(tmpdir(), 'lucent-browser-'))
let failures = 0
const ok = (label, pass, detail = '') => {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
  if (!pass) failures++
}

const entry = join(work, 'entry.ts')
const outfile = join(work, 'bundle.mjs')
writeFileSync(
  entry,
  `export * from ${JSON.stringify(join(root, 'src', 'index.ts'))}\n`,
)

console.log('=== bundle for the browser (esbuild, platform=browser) ===')
try {
  execFileSync(
    'npx',
    [
      'esbuild', entry,
      '--bundle',
      '--platform=browser',
      '--format=esm',
      '--target=es2020',
      '--log-level=warning',
      `--outfile=${outfile}`,
    ],
    { cwd: root, stdio: 'pipe' },
  )
  ok('bundles without Node-only imports', true, `${(readFileSync(outfile).length / 1024).toFixed(1)} KB`)
} catch (error) {
  ok('bundles without Node-only imports', false)
  const detail = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr) : String(error)
  console.log(detail.split('\n').slice(0, 12).join('\n'))
  process.exit(1)
}

console.log('\n=== Node globals in the browser bundle ===')
const bundle = readFileSync(outfile, 'utf8')
const globals = {
  // A standalone identifier, so `addressBytesBuffer` and `arrayBuffer` — both of
  // which appear in kit's own code — are not mistaken for the Node global.
  'Buffer': /(?<![A-Za-z0-9_$.])Buffer\s*\./,
  'process.env': /(?<![A-Za-z0-9_$.])process\s*\.\s*env/,
  '__dirname': /(?<![A-Za-z0-9_$.])__dirname/,
  'node: builtin': /from\s*["']node:/,
}
for (const [label, pattern] of Object.entries(globals)) {
  const hits = (bundle.match(new RegExp(pattern.source, 'g')) ?? []).length
  ok(`no ${label}`, hits === 0, hits ? `${hits} occurrence(s)` : '')
}

console.log('\n=== run it with the globals removed (the v0 failure) ===')
// Node internals need `process`; the point is that the SDK must not, so it is
// restored as a bare stub before the import and the API is exercised after.
const savedProcess = globalThis.process
const savedBuffer = globalThis.Buffer
try {
  // eslint-disable-next-line no-delete-var -- removing a global on purpose
  delete globalThis.Buffer
  globalThis.process = { env: {} }
  // A browser page is a secure context; without this kit correctly refuses to do
  // Ed25519 work, and PDA derivation needs it.
  globalThis.isSecureContext = true

  const sdk = await import(pathToFileURL(outfile).href)
  ok('imports with no Buffer global', true, `${Object.keys(sdk).length} exports`)

  const [pool0] = await sdk.findPoolPda(0)
  ok('findPoolPda(0) derives the deployed pool', pool0 === sdk.MAINNET.USDC_POOL, pool0)

  const [receiptMint] = await sdk.findReceiptMintPda(sdk.MAINNET.USDC_POOL)
  ok('receipt mint derives lmUSD', receiptMint === sdk.MAINNET.LM_USD_MINT, receiptMint)

  const [claimPda] = await sdk.findClaimRecordPda(0, 7)
  ok('claim record PDA derives', typeof claimPda === 'string' && claimPda.length >= 32, claimPda)

  sdk.assertMainnetProgram()
  ok('program-address guard passes', true, sdk.SYTHSTAKING_PROGRAM_ADDRESS)
} catch (error) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  ok('runs with no Buffer global', false, message.slice(0, 140))
} finally {
  globalThis.process = savedProcess
  if (savedBuffer) globalThis.Buffer = savedBuffer
  rmSync(work, { recursive: true, force: true })
}

console.log(`\n${failures === 0 ? 'BROWSER CHECK PASSED' : `BROWSER CHECK FAILED — ${failures} problem(s)`}`)
process.exit(failures === 0 ? 0 : 1)
