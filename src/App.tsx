import { useEffect, useRef, useState } from 'react'
import { Login } from '@/screens/Login'
import { ConsoleList } from '@/screens/ConsoleList'
import type { UserToken } from '../app/auth/devicecode'
import { buildAuthSession } from '../app/auth/xsts'
import type { AuthSession } from '../app/auth/xsts'
import { saveSession, getValidSession } from '../app/auth/persistence'

type AppState =
  | { phase: 'loading' }
  | { phase: 'login' }
  | { phase: 'building' }
  | { phase: 'consoles'; session: AuthSession }
  | { phase: 'selected'; session: AuthSession; consoleId: string }
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
        onSelect={consoleId => setState({ phase: 'selected', session: state.session, consoleId })}
      />
    )
  }

  // phase === 'selected' — placeholder for Fase 3
  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-sm text-muted-foreground">Console selected: {state.consoleId}</p>
    </div>
  )
}
