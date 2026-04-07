// Client ID sourced from xal-node (https://github.com/unknownskl/xal-node/blob/main/src/msal.ts)
// This is an unofficial Microsoft client ID used by the Xbox open source community.
// No public documentation exists for it — Microsoft requires ID@Xbox partnership for official access.
const CLIENT_ID = '1f907974-e22b-4810-a9de-d9647380c97e'
const SCOPES    = 'xboxlive.signin openid profile offline_access'

// Auth calls go through a local Fastify server (server/index.ts) to avoid browser CORS restrictions.
// In Electron, this will move to the main process (Node.js) where CORS does not apply.
const SERVER = 'http://localhost:1209'

export interface DeviceCodeResponse {
  device_code:      string
  user_code:        string
  verification_uri: string
  expires_in:       number
  interval:         number
}

export interface UserToken {
  access_token:  string
  refresh_token: string
  expires_in:    number
}

export async function requestDeviceCode(signal: AbortSignal): Promise<DeviceCodeResponse> {
  const res = await fetch(
    `${SERVER}/auth/devicecode`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: CLIENT_ID, scope: SCOPES }),
      signal,
    }
  )
  if (!res.ok) throw new Error(`Device code request failed: ${res.status}`)
  return res.json() as Promise<DeviceCodeResponse>
}

export async function pollForToken(
  deviceCode: string,
  interval: number,
  signal: AbortSignal
): Promise<UserToken> {
  let pollDelayMs = Math.max(1, interval) * 1000

  while (true) {
    await sleep(pollDelayMs, signal)

    const res = await fetch(
      `${SERVER}/auth/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type:  'urn:ietf:params:oauth:grant-type:device_code',
          device_code: deviceCode,
          client_id:   CLIENT_ID,
        }),
        signal,
      }
    )

    const data = await res.json() as Record<string, unknown>
    const error = typeof data.error === 'string' ? data.error : undefined
    const errorDescription = typeof data.error_description === 'string' ? data.error_description : undefined

    if (error === 'authorization_pending') continue
    if (error === 'slow_down') {
      pollDelayMs += 5000
      continue
    }
    if (error === 'authorization_declined') {
      throw new Error('Autorización cancelada en Microsoft. Intenta de nuevo.')
    }
    if (error === 'expired_token' || error === 'bad_verification_code') {
      throw new Error('El código expiró o ya no es válido. Solicita uno nuevo.')
    }
    if (typeof data.access_token === 'string' && typeof data.refresh_token === 'string') {
      return data as unknown as UserToken
    }
    throw new Error(errorDescription ?? error ?? 'Unknown error')
  }
}

export async function refreshUserToken(
  refreshToken: string,
  signal: AbortSignal
): Promise<UserToken> {
  const res = await fetch(
    `${SERVER}/auth/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'refresh_token',
        refresh_token: refreshToken,
        client_id:     CLIENT_ID,
        scope:         SCOPES,
      }),
      signal,
    }
  )
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`)
  return res.json() as Promise<UserToken>
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
