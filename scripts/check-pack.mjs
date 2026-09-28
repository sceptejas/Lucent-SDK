#!/usr/bin/env node
/**
 * Tarball gate.
 *
 * v0 shipped a `dependencies` entry for itself (`"lucent-sdk": "^0.1.0"`), so
 * every install pulled a second, older copy of the SDK alongside the package the
 * consumer asked for. It also had no `repository` field, so npm showed no source
 * link on a package whose docs tell people to install it.
 *
 * This inspects what `npm pack` would actually publish:
 *   1. no dependency on itself;
 *   2. every path referenced by `exports`/`main`/`module`/`types` exists *in the
 *      tarball* — an `exports` map pointing at a file that is not published is an
 *      unimportable package, and it passes every local test;
 *   3. only the intended files ship.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

let failures = 0
const ok = (label, pass, detail = '') => {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
  if (!pass) failures++
}

const packed = JSON.parse(
  execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: root, encoding: 'utf8' }),
)
const files = packed[0].files.map(f => f.path).sort()
const tarball = new Set(files)

console.log('=== self-dependency ===')
for (const field of ['dependencies', 'peerDependencies', 'devDependencies']) {
  const has = Object.prototype.hasOwnProperty.call(manifest[field] ?? {}, manifest.name)
  ok(`${field} does not contain ${manifest.name}`, !has, has ? 'a package cannot depend on itself' : '')
}

console.log('\n=== every published entry point is actually in the tarball ===')
const referenced = new Set()
const collect = value => {
  if (typeof value === 'string') {
    if (value.startsWith('./')) referenced.add(value.slice(2))
  } else if (value && typeof value === 'object') {
    for (const nested of Object.values(value)) collect(nested)
  }
}
for (const field of ['main', 'module', 'types', 'exports']) collect(manifest[field])
for (const path of [...referenced].sort()) {
  ok(path, tarball.has(path))
}
ok('at least one entry point declared', referenced.size > 0)

console.log('\n=== tarball contents ===')
const unwanted = files.filter(
  f => !f.startsWith('dist/') && !['package.json', 'README.md', 'LICENSE', 'LICENSE.md', 'CHANGELOG.md'].includes(f),
)
ok('only dist/ and package metadata ship', unwanted.length === 0, unwanted.slice(0, 6).join(', '))
ok('nothing from src/ ships', !files.some(f => f.startsWith('src/')))
ok('no test fixtures ship', !files.some(f => f.startsWith('test/')))

console.log(`\n  ${files.length} files, ${(packed[0].size / 1024).toFixed(1)} KB packed, ${(packed[0].unpackedSize / 1024).toFixed(1)} KB unpacked`)
for (const f of files) console.log(`    ${f}`)

console.log(`\n${failures === 0 ? 'PACK CHECK PASSED' : `PACK CHECK FAILED — ${failures} problem(s)`}`)
process.exit(failures === 0 ? 0 : 1)
