#!/usr/bin/env node
/**
 * Regenerate the program client from the vendored mainnet IDL.
 *
 * `@codama/renderers-js` always writes to `<target>/src/generated` and drops its
 * own `package.json` at `<target>`. Generating into a throwaway target and
 * flattening the result keeps the SDK's imports as `./generated/...` instead of
 * `./generated/src/generated/...`, and stops a stub manifest from landing in the
 * package root.
 *
 * Deterministic on purpose: CI runs this and fails on `git diff --exit-code`, so
 * a stale committed client cannot survive a merge.
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const tmp = join(root, '.codama-tmp')
const out = join(root, 'src', 'generated')
const idlPath = join(root, 'idls', 'sythstaking.json')

// The IDL is the source of truth for the whole client. Refuse to generate from
// anything but the deployed mainnet program: a devnet IDL sits next to this one
// upstream and produces a client pointed at the wrong program.
const EXPECTED_PROGRAM = 'FXmUMZQVoUA2Ws4hJ6CsDo7bzGYTy1T45KTZz8xSy9R5'
const idlRaw = readFileSync(idlPath)
const idl = JSON.parse(idlRaw.toString('utf8'))
if (idl.address !== EXPECTED_PROGRAM) {
  console.error(`idls/sythstaking.json is addressed to ${idl.address}, expected ${EXPECTED_PROGRAM}`)
  process.exit(1)
}

console.log(`IDL sha256 ${createHash('sha256').update(idlRaw).digest('hex')}`)
console.log(
  `${idl.instructions.length} instructions, ${idl.accounts.length} accounts, ` +
    `${idl.events.length} events, ${(idl.errors ?? []).length} errors`,
)

rmSync(tmp, { recursive: true, force: true })
rmSync(out, { recursive: true, force: true })

execFileSync('npx', ['codama', 'run', 'js'], { cwd: root, stdio: 'inherit' })

const rendered = join(tmp, 'src', 'generated')
if (!existsSync(rendered)) {
  console.error(`codama did not produce ${rendered}`)
  process.exit(1)
}

mkdirSync(out, { recursive: true })
cpSync(rendered, out, { recursive: true })

// The renderer's manifest carries the runtime requirements for the generated
// code. Keep it beside the output as evidence rather than copying it into the
// package root, and mirror what it asks for in the SDK manifest.
const stubManifest = join(tmp, 'package.json')
if (existsSync(stubManifest)) {
  const stub = JSON.parse(readFileSync(stubManifest, 'utf8'))
  writeFileSync(
    join(out, 'GENERATED_DEPS.json'),
    `${JSON.stringify({ peerDependencies: stub.peerDependencies, dependencies: stub.dependencies }, null, 2)}\n`,
  )
}

rmSync(tmp, { recursive: true, force: true })
console.log(`wrote ${out}`)
