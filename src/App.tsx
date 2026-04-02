import { useEffect, useRef, useState } from 'react'
import { Login } from '@/screens/Login'
import { ConsoleList } from '@/screens/ConsoleList'
import type { UserToken } from '../app/auth/devicecode'
import { buildAuthSession } from '../app/auth/xsts'
import type { AuthSession } from '../app/auth/xsts'
import { saveSession, getValidSession, getRefreshToken } from '../app/auth/persistence'
import { startSession, pollUntilProvisioned } from '../app/streaming/session'
import type { SessionState, StreamSession } from '../app/streaming/session'

type AppState =
  | { phase: 'loading' }
  | { phase: 'login' }
  | { phase: 'building' }
  | { phase: 'consoles'; session: AuthSession }
  | { phase: 'connecting'; session: AuthSession; sessionState: SessionState }
  | { phase: 'streaming'; session: AuthSession; streamSession: StreamSession }
  | { phase: 'error'; message: string }

export default function App() {
  const [state, setState] = useState<AppState>({ phase: 'loading' })
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const ac = new AbortController()
    abortRef.current = ac

    getValidSession(ac.signal)
      .then(session => {
        if (ac.signal.aborted) return
        if (session) setState({ phase: 'consoles', session })
        else setState({ phase: 'login' })
      })
      .catch(err => {
        if (ac.signal.aborted) return
        if ((err as DOMException).name === 'AbortError') return
        setState({ phase: 'login' })
      })

    return () => ac.abort()
  }, [])

  async function handleAuthenticated(userToken: UserToken) {
    setState({ phase: 'building' })
    abortRef.current?.abort()

    try {
      const session = await buildAuthSession(userToken.access_token)
      saveSession(userToken, session)
      setState({ phase: 'consoles', session })
    } catch (err) {
      setState({ phase: 'error', message: (err as Error).message })
    }
  }

  async function handleConsoleSelected(session: AuthSession, consoleId: string) {
    const refreshToken = getRefreshToken()
    if (!refreshToken) {
      setState({ phase: 'error', message: 'No refresh token — please log in again.' })
      return
    }

    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac

    setState({ phase: 'connecting', session, sessionState: 'Provisioning' })

    try {
      const streamSession = await startSession(session, consoleId)
      await pollUntilProvisioned(
        session,
        streamSession.sessionId,
        refreshToken,
        ac.signal,
        sessionState => setState({ phase: 'connecting', session, sessionState }),
      )
      if (ac.signal.aborted) return
      setState({ phase: 'streaming', session, streamSession })
    } catch (err) {
      if (ac.signal.aborted) return
      if ((err as DOMException).name === 'AbortError') return
      setState({ phase: 'error', message: (err as Error).message })
    }
  }

  if (state.phase === 'loading' || state.phase === 'building') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">
          {state.phase === 'loading' ? 'Loading…' : 'Authenticating…'}
        </p>
      </div>
    )
  }

  if (state.phase === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-destructive">Error: {state.message}</p>
      </div>
    )
  }

  if (state.phase === 'login') {
    return <Login onAuthenticated={handleAuthenticated} />
  }

  if (state.phase === 'consoles') {
    return (
      <ConsoleList
        session={state.session}
        onSelect={consoleId => void handleConsoleSelected(state.session, consoleId)}
      />
    )
  }

  if (state.phase === 'connecting') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">{state.sessionState}…</p>
      </div>
    )
  }

  // phase === 'streaming' — placeholder for Fase 4
  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-sm text-muted-foreground">
        Provisioned ✓ — session {state.streamSession.sessionId}
      </p>
    </div>
  )
}
