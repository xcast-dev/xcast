import type { AuthSession } from '../auth/xsts'

const SERVER = 'http://localhost:1209'

export type SessionState = 'Provisioning' | 'ReadyToConnect' | 'Provisioned' | 'Failed'

export interface StreamSession {
  sessionId:   string
  sessionPath: string
}

interface StateResponse {
  state:         SessionState
  errorDetails?: unknown
}

const PROVISIONING_TIMEOUT_MS = 180_000
const TRANSIENT_WNS_MAX_RETRIES = 8

function describeErrorDetails(errorDetails: unknown): string {
  if (typeof errorDetails === 'string') return errorDetails
  if (errorDetails == null) return 'unknown'
  try {
    return JSON.stringify(errorDetails)
  } catch {
    return String(errorDetails)
  }
}

function isTransientWnsRegistrationError(errorDetails: unknown): boolean {
  if (!errorDetails || typeof errorDetails !== 'object') return false
  const value = errorDetails as { code?: unknown; message?: unknown }
  return (
    value.code === 'WNSError' &&
    typeof value.message === 'string' &&
    value.message.includes('WaitingForServerToRegister')
  )
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
  const startedAt = Date.now()
  let transientWnsFailures = 0
  let lastFailureDetail = ''

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
    console.log('[SESSION] Current state:', state)

    if (state === 'Failed') {
      const failureText = describeErrorDetails(errorDetails)
      lastFailureDetail = failureText
      if (isTransientWnsRegistrationError(errorDetails) && transientWnsFailures < TRANSIENT_WNS_MAX_RETRIES) {
        transientWnsFailures += 1
        console.warn(
          `[SESSION] transient WNS registration error (${transientWnsFailures}/${TRANSIENT_WNS_MAX_RETRIES}) — waiting and retrying`
        )
        await sleep(2000, signal)
        continue
      }
      throw new Error(`Session failed: ${failureText}`)
    }

    transientWnsFailures = 0

    if (state === 'ReadyToConnect' && !connected) {
      connected = true
      console.log('[SESSION] Fetching purpose token...')
      const purposeToken = await getPurposeToken(refreshToken)
      console.log('[SESSION] Calling /connect with purpose token...')
      const connectRes = await fetch(`${SERVER}/streaming/${sessionId}/connect`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ baseUri: session.baseUri, gsToken: session.gsToken, userToken: purposeToken }),
        signal,
      })
      if (!connectRes.ok) throw new Error(`connect failed: ${connectRes.status}`)
    }

    if (state === 'Provisioned') {
      // Workaround: some Xbox consoles skip ReadyToConnect and go straight to Provisioned
      // Send purpose token here if we haven't already
      if (!connected) {
        console.log('[SESSION] Provisioned without ReadyToConnect - sending purpose token now')
        const purposeToken = await getPurposeToken(refreshToken)
        const connectRes = await fetch(`${SERVER}/streaming/${sessionId}/connect`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ baseUri: session.baseUri, gsToken: session.gsToken, userToken: purposeToken }),
          signal,
        })
        if (!connectRes.ok) console.warn('[SESSION] connect failed but continuing:', connectRes.status)
        connected = true
        
        // Give console time to process authorization before WebRTC negotiation
        console.log('[SESSION] Waiting 2s for console to process authorization...')
        await sleep(2000, signal)
      }
      return
    }

    if (Date.now() - startedAt > PROVISIONING_TIMEOUT_MS) {
      const suffix = lastFailureDetail ? ` | last failure: ${lastFailureDetail}` : ''
      throw new Error(
        `Session provisioning timeout after ${Math.round(PROVISIONING_TIMEOUT_MS / 1000)}s (last state: ${state})${suffix}`
      )
    }

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
