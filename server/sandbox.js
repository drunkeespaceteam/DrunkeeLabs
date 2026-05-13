import fs from 'fs'
import fsPromises from 'fs/promises'
import path from 'path'
import unzipper from 'unzipper'
import yaml from 'js-yaml'
import { docker } from './dockerClient.js'

// ─── FILE VALIDATION CONSTANTS ───
const MAX_FILE_COUNT = 500
const MAX_EXTRACTED_SIZE = 100 * 1024 * 1024 // 100MB
const BLOCKED_EXTENSIONS = new Set(['.exe', '.bat', '.cmd', '.ps1', '.com', '.msi', '.dll', '.sh'])
const MAX_NESTING_DEPTH = 3

/**
 * Validates and safely extracts a zip file to a target directory.
 * Enforces file count, size, nesting, and blocked extension rules.
 */
export async function extractZipSafe(zipPath, targetDir) {
  await fsPromises.mkdir(targetDir, { recursive: true })
  
  let fileCount = 0
  let totalSize = 0

  // Verify file exists before attempting extraction
  try {
    await fsPromises.access(zipPath)
  } catch {
    throw new Error(`ZIP file not found at ${zipPath}`)
  }

  return new Promise((resolve, reject) => {
    const readStream = fs.createReadStream(zipPath)
    readStream.on('error', (err) => reject(new Error(`Failed to read ZIP: ${err.message}`)))
    readStream
      .pipe(unzipper.Parse())
      .on('entry', async function (entry) {
        const fileName = entry.path
        const type = entry.type
        
        // Prevent path traversal
        const resolvedPath = path.join(targetDir, fileName)
        if (!resolvedPath.startsWith(path.resolve(targetDir))) {
          entry.autodrain()
          return
        }

        // Check nesting depth
        const depth = fileName.split(/[\\/]/).length
        if (depth > MAX_NESTING_DEPTH) {
          entry.autodrain()
          return
        }

        // Block dangerous file extensions
        const ext = path.extname(fileName).toLowerCase()

        // Prevent zip bombs / multi-stage archives
        if (ext === '.zip') {
          entry.autodrain()
          reject(new Error('Nested .zip files are not allowed (zip bombs protection).'))
          return
        }

        if (BLOCKED_EXTENSIONS.has(ext)) {
          entry.autodrain()
          return
        }

        // File count limit
        fileCount++
        if (fileCount > MAX_FILE_COUNT) {
          entry.autodrain()
          reject(new Error(`Too many files in archive (max ${MAX_FILE_COUNT}). Reduce your project size.`))
          return
        }

        if (type === 'Directory') {
          await fsPromises.mkdir(resolvedPath, { recursive: true })
          entry.autodrain()
        } else {
          await fsPromises.mkdir(path.dirname(resolvedPath), { recursive: true })
          
          // Track extracted size
          const writeStream = fs.createWriteStream(resolvedPath)
          entry.on('data', (chunk) => {
            totalSize += chunk.length
            if (totalSize > MAX_EXTRACTED_SIZE) {
              writeStream.destroy()
              reject(new Error(`Extracted size exceeds ${MAX_EXTRACTED_SIZE / 1024 / 1024}MB limit. Possible zip bomb detected.`))
            }
          })
          entry.pipe(writeStream)
        }
      })
      .on('close', resolve)
      .on('error', reject)
  })
}

/**
 * Normalizes text encoding in HTML/CSS/JS files to ensure valid UTF-8.
 * Adds charset meta tag to HTML files that lack one — prevents browsers
 * from misinterpreting UTF-8 bytes as Latin-1 (garbled emoji/special chars).
 */
export async function normalizeProjectEncoding(targetDir) {
  try {
    const allFiles = await getAllProjectFiles(targetDir)
    for (const file of allFiles) {
      const ext = path.extname(file).toLowerCase()
      if (!['.html', '.htm'].includes(ext)) continue
      try {
        const content = await fsPromises.readFile(file, 'utf8')
        const hasCharset = /charset\s*=/i.test(content)
        if (!hasCharset) {
          const fixed = content.replace(/(<head[^>]*>)/i, '$1\n  <meta charset="utf-8">')
          await fsPromises.writeFile(file, fixed, 'utf8')
        }
      } catch {
        // Skip binary or unreadable files
      }
    }
  } catch {
    // Non-fatal — encoding normalization is best-effort
  }
}

async function getAllProjectFiles(dir) {
  const result = []
  try {
    const entries = await fsPromises.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) result.push(...await getAllProjectFiles(full))
      else result.push(full)
    }
  } catch {}
  return result
}

/**
 * Reads and parses run.yaml if present.
 * Returns { runtime, install, start, port } or null.
 */
async function parseRunYaml(targetDir) {
  const yamlPath = path.join(targetDir, 'run.yaml')
  const ymlPath = path.join(targetDir, 'run.yml')
  
  let configPath = null
  if (fs.existsSync(yamlPath)) configPath = yamlPath
  else if (fs.existsSync(ymlPath)) configPath = ymlPath
  
  if (!configPath) return null

  try {
    const raw = await fsPromises.readFile(configPath, 'utf-8')
    const config = yaml.load(raw)
    return {
      runtime: config.runtime || 'node',
      install: config.install || null,
      start: config.start || null,
      port: config.port || 3000
    }
  } catch (err) {
    console.error('[run.yaml] Parse error:', err.message)
    return null
  }
}

/**
 * Flattens nested ZIP structures (user zipped a folder instead of contents).
 */
async function flattenSingleFolder(targetDir) {
  let files = await fsPromises.readdir(targetDir)
  const visibleFiles = files.filter(f => !f.startsWith('.') && f !== '__MACOSX')
  
  if (visibleFiles.length === 1) {
    const singleItemPath = path.join(targetDir, visibleFiles[0])
    const stat = await fsPromises.stat(singleItemPath)
    if (stat.isDirectory()) {
      const innerFiles = await fsPromises.readdir(singleItemPath)
      for (const innerFile of innerFiles) {
        await fsPromises.rename(
          path.join(singleItemPath, innerFile),
          path.join(targetDir, innerFile)
        )
      }
      await fsPromises.rmdir(singleItemPath)
    }
  }
  
  return await fsPromises.readdir(targetDir)
}

/**
 * Detects the project type, generates Dockerfile, and returns runtime info.
 * Priority: run.yaml → Dockerfile → auto-detect
 * Returns { type, port }
 */
export async function prepareProject(targetDir, submissionId) {
  let files = await flattenSingleFolder(targetDir)
  
  // ─── 1. run.yaml takes highest priority ───
  const runConfig = await parseRunYaml(targetDir)
  if (runConfig) {
    const port = runConfig.port || 3000
    const baseImage = getBaseImage(runConfig.runtime)
    
    let dockerfileContent = `FROM ${baseImage}\nWORKDIR /app\nCOPY . .\n`
    if (runConfig.install) {
      dockerfileContent += `RUN ${runConfig.install}\n`
    }
    dockerfileContent += `ENV PORT=${port}\nENV HOST=0.0.0.0\nEXPOSE ${port}\n`
    dockerfileContent += `CMD ${JSON.stringify(runConfig.start.split(/\s+/))}\n`
    
    await fsPromises.writeFile(path.join(targetDir, 'Dockerfile'), dockerfileContent)
    return { type: `custom (${runConfig.runtime})`, port }
  }

  // ─── 2. User-provided Dockerfile ───
  if (files.includes('Dockerfile')) {
    const port = await parsePortFromDockerfile(targetDir)
    return { type: 'docker', port: port || 3000 }
  }
  
  // ─── 3. Auto-detect from package.json ───
  if (files.includes('package.json')) {
    return await prepareNodeProject(targetDir, files, submissionId)
  }
  
  // ─── 4. Python (Unsupported) ───
  if (files.includes('requirements.txt')) {
    throw new Error('Unsupported project type. Python ML, multi-server apps, and databases are currently not supported.')
  }
  
  // ─── 5. Static HTML ───
  if (files.includes('index.html')) {
    const port = 3000
    const nginxConf = `server {
    listen ${port};
    server_name localhost;
    root /usr/share/nginx/html;
    index index.html;
    location / {
        try_files $uri $uri/ /index.html;
    }
}
`
    await fsPromises.writeFile(path.join(targetDir, 'nginx.conf'), nginxConf)
    const dockerfile = `FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY . /usr/share/nginx/html
EXPOSE ${port}
`
    await fsPromises.writeFile(path.join(targetDir, 'Dockerfile'), dockerfile)
    return { type: 'static', port }
  }
  
  throw new Error('Unsupported project structure. Include a Dockerfile, package.json, requirements.txt, index.html, or run.yaml')
}

/**
 * Parse EXPOSE port from an existing Dockerfile.
 */
async function parsePortFromDockerfile(targetDir) {
  try {
    const content = await fsPromises.readFile(path.join(targetDir, 'Dockerfile'), 'utf-8')
    const match = content.match(/EXPOSE\s+(\d+)/i)
    return match ? parseInt(match[1], 10) : null
  } catch {
    return null
  }
}

/**
 * Get base Docker image for a runtime string.
 */
function getBaseImage(runtime) {
  const supported = {
    node: 'node:18-alpine',
    static: 'nginx:alpine'
  }
  
  if (!supported[runtime]) {
    throw new Error('Unsupported project type. Only Node.js and Static HTML apps are supported.')
  }
  
  return supported[runtime]
}

/**
 * Prepare a Node.js project (auto-detect Vite, Next.js, generic).
 * Detects package manager (npm/yarn/pnpm) via lockfiles.
 */
async function prepareNodeProject(targetDir, files, submissionId) {
  const pkgRaw = await fsPromises.readFile(path.join(targetDir, 'package.json'), 'utf-8')
  const pkg = JSON.parse(pkgRaw)
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }
  const port = 3000

  // ─── Smart Package Manager Detection ───
  let pkgManager = 'npm'
  let installCmd = 'npm install'
  let copyLock = 'COPY package*.json ./'
  if (files.includes('pnpm-lock.yaml')) {
    pkgManager = 'pnpm'
    installCmd = 'corepack enable && pnpm install --frozen-lockfile || pnpm install'
    copyLock = 'COPY package.json pnpm-lock.yaml ./'
  } else if (files.includes('yarn.lock')) {
    pkgManager = 'yarn'
    installCmd = 'corepack enable && yarn install --frozen-lockfile || yarn install'
    copyLock = 'COPY package.json yarn.lock ./'
  }

  // ── Vite detection ──
  const isVite = files.includes('vite.config.js') || files.includes('vite.config.ts') || allDeps['vite']
  if (isVite) {
    pkg.scripts = pkg.scripts || {}
    pkg.scripts.dev = `vite --host 0.0.0.0 --port ${port}`
    
    // Add React plugin if missing
    if (allDeps['react'] && !allDeps['@vitejs/plugin-react']) {
      pkg.devDependencies = pkg.devDependencies || {}
      pkg.devDependencies['@vitejs/plugin-react'] = '^4.0.0'
    }
    await fsPromises.writeFile(path.join(targetDir, 'package.json'), JSON.stringify(pkg, null, 2))

    // ─── ALWAYS override vite.config.js for sandbox isolation ───
    // 1. Disables HMR to prevent WebSocket connections back to parent platform.
    // 2. Sets 'base' so assets load correctly through the /preview/:id proxy route.
    const hasReact = !!allDeps['react']
    const basePath = submissionId ? `/preview/${submissionId}/` : '/'
    const viteConfig = hasReact
      ? `import { defineConfig } from 'vite'\nimport react from '@vitejs/plugin-react'\nexport default defineConfig({\n  base: '${basePath}',\n  plugins: [react()],\n  server: {\n    host: '0.0.0.0',\n    port: ${port},\n    hmr: false,\n    watch: { usePolling: false }\n  },\n  build: { sourcemap: false }\n})\n`
      : `import { defineConfig } from 'vite'\nexport default defineConfig({\n  base: '${basePath}',\n  server: {\n    host: '0.0.0.0',\n    port: ${port},\n    hmr: false,\n    watch: { usePolling: false }\n  },\n  build: { sourcemap: false }\n})\n`
    await fsPromises.writeFile(path.join(targetDir, 'vite.config.js'), viteConfig)
    // Remove .ts variant to avoid conflicts
    await fsPromises.rm(path.join(targetDir, 'vite.config.ts'), { force: true }).catch(() => {})

    const dockerfile = `FROM node:18-alpine
WORKDIR /app
${copyLock}
RUN ${installCmd}
COPY . .
EXPOSE ${port}
CMD ["${pkgManager}", "run", "dev"]
`
    await fsPromises.writeFile(path.join(targetDir, 'Dockerfile'), dockerfile)
    return { type: 'vite', port, pkgManager }
  }

  // ── Next.js detection ──
  if (allDeps['next']) {
    pkg.scripts = pkg.scripts || {}
    pkg.scripts.dev = `next dev -p ${port}`
    await fsPromises.writeFile(path.join(targetDir, 'package.json'), JSON.stringify(pkg, null, 2))
    
    const dockerfile = `FROM node:18-alpine
WORKDIR /app
${copyLock}
RUN ${installCmd}
COPY . .
EXPOSE ${port}
CMD ["${pkgManager}", "run", "dev"]
`
    await fsPromises.writeFile(path.join(targetDir, 'Dockerfile'), dockerfile)
    return { type: 'next', port, pkgManager }
  }

  // ── Generic Node.js ──
  const dockerfile = `FROM node:18-alpine
WORKDIR /app
${copyLock}
RUN ${installCmd}
COPY . .
ENV PORT=${port}
ENV HOST=0.0.0.0
EXPOSE ${port}
CMD ["${pkgManager}", "start"]
`
  await fsPromises.writeFile(path.join(targetDir, 'Dockerfile'), dockerfile)
  return { type: 'node', port, pkgManager }
}

const MAX_BUILD_TIME_MS = 120 * 1000 // 120 seconds

/**
 * Builds the Docker image from a directory.
 * Enforces a 120-second timeout to prevent infinite builds.
 */
export async function buildImage(targetDir, tag, logCallback) {
  const allFiles = await getAllFiles(targetDir, targetDir)

  const pack = await docker.buildImage({
    context: targetDir,
    src: allFiles
  }, { t: tag })

  return new Promise((resolve, reject) => {
    const buildTimeout = setTimeout(() => {
      reject(new Error(`Docker build exceeded ${MAX_BUILD_TIME_MS / 1000}s timeout`))
    }, MAX_BUILD_TIME_MS)

    docker.modem.followProgress(pack, (err, res) => {
      clearTimeout(buildTimeout)
      err ? reject(err) : resolve(res)
    }, (evt) => {
      if (evt.stream && logCallback) {
        logCallback(evt.stream)
      }
      if (evt.error) {
        clearTimeout(buildTimeout)
        reject(new Error(evt.error))
      }
    })
  })
}

/**
 * Recursively get all file paths relative to baseDir.
 */
async function getAllFiles(dir, baseDir) {
  const entries = await fsPromises.readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    const relativePath = path.relative(baseDir, fullPath)
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    if (entry.isDirectory()) {
      const subFiles = await getAllFiles(fullPath, baseDir)
      files.push(...subFiles)
    } else {
      files.push(relativePath)
    }
  }
  return files
}

/**
 * Remove employee/mentor-preview Docker containers for this submission.
 * Skips mentor *revision* sandboxes (names contain `-rev-`) so isolated review tests
 * never tear down the employee preview container and vice versa.
 */
export async function removeOldContainersForSubmission(submissionId) {
  try {
    const allContainers = await docker.listContainers({ all: true })
    for (const c of allContainers) {
      if (c.Names.some(n => {
        const name = (n || '').replace(/^\//, '')
        return name.includes(`submission-${submissionId}`) && !name.includes('-rev-')
      })) {
        await docker.getContainer(c.Id).stop({ t: 3 }).catch(() => {})
        await docker.getContainer(c.Id).remove({ force: true }).catch(() => {})
      }
    }
  } catch {
    // Ignore errors — container may already be gone
  }
}

/**
 * Remove only mentor-review-test containers for a specific revision.
 */
export async function removeOldReviewContainersForRevision(submissionId, revision) {
  const rev = Number(revision)
  const prefix = `submission-${submissionId}-rev-${rev}-`
  try {
    const allContainers = await docker.listContainers({ all: true })
    for (const c of allContainers) {
      if (c.Names.some(n => (n || '').replace(/^\//, '').startsWith(prefix))) {
        await docker.getContainer(c.Id).stop({ t: 3 }).catch(() => {})
        await docker.getContainer(c.Id).remove({ force: true }).catch(() => {})
      }
    }
  } catch {
    // ignore
  }
}

/**
 * Check if a Docker image already exists locally.
 */
export async function imageExists(imageTag) {
  try {
    await docker.getImage(imageTag).inspect()
    return true
  } catch {
    return false
  }
}

/**
 * Starts a container with the given image, port mapping, and security constraints.
 */
export async function runContainer(imageTag, containerName, hostPort, internalPort = 3000, labels = {}) {
  // Force-remove any existing container with the same name to prevent
  // Docker name-conflict crashes on BullMQ retries.
  try {
    const old = docker.getContainer(containerName)
    const info = await old.inspect()
    if (info) {
      await old.stop({ t: 3 }).catch(() => {})
      await old.remove({ force: true }).catch(() => {})
    }
  } catch {
    // Expected when container does not exist
  }

  const portKey = `${internalPort}/tcp`

  const container = await docker.createContainer({
    Image: imageTag,
    name: containerName,
    Labels: {
      'nexusdev.managed': 'true',
      ...labels
    },
    ExposedPorts: {
      [portKey]: {}
    },
    HostConfig: {
      PortBindings: {
        [portKey]: [{ HostPort: hostPort.toString() }]
      },
      Memory: 512 * 1024 * 1024,      // 512MB
      CpuShares: 512,                   // ~0.5 CPU
      NetworkMode: 'bridge',
      // Production hardening: keep root FS read-only.
      // We mount ephemeral writable tmpfs for typical runtime write paths used by Node/Next/Vite.
      ReadonlyRootfs: true,
      PidsLimit: 50,
      Tmpfs: {
        '/tmp': 'rw,noexec,nosuid,size=256m',
        '/app/.next': 'rw,noexec,nosuid,size=512m',
        '/app/node_modules/.vite': 'rw,noexec,nosuid,size=512m',
        '/app/node_modules/.cache': 'rw,noexec,nosuid,size=512m',
        '/var/cache/nginx': 'rw,noexec,nosuid,size=64m',
        '/var/run': 'rw,noexec,nosuid,size=16m',
        '/var/log/nginx': 'rw,noexec,nosuid,size=32m'
      },
      Privileged: false,                // Never run privileged
      CapDrop: ['ALL'],                 // Drop all Linux capabilities
      CapAdd: ['CHOWN', 'SETUID', 'SETGID', 'NET_BIND_SERVICE'] // Add only needed ones
    }
  })
  
  await container.start()
  return container
}
