/**
 * Build Diagnostics — Classifies build errors and generates user-friendly suggestions.
 * 
 * Used by the worker to transform cryptic Docker/Node errors into actionable feedback
 * that both mentors and employees can understand.
 */

const ERROR_PATTERNS = [
  // ─── VALIDATION ERRORS ───
  {
    category: 'validation_error',
    patterns: [/unsupported project/i, /no recognized project/i, /Unsupported project/i, /recognized project structure/i, /empty or corrupted/i],
    friendlyMessage: '❌ No recognized project structure — include package.json, index.html, or Dockerfile.',
    suggestions: [
      'Include package.json, index.html, or Dockerfile at the root of the ZIP',
      'Make sure your project files are at the root of the ZIP (not nested in a folder)',
      'Verify the ZIP is not corrupted — try re-creating it'
    ],
    severity: 'critical'
  },

  // ─── DEPENDENCY ERRORS ───
  {
    category: 'dependency_error',
    patterns: [/npm ERR/i, /ERESOLVE/i, /Could not resolve/i, /peer dep/i, /node_modules/i, /pnpm install/i, /yarn install.*failed/i],
    friendlyMessage: '❌ Dependency Error: Failed to install project dependencies.',
    suggestions: [
      'Remove node_modules/ from your ZIP before uploading',
      'Verify package.json has valid dependency versions',
      'Run "npm install" locally first to check for errors',
      'If using pnpm/yarn, include the correct lockfile (pnpm-lock.yaml or yarn.lock)'
    ],
    severity: 'high'
  },

  // ─── PORT / ADDRESS ERRORS ───
  {
    category: 'port_error',
    patterns: [/EADDRINUSE/i, /address already in use/i, /port.*already/i],
    friendlyMessage: '❌ Port Conflict: Your app tried to use a port that is already taken.',
    suggestions: [
      'Use process.env.PORT instead of hardcoding a port number',
      'Ensure only one server instance is starting',
      'Check for multiple listen() calls in your code'
    ],
    severity: 'high'
  },

  // ─── RUNTIME / STARTUP ERRORS ───
  {
    category: 'runtime_error',
    patterns: [/Cannot find module/i, /SyntaxError/i, /ReferenceError/i, /TypeError.*undefined/i, /MODULE_NOT_FOUND/i, /ENOENT.*index/i],
    friendlyMessage: '❌ Runtime Error: Your app crashed during startup.',
    suggestions: [
      'Check your entry point file (index.js, server.js, or main field in package.json)',
      'Verify all imported modules are listed in package.json dependencies',
      'Check for syntax errors — run your code locally first',
      'Ensure environment variables your app needs are not missing'
    ],
    severity: 'high'
  },

  // ─── TIMEOUT ERRORS ───
  {
    category: 'timeout_error',
    patterns: [/timeout/i, /exceeded.*\d+s/i, /took too long/i],
    friendlyMessage: '❌ Build Timeout: Your project took too long to build (>2 minutes).',
    suggestions: [
      'Remove node_modules/ from your ZIP — they will be installed automatically',
      'Reduce the number of dependencies in package.json',
      'If using TypeScript, check for infinite type loops',
      'Large projects may need a custom Dockerfile for optimized builds'
    ],
    severity: 'medium'
  },

  // ─── HEALTH CHECK ERRORS ───
  {
    category: 'healthcheck_error',
    patterns: [/health check/i, /did not respond/i, /startup timeout/i, /not listening/i],
    friendlyMessage: '❌ Startup Failed: Your app built successfully but didn\'t respond on the expected port.',
    suggestions: [
      'Ensure your app listens on port 3000 (or use process.env.PORT)',
      'Bind to 0.0.0.0 instead of localhost (required inside Docker)',
      'Check that your start script actually runs the server',
      'For Vite/React apps: ensure "vite --host 0.0.0.0" is in your dev script'
    ],
    severity: 'high'
  },

  // ─── DOCKER ERRORS ───
  {
    category: 'docker_error',
    patterns: [/docker daemon/i, /docker.*unreachable/i, /ECONNREFUSED.*docker/i, /cannot connect/i],
    friendlyMessage: '❌ System Error: The container engine is temporarily unavailable.',
    suggestions: [
      'This is a server-side issue — your code is fine',
      'Please try again in a few minutes',
      'If the issue persists, contact support'
    ],
    severity: 'critical'
  },

  // ─── DOCKERFILE ERRORS ───
  {
    category: 'dockerfile_error',
    patterns: [/Dockerfile.*error/i, /invalid.*FROM/i, /failed to build/i, /COPY failed/i],
    friendlyMessage: '❌ Dockerfile Error: There is an issue with the project\'s Dockerfile.',
    suggestions: [
      'If using a custom Dockerfile, verify the FROM image exists',
      'Check COPY paths — files must exist relative to the build context',
      'Ensure the Dockerfile uses valid syntax'
    ],
    severity: 'high'
  },

  // ─── MEMORY ERRORS ───
  {
    category: 'memory_error',
    patterns: [/out of memory/i, /OOMKilled/i, /heap.*limit/i, /ENOMEM/i, /JavaScript heap/i],
    friendlyMessage: '❌ Memory Limit: Your app exceeded the 512MB memory limit.',
    suggestions: [
      'Optimize memory usage — avoid loading large files into memory',
      'Reduce the number of concurrent processes',
      'For build tools: increase Node heap if needed in your start script'
    ],
    severity: 'high'
  }
]

/**
 * Classifies a build error and returns user-friendly diagnostics.
 * 
 * @param {string} errorMessage - The raw error message
 * @param {string} phase - The build phase (extracting, validating, building, starting, health_check)
 * @param {string[]} logs - Recent log lines for context
 * @returns {{ category: string, friendlyMessage: string, suggestions: string[], severity: string }}
 */
export function classifyBuildError(errorMessage, phase = 'unknown', logs = []) {
  const combinedText = [errorMessage, ...logs.slice(-20)].join('\n')

  for (const pattern of ERROR_PATTERNS) {
    for (const regex of pattern.patterns) {
      if (regex.test(combinedText)) {
        return {
          category: pattern.category,
          friendlyMessage: pattern.friendlyMessage,
          suggestions: pattern.suggestions,
          severity: pattern.severity
        }
      }
    }
  }

  // Fallback: unknown error
  return {
    category: 'unknown_error',
    friendlyMessage: `❌ Sandbox Error during ${phase}: ${errorMessage}`,
    suggestions: [
      'Check the build logs for more details',
      'Ensure your project runs correctly on your local machine first',
      'Try re-uploading your project'
    ],
    severity: 'medium'
  }
}

/**
 * Formats a classified error into log-friendly lines.
 */
export function formatDiagnosticLog(diagnosis) {
  const lines = [
    '',
    '═══════════════════════════════════════════',
    diagnosis.friendlyMessage,
    '═══════════════════════════════════════════',
    '',
    '💡 Suggested Fixes:',
    ...diagnosis.suggestions.map((s, i) => `   ${i + 1}. ${s}`),
    '',
    `Category: ${diagnosis.category} | Severity: ${diagnosis.severity}`,
    ''
  ]
  return lines
}
