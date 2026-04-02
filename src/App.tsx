import { useEffect, useRef, useState } from 'react'
import { Login } from '@/screens/Login'
import type { UserToken } from '../app/auth/devicecode'
import { buildAuthSession } from '../app/auth/xsts'
import type { AuthSession } from '../app/auth/xsts'
import { saveSession, getValidSession } from '../app/auth/persistence'

type AppState =
  | { phase: 'loading' }
  | { phase: 'login' }
  | { phase: 'building' }
  | { phase: 'ready'; session: AuthSession }
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
        if (session) setState({ phase: 'ready', session })
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
      setState({ phase: 'ready', session })
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

  // phase === 'ready'
  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-sm text-muted-foreground">Authenticated ✓</p>
    </div>
  )
}
