const { execFileSync } = require('node:child_process')
const path = require('node:path')

/**
 * Ad-hoc sign the app when no Developer ID certificate is configured.
 * Without any signature, Apple Silicon refuses to launch the downloaded app
 * and macOS reports it as "damaged". When CSC_LINK/CSC_KEY_PASSWORD are set,
 * electron-builder does the real Developer ID signing after this hook instead.
 */
module.exports = async function afterPack(context) {
  if (process.platform !== 'darwin') return
  if (process.env.CSC_LINK || process.env.CSC_KEY_PASSWORD) return

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' })
}
