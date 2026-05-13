import Docker from 'dockerode'

const socketPath = process.platform === 'win32'
  ? '//./pipe/docker_engine'
  : process.env.DOCKER_SOCKET || '/var/run/docker.sock'

export const docker = new Docker({ socketPath })

export async function pingDocker() {
  try {
    await docker.ping()
    return { ok: true, socketPath }
  } catch (error) {
    return { ok: false, error: error.message, code: error.code, socketPath }
  }
}

