const { execFileSync } = require('node:child_process')
const path = require('node:path')

/**
 * Staple the notarization ticket to the app so Gatekeeper can validate it
 * offline. Runs only when a Developer ID certificate is configured; the
 * ad-hoc fallback is not notarized and needs no ticket.
 */
module.exports = async function afterSign(context) {
  if (process.platform !== 'darwin') return
  if (!process.env.CSC_LINK && !process.env.CSC_KEY_PASSWORD) return

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execFileSync('xcrun', ['stapler', 'staple', appPath], { stdio: 'inherit' })
}
