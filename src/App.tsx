import { useEffect, useRef, useState } from 'react'
import { toast, Toaster } from 'sonner'
import { Login } from '@/screens/Login'
import { ConsoleList } from '@/screens/ConsoleList'
import { Settings } from '@/screens/Settings'
import { Loader2, AlertCircle, Home } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { XboxBootLogo } from '@/components/XboxBootLogo'
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
type ReconnectCause = 'pc-failed' | 'keepalive' | 'context-resume' | 'online-resume'

type AppState =
  | { phase: 'loading' }
  | { phase: 'login' }
  | { phase: 'building' }
  | { phase: 'consoles'; session: AuthSession }
  | { phase: 'settings'; session: AuthSession }
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
  const [isForegroundActive, setIsForegroundActive] = useState(() => document.visibilityState === 'visible' && document.hasFocus())

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

          toast.success('Reconexión exitosa', {
            description: `Intento ${attempt}/3 completado`
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

  useEffect(() => {
    const syncForeground = () => {
      setIsForegroundActive(document.visibilityState === 'visible' && document.hasFocus())
    }
    document.addEventListener('visibilitychange', syncForeground)
    window.addEventListener('focus', syncForeground)
    window.addEventListener('blur', syncForeground)
    return () => {
      document.removeEventListener('visibilitychange', syncForeground)
      window.removeEventListener('focus', syncForeground)
      window.removeEventListener('blur', syncForeground)
    }
  }, [])

  useEffect(() => {
    if (state.phase !== 'streaming') return
    const { session, streamSession, consoleId, webrtc, connectionStatus } = state

    let shouldReconnectAfterResume = false
    let offlineDetected = false
    let disconnectedTimer = 0

    const triggerReconnect = (cause: ReconnectCause) => {
      if (reconnectingRef.current) return
      if (connectionStatus !== 'Activo') return
      console.warn(`[RECONNECT] trigger cause=${cause}`)
      void handleStreamFrozen(session, streamSession, consoleId, webrtc, cause)
    }

    const maybeReconnectOnResume = () => {
      if (!shouldReconnectAfterResume) return
      shouldReconnectAfterResume = false
      if (!navigator.onLine) return
      const connectionState = webrtc.pc.connectionState
      if (
        connectionState === 'failed' ||
        connectionState === 'disconnected' ||
        connectionState === 'closed'
      ) {
        triggerReconnect('context-resume')
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        shouldReconnectAfterResume = true
        return
      }
      maybeReconnectOnResume()
    }

    const onBlur = () => {
      shouldReconnectAfterResume = true
    }

    const onFocus = () => {
      if (document.visibilityState !== 'visible') return
      maybeReconnectOnResume()
    }

    const onOffline = () => {
      offlineDetected = true
      toast.error('Conexión perdida', {
        description: 'Se perdió la conexión a internet'
      })
    }

    const onOnline = () => {
      if (!offlineDetected) return
      offlineDetected = false
      toast.success('Conexión restaurada', {
        description: 'Reconectando al stream…'
      })
      if (document.visibilityState === 'visible' && document.hasFocus()) {
        triggerReconnect('online-resume')
      } else {
        shouldReconnectAfterResume = true
      }
    }

    const onConnectionStateChange = () => {
      if (webrtc.pc.connectionState === 'failed') {
        triggerReconnect('pc-failed')
        return
      }
      if (webrtc.pc.connectionState === 'disconnected') {
        if (disconnectedTimer) window.clearTimeout(disconnectedTimer)
        disconnectedTimer = window.setTimeout(() => {
          if (webrtc.pc.connectionState === 'disconnected') triggerReconnect('pc-failed')
        }, 5000)
        return
      }
      if (disconnectedTimer) {
        window.clearTimeout(disconnectedTimer)
        disconnectedTimer = 0
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    window.addEventListener('offline', onOffline)
    window.addEventListener('online', onOnline)
    webrtc.pc.addEventListener('connectionstatechange', onConnectionStateChange)

    return () => {
      if (disconnectedTimer) window.clearTimeout(disconnectedTimer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('online', onOnline)
      webrtc.pc.removeEventListener('connectionstatechange', onConnectionStateChange)
    }
  }, [
    state.phase,
    state.phase === 'streaming' ? state.session : null,
    state.phase === 'streaming' ? state.streamSession : null,
    state.phase === 'streaming' ? state.consoleId : null,
    state.phase === 'streaming' ? state.webrtc : null,
    state.phase === 'streaming' ? state.connectionStatus : null,
  ])

  return (
    <>
      <Toaster position="top-right" richColors />
      {state.phase === 'loading' || state.phase === 'building' ? (
        <div className="flex min-h-screen items-center justify-center p-8">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                {state.phase === 'loading' ? 'Cargando' : 'Autenticando'}
              </CardTitle>
              <CardDescription>
                {state.phase === 'loading' 
                  ? 'Verificando sesión guardada…' 
                  : 'Construyendo sesión de autenticación…'}
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      ) : state.phase === 'error' ? (
        <div className="flex min-h-screen items-center justify-center p-8">
          <Card className="w-full max-w-md border-destructive">
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                <AlertCircle className="h-5 w-5 text-destructive" />
                Error de conexión
              </CardTitle>
              <CardDescription>No se pudo establecer la conexión</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{state.message}</AlertDescription>
              </Alert>
              <Button onClick={() => setState({ phase: 'login' })} className="w-full gap-2">
                <Home className="h-4 w-4" />
                Volver al inicio
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : state.phase === 'login' ? (
        <Login onAuthenticated={handleAuthenticated} />
      ) : state.phase === 'consoles' ? (
        <ConsoleList
          session={state.session}
          onSelect={consoleId => void handleConsoleSelected(state.session, consoleId)}
          onSettings={() => setState({ phase: 'settings', session: state.session })}
          onLogout={() => {
            abortRef.current?.abort()
            localStorage.removeItem('xcast_session')
            setState({ phase: 'login' })
          }}
        />
      ) : state.phase === 'settings' ? (
        <Settings onBack={() => setState({ phase: 'consoles', session: state.session })} />
      ) : state.phase === 'connecting' || state.phase === 'negotiating-sdp' || state.phase === 'negotiating-ice' || state.phase === 'waiting-connection' ? (
        (() => {
          const statusText = 
            state.phase === 'negotiating-sdp' ? 'Intercambiando SDP…' :
            state.phase === 'negotiating-ice' ? 'Intercambiando candidatos ICE…' :
            state.phase === 'waiting-connection' ? 'Esperando conexión WebRTC…' :
            `Preparando sesión (${state.sessionState})…`
          
          const description = 
            state.phase === 'negotiating-sdp' ? 'Configurando parámetros de streaming' :
            state.phase === 'negotiating-ice' ? 'Estableciendo conexión de red' :
            state.phase === 'waiting-connection' ? 'Verificando audio y video' :
            state.sessionState === 'Provisioning' ? 'Inicializando stream en la consola' :
            state.sessionState === 'ReadyToConnect' ? 'Autorizando conexión' :
            'Estableciendo conexión'
        
          return <div className="flex min-h-screen flex-col items-center justify-center gap-8 p-8 bg-background">
            <div className="flex flex-col items-center gap-6">
              <XboxBootLogo size={140} />
            </div>
            
            <div className="flex flex-col items-center gap-3 text-center max-w-md">
              <h2 className="text-xl font-semibold flex items-center gap-3">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                Conectando
              </h2>
              <p className="text-sm text-muted-foreground">{description}</p>
              <p className="text-xs text-muted-foreground/70 font-mono">{statusText}</p>
            </div>
          </div>
        })()
      ) : state.phase === 'streaming' ? (
        <StreamView
          webrtc={state.webrtc}
          connectionStatus={state.connectionStatus}
          connectionDetail={
            state.connectionStatus === 'Reconectando'
              ? `${state.reconnectCause ?? 'unknown'}${state.reconnectAttempt ? ` (intento ${state.reconnectAttempt}/3)` : ''}`
              : undefined
          }
          isForegroundActive={isForegroundActive}
          onExit={() => {
            abortRef.current?.abort()
            state.webrtc.pc.close()
            setState({ phase: 'consoles', session: state.session })
          }}
        />
      ) : null}
    </>
  )
}
