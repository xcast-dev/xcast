import type { UserToken } from './devicecode'
import { refreshUserToken } from './devicecode'
import { buildAuthSession } from './xsts'
import type { AuthSession } from './xsts'

const STORAGE_KEY = 'xcast_session'

// 60 seconds threshold — refresh if less than this remains
const EXPIRY_THRESHOLD_MS = 60_000

interface PersistedState {
  userToken: {
    access_token:  string
    refresh_token: string
    expires_at:    number  // epoch ms
  }
  authSession: AuthSession
}

export function saveSession(userToken: UserToken, authSession: AuthSession): void {
  const state: PersistedState = {
    userToken: {
      access_token:  userToken.access_token,
      refresh_token: userToken.refresh_token,
      expires_at:    Date.now() + userToken.expires_in * 1000,
    },
    authSession,
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY)
}

export function getRefreshToken(): string | null {
  return loadState()?.userToken.refresh_token ?? null
}

function loadState(): PersistedState | null {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as PersistedState
  } catch {
    return null
  }
}

// Returns a valid AuthSession, refreshing tokens lazily if needed.
// Returns null if no session is stored.
export async function getValidSession(signal: AbortSignal): Promise<AuthSession | null> {
  const state = loadState()
  if (!state) return null

  // Token still valid — return cached session
  if (state.userToken.expires_at - Date.now() >= EXPIRY_THRESHOLD_MS) {
    return state.authSession
  }

  // Lazy refresh
  const refreshed = await refreshUserToken(state.userToken.refresh_token, signal)
  const authSession = await buildAuthSession(refreshed.access_token)
  saveSession(refreshed, authSession)
  return authSession
}
