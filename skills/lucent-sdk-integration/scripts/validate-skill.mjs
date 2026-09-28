import { access, readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const skillDirectory = path.resolve(scriptDirectory, '..')
const expectedName = path.basename(skillDirectory)

const requiredFiles = [
  'SKILL.md',
  'README.md',
  'LICENSE',
  'references/host-application-discovery.md',
  'references/installation-and-api-inspection.md',
  'references/sdk-overview-v1.0.0.md',
  'references/client-and-wallet-integration.md',
  'references/pools-and-financial-data.md',
  'references/staking.md',
  'references/unstaking-and-claims.md',
  'references/positions-and-history.md',
  'references/transactions-and-errors.md',
  'references/deployment-and-troubleshooting.md',
  'examples/minimal/read-protocol-data.ts',
  'examples/minimal/execute-stake.ts',
  'examples/minimal/unstake-lifecycle.ts',
  'examples/react/integration-recipe.md',
  'examples/nextjs/integration-recipe.md',
  'templates/integration-plan.md',
  'templates/completion-summary.md',
  'scripts/validate-skill.mjs',
]

const errors = []

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...await collectFiles(fullPath))
    } else if (entry.isFile()) {
      files.push(fullPath)
    }
  }

  return files
}

for (const relativePath of requiredFiles) {
  try {
    await access(path.join(skillDirectory, relativePath))
  } catch {
    errors.push(`Missing required file: ${relativePath}`)
  }
}

const skillPath = path.join(skillDirectory, 'SKILL.md')
let skillText = ''

try {
  skillText = await readFile(skillPath, 'utf8')
  const frontmatter = skillText.match(/^---\n([\s\S]*?)\n---\n/)
  if (!frontmatter) {
    errors.push('SKILL.md has no valid YAML frontmatter block')
  } else {
    const name = frontmatter[1].match(/^name:\s*([^\n]+)$/m)?.[1]?.trim()
    if (name !== expectedName) {
      errors.push(`SKILL.md name ${JSON.stringify(name)} does not match directory ${JSON.stringify(expectedName)}`)
    }
    const description = frontmatter[1].match(/^description:\s*([^\n]+)$/m)?.[1]?.trim()
    if (!description) errors.push('SKILL.md frontmatter has no description')
  }
} catch (error) {
  errors.push(`Could not read SKILL.md: ${String(error)}`)
}

const files = await collectFiles(skillDirectory)
const textFiles = files.filter(file => /\.(?:md|ts|mjs)$/.test(file) || path.basename(file) === 'LICENSE')
const contents = new Map()

for (const file of textFiles) {
  const relativePath = path.relative(skillDirectory, file)
  const fileStat = await stat(file)
  if (fileStat.size === 0) errors.push(`Empty file: ${relativePath}`)

  const text = await readFile(file, 'utf8')
  contents.set(file, text)

  const isValidator = relativePath === 'scripts/validate-skill.mjs'
  if (!isValidator && /(?:^|\n)\s*(?:TODO|TBD)(?:\s*:|\s*$)|\{\{[^}]+\}\}/i.test(text)) {
    errors.push(`Placeholder text found in ${relativePath}`)
  }
  if (
    !isValidator &&
    (text.includes('/Users/tejas/Downloads/lucent-sdk') || text.includes('../../source/'))
  ) {
    errors.push(`Parent-repository dependency found in ${relativePath}`)
  }
}

for (const [file, text] of contents) {
  if (!file.endsWith('.md')) continue

  for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1].trim().split(/\s+/)[0]
    if (!target || /^(?:https?:|mailto:|#)/.test(target)) continue

    const withoutFragment = target.split('#')[0]
    const resolved = path.resolve(path.dirname(file), decodeURIComponent(withoutFragment))
    if (!resolved.startsWith(`${skillDirectory}${path.sep}`) && resolved !== skillDirectory) {
      errors.push(`Link escapes skill directory in ${path.relative(skillDirectory, file)}: ${target}`)
      continue
    }

    try {
      await access(resolved)
    } catch {
      errors.push(`Broken link in ${path.relative(skillDirectory, file)}: ${target}`)
    }
  }
}

const typeScriptExamples = files.filter(file => file.includes(`${path.sep}examples${path.sep}`) && file.endsWith('.ts'))
const allowedLucentImports = new Set(['lucent-sdk', 'lucent-sdk/keeper'])

for (const file of typeScriptExamples) {
  const text = contents.get(file) ?? await readFile(file, 'utf8')
  const relativePath = path.relative(skillDirectory, file)

  for (const match of text.matchAll(/from\s+['"](lucent-sdk[^'"]*)['"]/g)) {
    if (!allowedLucentImports.has(match[1])) {
      errors.push(`Non-public Lucent import in ${relativePath}: ${match[1]}`)
    }
  }

  if (/\bas\s+TransactionSigner\b/.test(text)) {
    errors.push(`Unsafe TransactionSigner cast in ${relativePath}`)
  }
  if (/\b(?:LucentCard|LucentModal|LucentTerminal|LucentTheme|LucentDashboard)\b/.test(text)) {
    errors.push(`Lucent-specific UI component found in ${relativePath}`)
  }
  if (/privateKey|secretKey|seedPhrase|mnemonic/i.test(text)) {
    errors.push(`Signing-secret pattern found in ${relativePath}`)
  }
}

const allText = [...contents.values()].join('\n')
const requiredConcepts = [
  ['inspect before editing', /inspect before editing|do not begin by writing/i],
  ['host UX priority', /host application provides the UX/i],
  ['Kit signer', /TransactionSigner/],
  ['transaction execution', /plan\.send\(\)/],
  ['hosted API configuration', /apiUrl/],
  ['UTF-8 referral limit', /32 UTF-8 bytes/i],
  ['APY limitation', /no APY API/i],
  ['capacity limitation', /no complete remaining-capacity API/i],
  ['deployment verification', /deployment support is independently verified|deployment compatibility/i],
  ['private-key prohibition', /never request.*private keys|never request or store private keys/is],
]

for (const [label, pattern] of requiredConcepts) {
  if (!pattern.test(allText)) errors.push(`Missing required concept: ${label}`)
}

if (errors.length > 0) {
  console.error(`Lucent skill validation failed with ${errors.length} error${errors.length === 1 ? '' : 's'}:`)
  for (const error of errors) console.error(`- ${error}`)
  process.exitCode = 1
} else {
  console.log(`Lucent skill validation passed (${files.length} files checked).`)
}
