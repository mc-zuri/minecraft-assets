// Adds a Bedrock version to data/bedrock, or exports it again: runs minecraft-bedrock-extractor for it into
// data/bedrock, where it shares what it has in common with the versions there (versions.json). With --commit the
// change goes on a branch bedrock-<version>; with --push that branch is pushed and a pull request opened.
//
//   node bump-bedrock.js <version> [--extractor <dir>] [--allow-older] [--commit] [--push] [--base <branch>]
//                        [-- <extractor options>]
//
// The extractor options are `--sources bedrock-samples --refresh` unless given: the version's resource pack is a
// release tag of Mojang/bedrock-samples. The tag must be of the version or of its hotfix family; one of an older
// version fails, unless --allow-older. minecraft-data must know the version.
const fs = require('fs')
const os = require('os')
const path = require('path')
const cp = require('child_process')

const repoRoot = path.resolve(__dirname, '../..')
const out = path.join(repoRoot, 'data', 'bedrock')

const run = (cmd, args, options = {}) => {
  console.log('$', cmd, args.join(' '))
  return cp.execFileSync(cmd, args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 28, ...options })
}
const git = (...args) => run('git', args).trim()

function parseArgs (argv) {
  const dash = argv.indexOf('--')
  const own = dash === -1 ? argv : argv.slice(0, dash)
  const opts = { extractorArgs: dash === -1 ? ['--sources', 'bedrock-samples', '--refresh'] : argv.slice(dash + 1) }
  for (let i = 0; i < own.length; i++) {
    const a = own[i]
    if (a === '--extractor') opts.extractor = path.resolve(own[++i])
    else if (a === '--base') opts.base = own[++i]
    else if (a === '--allow-older') opts.allowOlder = true
    else if (a === '--commit') opts.commit = true
    else if (a === '--push') opts.commit = opts.push = true
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`)
    else opts.version = a.replace(/^bedrock_/, '')
  }
  if (!opts.version) throw new Error('usage: node bump-bedrock.js <version> [--extractor <dir>] [--allow-older] [--commit] [--push] [--base <branch>] [-- <extractor options>]')
  return opts
}

// the source the extractor would export the version from: { kind, build, match }
function planOf (cli, opts) {
  const printed = run('node', [cli, opts.version, '--plan', ...opts.extractorArgs])
  const line = printed.split('\n').find(l => l.trim().split(/\s+/)[0] === opts.version)
  const m = line && /^\s*\S+\s+(\S+) (\S+) \(([\w-]+)\)/.exec(line)
  if (!m) throw new Error(`no plan for ${opts.version}:\n${printed}`)
  return { kind: m[1], build: m[2], match: m[3] }
}

// what the pull request says of the export: its source, its size and what it could not resolve
function describe (version, plan, meta, changed) {
  const listed = (name, list) => list?.length ? `- ${name} (${list.length}): ${list.slice(0, 30).join(', ')}${list.length > 30 ? ', ...' : ''}` : null
  const c = meta?.counts ?? {}
  return [
    `Bedrock ${version}, exported by minecraft-bedrock-extractor from ${plan.kind} ${plan.build} (${plan.match}); ${changed.length} files changed.`,
    '',
    meta && `${c.textures} textures, ${c.blocks} blocks (${c.blockStates} states, ${c.models} models), ` +
      `${c.items?.withTexture}/${c.items?.items} items with an icon, ${c.entities?.entities} entities, ` +
      `${meta.particles?.compiled?.count ?? 0} compiled particle effects matched.`,
    '',
    listed('unresolved blocks', meta?.unresolved?.blocks),
    listed('unresolved items', meta?.unresolved?.items),
    listed('unresolved textures', meta?.unresolved?.textures),
    listed('drawn as missing_tile', meta?.missingTile),
    listed('states reaching no variant', meta?.unreached),
    listed('failed', meta?.failed),
    listed('missing entity textures', meta?.missingTextures),
    ...(meta?.notes ?? []).map(n => `- ${n}`)
  ].filter(l => l !== null && l !== undefined).join('\n')
}

async function bump (opts) {
  const extractor = opts.extractor ?? path.dirname(require.resolve('minecraft-bedrock-extractor/package.json'))
  const cli = path.join(extractor, 'bin', 'cli.js')
  const plan = planOf(cli, opts)
  console.log(`${opts.version}: ${plan.kind} ${plan.build} (${plan.match})`)
  if (!['exact', 'hotfix'].includes(plan.match) && !opts.allowOlder) {
    throw new Error(`${opts.version}: no ${plan.kind === 'client' ? 'client' : 'bedrock-samples release'} of this version or its hotfix family yet ` +
      `(it would take ${plan.build}, ${plan.match}); --allow-older to export it anyway`)
  }

  const report = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bump-bedrock-')), 'report.json')
  run('node', [cli, opts.version, '--out', out, '--force', '--report', report, ...opts.extractorArgs], { stdio: 'inherit' })
  const meta = JSON.parse(fs.readFileSync(report, 'utf8')).metas.find(m => m.version === opts.version) ?? null

  const changed = git('status', '--porcelain', '--', 'data/bedrock').split('\n').filter(Boolean)
  console.log(describe(opts.version, plan, meta, changed))
  if (!changed.length || !opts.commit) return { changed, meta }

  const body = describe(opts.version, plan, meta, changed)
  const base = opts.base ?? git('rev-parse', '--abbrev-ref', 'HEAD')
  const branch = `bedrock-${opts.version}`
  git('checkout', '-B', branch)
  git('add', '-A', '--', 'data/bedrock')
  run('git', ['commit', '-F', '-'], { input: `Bedrock ${opts.version}\n\n${body}\n`, stdio: ['pipe', 'inherit', 'inherit'] })
  if (opts.push) {
    git('push', '--force', 'origin', branch)
    const gh = require('gh-helpers')()
    const pr = await gh.createPullRequest(`Bedrock ${opts.version}`, body, branch, base)
    console.log('Pull request created:', pr.url)
  }
  return { changed, meta }
}

module.exports = async ([...argv], helpers) => {
  try {
    await bump(parseArgs(argv))
  } catch (error) {
    helpers?.reply?.('Error adding the Bedrock version: ' + error.message)
    throw error
  }
}

if (require.main === module) {
  module.exports(process.argv.slice(2)).catch(error => {
    console.error(error.message)
    process.exit(1)
  })
}
