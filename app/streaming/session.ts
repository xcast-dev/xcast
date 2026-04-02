import type { AuthSession } from '../auth/xsts'

const SERVER = 'http://localhost:1209'

export type SessionState = 'Provisioning' | 'ReadyToConnect' | 'Provisioned' | 'Failed'

export interface StreamSession {
  sessionId:   string
  sessionPath: string
}

interface StateResponse {
  state:         SessionState
  errorDetails?: string
}

async function getPurposeToken(refreshToken: string): Promise<string> {
  const res = await fetch(`${SERVER}/auth/purpose`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ refreshToken }),
  })
  if (!res.ok) throw new Error(`Purpose token failed: ${res.status}`)
  const data = await res.json() as { access_token: string }
  return data.access_token
}

export async function startSession(
  session: AuthSession,
  serverId: string
): Promise<StreamSession> {
  const res = await fetch(`${SERVER}/streaming/play`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ baseUri: session.baseUri, gsToken: session.gsToken, serverId }),
  })
  if (!res.ok) throw new Error(`startSession failed: ${res.status}`)
  return res.json() as Promise<StreamSession>
}

// Polls /state every 1s, handles ReadyToConnect → connect, resolves on Provisioned.
export async function pollUntilProvisioned(
  session:       AuthSession,
  sessionId:     string,
  refreshToken:  string,
  signal:        AbortSignal,
  onStateChange?: (state: SessionState) => void
): Promise<void> {
  let connected = false

  while (!signal.aborted) {
    const res = await fetch(`${SERVER}/streaming/${sessionId}/state`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ baseUri: session.baseUri, gsToken: session.gsToken }),
      signal,
    })
    if (!res.ok) throw new Error(`state poll failed: ${res.status}`)
    const { state, errorDetails } = await res.json() as StateResponse

    onStateChange?.(state)

    if (state === 'Failed') {
      throw new Error(`Session failed: ${errorDetails ?? 'unknown'}`)
    }

    if (state === 'ReadyToConnect' && !connected) {
      connected = true
      const purposeToken = await getPurposeToken(refreshToken)
      const connectRes = await fetch(`${SERVER}/streaming/${sessionId}/connect`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ baseUri: session.baseUri, gsToken: session.gsToken, userToken: purposeToken }),
        signal,
      })
      if (!connectRes.ok) throw new Error(`connect failed: ${connectRes.status}`)
    }

    if (state === 'Provisioned') return

    await sleep(1000, signal)
  }
}

// Sends keepalive every 30s until signal is aborted. Throws on server error.
export async function startKeepalive(
  session:   AuthSession,
  sessionId: string,
  signal:    AbortSignal
): Promise<void> {
  while (!signal.aborted) {
    await sleep(30_000, signal)
    if (signal.aborted) return
    const res = await fetch(`${SERVER}/streaming/${sessionId}/keepalive`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ baseUri: session.baseUri, gsToken: session.gsToken }),
      signal,
    })
    if (!res.ok) throw new Error(`keepalive failed: ${res.status}`)
  }
}

export async function deleteSession(session: AuthSession, sessionId: string): Promise<void> {
  await fetch(`${SERVER}/streaming/${sessionId}`, {
    method:  'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ baseUri: session.baseUri, gsToken: session.gsToken }),
  })
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }, { once: true })
  })
}
