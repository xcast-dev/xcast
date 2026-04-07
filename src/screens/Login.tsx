import { useEffect, useRef, useState } from 'react'
import { requestDeviceCode, pollForToken } from '../../app/auth/devicecode'
import type { UserToken } from '../../app/auth/devicecode'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Progress } from '@/components/ui/progress'
import { GamepadVisualizer } from '@/components/GamepadVisualizer'
import { ExternalLink, Loader2, RefreshCw, AlertCircle } from 'lucide-react'

interface LoginProps {
  onAuthenticated: (token: UserToken) => void
}

type State =
  | { status: 'loading' }
  | { status: 'waiting'; userCode: string; verificationUri: string; expiresAt: number }
  | { status: 'error'; message: string }

export function Login({ onAuthenticated }: LoginProps) {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  async function start() {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setState({ status: 'loading' })

    try {
      const { device_code, user_code, verification_uri, interval, expires_in } =
        await requestDeviceCode(controller.signal)

      const expiresAt = Date.now() + expires_in * 1000
      setState({ status: 'waiting', userCode: user_code, verificationUri: verification_uri, expiresAt })

      const token = await pollForToken(device_code, interval, controller.signal)
      onAuthenticated(token)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      setState({
        status: 'error',
        message: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  useEffect(() => {
    void start()
    return () => abortRef.current?.abort()
  }, [])

  useEffect(() => {
    if (state.status !== 'waiting') {
      setTimeRemaining(null)
      return
    }

    const updateTimer = () => {
      const remaining = Math.max(0, Math.floor((state.expiresAt - Date.now()) / 1000))
      setTimeRemaining(remaining)
      if (remaining === 0) {
        setState({ status: 'error', message: 'El código expiró. Por favor, intenta de nuevo.' })
      }
    }

    updateTimer()
    const timer = setInterval(updateTimer, 1000)
    return () => clearInterval(timer)
  }, [state])

  const progressValue = state.status === 'waiting' && timeRemaining !== null
    ? ((timeRemaining / 900) * 100)
    : 0

  return (
    <div className="flex min-h-screen items-center justify-center gap-8 p-8 animate-in fade-in duration-300">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Iniciar sesión en Xbox</CardTitle>
          <CardDescription>
            {state.status === 'waiting'
              ? 'Visita el enlace de abajo e introduce el código'
              : state.status === 'loading'
              ? 'Conectando con Microsoft…'
              : 'Autenticación requerida'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {state.status === 'loading' && (
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Cargando…</p>
            </div>
          )}

          {state.status === 'waiting' && (
            <>
              <div className="flex flex-col items-center gap-4">
                <div className="rounded-lg bg-muted px-8 py-5 font-mono text-3xl tracking-[0.5em] font-bold">
                  {state.userCode}
                </div>
                
                <Button
                  variant="outline"
                  onClick={() => window.open(state.verificationUri, '_blank')}
                  className="gap-2 transition-transform hover:scale-[1.02] active:scale-[0.98]"
                >
                  <ExternalLink className="h-4 w-4" />
                  Abrir {state.verificationUri.replace('https://', '').replace('www.', '')}
                </Button>
              </div>

              {timeRemaining !== null && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Código válido por:</span>
                    <span className="font-mono">
                      {Math.floor(timeRemaining / 60)}:{String(timeRemaining % 60).padStart(2, '0')}
                    </span>
                  </div>
                  <Progress value={progressValue} className="h-1" />
                </div>
              )}

              <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground pt-2">
                <Loader2 className="h-3 w-3 animate-spin" />
                Esperando autenticación…
              </div>
            </>
          )}

          {state.status === 'error' && (
            <div className="space-y-4">
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{state.message}</AlertDescription>
              </Alert>
              <Button onClick={() => void start()} className="w-full gap-2 transition-transform hover:scale-[1.02] active:scale-[0.98]">
                <RefreshCw className="h-4 w-4" />
                Intentar de nuevo
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
      
      <GamepadVisualizer />
    </div>
  )
}

export default Login
