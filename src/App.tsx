import { useEffect, useRef, useState } from 'react'
import { Login } from '@/screens/Login'
import { ConsoleList } from '@/screens/ConsoleList'
import type { UserToken } from '../app/auth/devicecode'
import { buildAuthSession } from '../app/auth/xsts'
import type { AuthSession } from '../app/auth/xsts'
import { saveSession, getValidSession, getRefreshToken } from '../app/auth/persistence'
import { startSession, pollUntilProvisioned, startKeepalive } from '../app/streaming/session'
import type { SessionState, StreamSession } from '../app/streaming/session'
import { negotiate } from '../app/webrtc/negotiation'
import type { WebRTCResult } from '../app/webrtc/negotiation'
import { reconnect } from '../app/streaming/reconnect'
import { StreamView } from '@/screens/StreamView'

type ConnectionStatus = 'Conectando' | 'Activo' | 'Reconectando'
type ReconnectCause = 'freeze-webgpu' | 'freeze-video-fallback' | 'pc-failed' | 'keepalive'

type AppState =
  | { phase: 'loading' }
  | { phase: 'login' }
  | { phase: 'building' }
  | { phase: 'consoles'; session: AuthSession }
  | { phase: 'connecting'; session: AuthSession; consoleId: string; sessionState: SessionState }
  | { phase: 'negotiating-sdp'; session: AuthSession; consoleId: string; streamSession: StreamSession }
  | { phase: 'negotiating-ice'; session: AuthSession; consoleId: string; streamSession: StreamSession }
  | { phase: 'waiting-connection'; session: AuthSession; consoleId: string; streamSession: StreamSession }
  | {
      phase: 'streaming'
      session: AuthSession
      consoleId: string
      streamSession: StreamSession
      webrtc: WebRTCResult
      connectionStatus: ConnectionStatus
      reconnectCause?: ReconnectCause
      reconnectAttempt?: number
    }
  | { phase: 'error'; message: string }

export default function App() {
  const [state, setState] = useState<AppState>({ phase: 'loading' })
  const abortRef = useRef<AbortController | null>(null)
  const reconnectingRef = useRef(false)

  function reconnectDelayMs(attempt: number): number {
    return attempt <= 1 ? 500 : attempt === 2 ? 1500 : 3000
  }

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

    setState({ phase: 'connecting', session, consoleId, sessionState: 'Provisioning' })

    try {
      const streamSession = await startSession(session, consoleId)
      await pollUntilProvisioned(
        session,
        streamSession.sessionId,
        refreshToken,
        ac.signal,
        sessionState => setState({ phase: 'connecting', session, consoleId, sessionState }),
      )
      if (ac.signal.aborted) return

      setState({ phase: 'negotiating-sdp', session, consoleId, streamSession })

      const webrtc = await negotiate(
        session,
        streamSession,
        ac.signal,
        // Progress callbacks
        (phase) => {
          if (phase === 'ice-exchange') {
            setState({ phase: 'negotiating-ice', session, consoleId, streamSession })
          } else if (phase === 'waiting-tracks') {
            setState({ phase: 'waiting-connection', session, consoleId, streamSession })
          }
        }
      )
      if (ac.signal.aborted) return

      startKeepalive(session, streamSession.sessionId, ac.signal).catch(err => {
        if ((err as DOMException).name === 'AbortError') return
        console.error('[RECONNECT] keepalive failure', err)
        void handleStreamFrozen(session, streamSession, consoleId, webrtc, 'keepalive')
      })

      setState({
        phase: 'streaming',
        session,
        consoleId,
        streamSession,
        webrtc,
        connectionStatus: 'Activo',
      })
    } catch (err) {
      if (ac.signal.aborted) return
      if ((err as DOMException).name === 'AbortError') return
      setState({ phase: 'error', message: (err as Error).message })
    }
  }

  async function handleStreamFrozen(
    session: AuthSession,
    streamSession: StreamSession,
    consoleId: string,
    currentWebrtc: WebRTCResult,
    cause: ReconnectCause
  ) {
    if (reconnectingRef.current) return
    reconnectingRef.current = true

    const refreshToken = getRefreshToken()
    if (!refreshToken) {
      reconnectingRef.current = false
      setState({ phase: 'error', message: 'No refresh token — please log in again.' })
      return
    }

    abortRef.current?.abort()
    currentWebrtc.pc.close()

    const ac = new AbortController()
    abortRef.current = ac

    setState(prev => {
      if (prev.phase !== 'streaming') return prev
      return { ...prev, connectionStatus: 'Reconectando', reconnectCause: cause, reconnectAttempt: 1 }
    })

    try {
      let oldStreamSession: StreamSession | undefined = streamSession
      let lastError: unknown = null
      for (let attempt = 1; attempt <= 3; attempt++) {
        setState(prev => {
          if (prev.phase !== 'streaming') return prev
          return { ...prev, reconnectAttempt: attempt, reconnectCause: cause, connectionStatus: 'Reconectando' }
        })
        try {
          console.warn(`[RECONNECT] attempt ${attempt}/3 cause=${cause}`)
          const result = await reconnect({
            authSession: session,
            refreshToken,
            consoleId,
            oldStreamSession,
            signal: ac.signal,
          })
          if (ac.signal.aborted) return

          startKeepalive(session, result.streamSession.sessionId, ac.signal).catch(err => {
            if ((err as DOMException).name === 'AbortError') return
            console.error('[RECONNECT] keepalive failure', err)
            void handleStreamFrozen(session, result.streamSession, consoleId, result.webrtc, 'keepalive')
          })

          setState({
            phase: 'streaming',
            session,
            consoleId,
            streamSession: result.streamSession,
            webrtc: result.webrtc,
            connectionStatus: 'Activo',
          })
          return
        } catch (err) {
          lastError = err
          oldStreamSession = undefined
          if (ac.signal.aborted) return
          if ((err as DOMException).name === 'AbortError') return
          if (attempt < 3) {
            const delay = reconnectDelayMs(attempt)
            await new Promise<void>((resolve, reject) => {
              const timer = window.setTimeout(resolve, delay)
              ac.signal.addEventListener('abort', () => {
                window.clearTimeout(timer)
                reject(new DOMException('Aborted', 'AbortError'))
              }, { once: true })
            })
          }
        }
      }

      throw lastError instanceof Error ? lastError : new Error('Reconnect failed after 3 attempts')
    } catch (err) {
      if (ac.signal.aborted) return
      if ((err as DOMException).name === 'AbortError') return
      setState({ phase: 'error', message: `Reconnect (${cause}) failed: ${(err as Error).message}` })
    } finally {
      reconnectingRef.current = false
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

  if (state.phase === 'connecting' || state.phase === 'negotiating-sdp' || state.phase === 'negotiating-ice' || state.phase === 'waiting-connection') {
    const statusText = 
      state.phase === 'negotiating-sdp' ? 'Conectando (intercambiando SDP)…' :
      state.phase === 'negotiating-ice' ? 'Conectando (intercambiando ICE)…' :
      state.phase === 'waiting-connection' ? 'Conectando (esperando conexión)…' :
      `Conectando (${state.sessionState})…`
    
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">{statusText}</p>
      </div>
    )
  }

  // phase === 'streaming'
  return (
    <StreamView
      webrtc={state.webrtc}
      connectionStatus={state.connectionStatus}
      connectionDetail={
        state.connectionStatus === 'Reconectando'
          ? `${state.reconnectCause ?? 'unknown'}${state.reconnectAttempt ? ` (intento ${state.reconnectAttempt}/3)` : ''}`
          : undefined
      }
      onStreamFrozen={(cause) => {
        if (state.connectionStatus !== 'Activo') return
        console.warn(`[RECONNECT] trigger cause=${cause}`)
        void handleStreamFrozen(state.session, state.streamSession, state.consoleId, state.webrtc, cause)
      }}
    />
  )
}
