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
  while (true) {
    await sleep(interval * 1000, signal)

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

    const data = await res.json() as Record<string, string>

    if (data['error'] === 'authorization_pending') continue
    if (data['access_token']) return data as unknown as UserToken
    throw new Error(data['error'] ?? 'Unknown error')
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
