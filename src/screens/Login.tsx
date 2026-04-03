import { useEffect, useRef, useState } from 'react'
import { requestDeviceCode, pollForToken } from '../../app/auth/devicecode'
import type { UserToken } from '../../app/auth/devicecode'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { GamepadVisualizer } from '@/components/GamepadVisualizer'

interface LoginProps {
  onAuthenticated: (token: UserToken) => void
}

type State =
  | { status: 'loading' }
  | { status: 'waiting'; userCode: string; verificationUri: string }
  | { status: 'error'; message: string }

export function Login({ onAuthenticated }: LoginProps) {
  const [state, setState] = useState<State>({ status: 'loading' })
  const abortRef = useRef<AbortController | null>(null)

  async function start() {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setState({ status: 'loading' })

    try {
      const { device_code, user_code, verification_uri, interval } =
        await requestDeviceCode(controller.signal)

      setState({ status: 'waiting', userCode: user_code, verificationUri: verification_uri })

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

  return (
    <div className="flex min-h-screen items-center justify-center gap-8 p-8">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in to Xbox</CardTitle>
          <CardDescription>
            {state.status === 'waiting'
              ? `Go to ${state.verificationUri} and enter the code below`
              : 'Connecting to Microsoft…'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          {state.status === 'loading' && (
            <p className="text-sm text-muted-foreground">Loading…</p>
          )}

          {state.status === 'waiting' && (
            <p className="rounded-md bg-muted px-6 py-3 font-mono text-2xl tracking-widest">
              {state.userCode}
            </p>
          )}

          {state.status === 'error' && (
            <>
              <p className="text-sm text-destructive">{state.message}</p>
              <Button onClick={() => void start()}>Try again</Button>
            </>
          )}
        </CardContent>
      </Card>
      
      <GamepadVisualizer />
    </div>
  )
}
