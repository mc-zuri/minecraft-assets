const fs = require('fs')
const path = require('path')
const cp = require('child_process')
const gh = require('gh-helpers')()

const exec = (cmd, options) => {
  console.log('$', cmd)
  return cp.execSync(cmd, { stdio: 'inherit', ...options })
}

const execOutput = (cmd, options) => {
  console.log('$', cmd)
  return cp.execSync(cmd, { encoding: 'utf8', ...options }).trim()
}

async function bumpVersion(newVersion) {
  const workDir = process.cwd()
  const repoRoot = path.resolve(workDir, '../..')
  const outputDir = path.join(workDir, 'output')
  const tempDir = path.join(workDir, 'temp')
  
  console.log('Starting bump process for version:', newVersion)
  console.log('Working directory:', workDir)
  console.log('Repository root:', repoRoot)
  
  try {
    // Clean up any existing directories
    if (fs.existsSync(outputDir)) {
      fs.rmSync(outputDir, { recursive: true, force: true })
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
    
    // Run the extractor
    console.log('Extracting minecraft assets for version:', newVersion)
    exec(`node node_modules/minecraft-jar-extractor/image_names.js ${newVersion} ${outputDir} ${tempDir}`)
    
    // Verify the output was generated
    const versionOutputDir = path.join(outputDir, newVersion)
    if (!fs.existsSync(versionOutputDir)) {
      throw new Error(`Output directory ${versionOutputDir} was not created`)
    }
    
    // Move to repository root for git operations
    process.chdir(repoRoot)
    
    // Check if version already exists
    const targetDataDir = path.join(repoRoot, 'data', newVersion)
    if (fs.existsSync(targetDataDir)) {
      console.log(`Version ${newVersion} already exists, updating...`)
      fs.rmSync(targetDataDir, { recursive: true, force: true })
    }
    
    // Move the generated data to the correct location
    console.log('Moving generated data to:', targetDataDir)
    fs.renameSync(versionOutputDir, targetDataDir)
    
    // Set up git configuration
    try {
      exec('git config user.name "github-actions[bot]"')
      exec('git config user.email "41898282+github-actions[bot]@users.noreply.github.com"')
    } catch (e) {
      console.log('Git config already set or failed to set, continuing...')
    }
    
    // Create and switch to bump branch
    try { 
      exec('git branch -D bump') 
    } catch (e) { 
      console.log('No existing bump branch to delete, continuing...') 
    }
    exec('git checkout -b bump')
    
    // Add and commit the changes
    exec(`git add data/${newVersion}`)
    exec(`git commit -m "Add version ${newVersion}"`)
    
    // Push the branch
    exec('git push origin bump --force')
    
    // Create pull request (returns { url, number })
    const pr = await gh.createPullRequest(
      `Add version ${newVersion}`,
      `This automated PR adds version ${newVersion}`,
      'bump',
      'master'
    )
    
    console.log('Pull request created:', pr.url)
    return pr

  } catch (error) {
    console.error('Error in bump process:', error)
    throw error
  } finally {
    // Clean up
    process.chdir(workDir)
    if (fs.existsSync(outputDir)) {
      fs.rmSync(outputDir, { recursive: true, force: true })
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  }
}

module.exports = async ([newVersion], helpers) => {
  try {
    const pr = await bumpVersion(newVersion)
    if (helpers && helpers.reply) {
      helpers.reply(`Successfully created PR for version ${newVersion}: ${pr.url}`)
    }
  } catch (error) {
    console.error('Error bumping version:', error)
    if (helpers && helpers.reply) {
      helpers.reply('Error bumping version: ' + error.message)
    }
    throw error
  }
}

if (require.main === module) {
  const args = process.argv.slice(2)
  if (args.length !== 1) {
    console.error('Usage: node bump.js <newVersion>')
    process.exit(1)
  }
  module.exports(args, { reply: console.log }).catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
}