import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Gamepad2, Power, PowerOff, Loader2, AlertCircle, RefreshCw, LogOut } from 'lucide-react'
import { getConsoles } from '../../app/consoles/smartglass'
import type { XboxConsole } from '../../app/consoles/smartglass'
import type { AuthSession } from '../../app/auth/xsts'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { GamepadVisualizer } from '@/components/GamepadVisualizer'

function formatConsoleType(type: string): string {
  return type
    .replace(/([A-Z])/g, ' $1')
    .trim()
    .replace(/^Xbox/, 'Xbox')
}

interface ConsoleListProps {
  session:  AuthSession
  onSelect: (consoleId: string) => void
  onLogout?: () => void
}

type State =
  | { status: 'loading' }
  | { status: 'ready'; consoles: XboxConsole[] }
  | { status: 'error'; message: string }

export function ConsoleList({ session, onSelect, onLogout }: ConsoleListProps) {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [gamepadConnected, setGamepadConnected] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const selectedIndexRef = useRef(0)
  const consolesRef = useRef<XboxConsole[]>([])

  const loadConsoles = () => {
    setState({ status: 'loading' })
    getConsoles(session.webToken)
      .then(consoles => setState({ status: 'ready', consoles }))
      .catch(err => setState({ status: 'error', message: (err as Error).message }))
  }

  const handleRefresh = async () => {
    setIsRefreshing(true)
    try {
      const consoles = await getConsoles(session.webToken)
      setState({ status: 'ready', consoles })
    } catch (err) {
      setState({ status: 'error', message: (err as Error).message })
    } finally {
      setIsRefreshing(false)
    }
  }

  useEffect(() => {
    loadConsoles()
  }, [session.webToken])

  useEffect(() => {
    selectedIndexRef.current = selectedIndex
  }, [selectedIndex])

  useEffect(() => {
    if (state.status === 'ready') consolesRef.current = state.consoles
  }, [state])

  // Gamepad navigation via requestAnimationFrame polling.
  useEffect(() => {
    let frameId = 0
    let prevUp = false, prevDown = false, prevSelect = false
    let prevConnected = false

    const tick = () => {
      const gp = Array.from(navigator.getGamepads()).find((g): g is Gamepad => !!g && g.connected)

      const connected = !!gp
      if (connected !== prevConnected) {
        prevConnected = connected
        setGamepadConnected(connected)
        
        if (connected) {
          toast.success('Mando conectado', {
            description: 'Usa D-pad y A para navegar'
          })
        } else {
          toast.info('Mando desconectado')
        }
      }

      if (gp) {
        const up     = !!gp.buttons[12]?.pressed || (gp.axes[1] ?? 0) < -0.6
        const down   = !!gp.buttons[13]?.pressed || (gp.axes[1] ?? 0) > 0.6
        const select = !!gp.buttons[0]?.pressed || !!gp.buttons[9]?.pressed || !!gp.buttons[16]?.pressed
        const items  = consolesRef.current

        if (up && !prevUp)     setSelectedIndex(i => Math.max(0, i - 1))
        if (down && !prevDown) setSelectedIndex(i => Math.min(items.length - 1, i + 1))
        if (select && !prevSelect) {
          const item = items[selectedIndexRef.current]
          if (item) onSelect(item.id)
        }

        prevUp = up; prevDown = down; prevSelect = select
      } else {
        prevUp = false; prevDown = false; prevSelect = false
      }

      frameId = requestAnimationFrame(tick)
    }

    frameId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameId)
  }, [onSelect])

  const consoles = state.status === 'ready' ? state.consoles : []
  const streamableConsoles = consoles.filter(c => c.consoleStreamingEnabled && c.powerState === 'On')

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 p-8">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Selecciona una consola</CardTitle>
              <CardDescription>
                {streamableConsoles.length > 0
                  ? `${streamableConsoles.length} ${streamableConsoles.length === 1 ? 'consola disponible' : 'consolas disponibles'}`
                  : 'Esperando consolas…'}
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handleRefresh}
                disabled={isRefreshing || state.status === 'loading'}
              >
                <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              </Button>
              {onLogout && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onLogout}
                >
                  <LogOut className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-xs">
            <Gamepad2 className={`h-3.5 w-3.5 ${gamepadConnected ? 'text-emerald-500' : 'text-muted-foreground'}`} />
            <span className={gamepadConnected ? 'text-foreground' : 'text-muted-foreground'}>
              {gamepadConnected ? 'Mando conectado — usa D-pad y A para navegar' : 'Conecta un mando para navegar'}
            </span>
          </div>

          {state.status === 'loading' && (
            <div className="space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <div className="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Buscando consolas…
              </div>
            </div>
          )}

          {state.status === 'error' && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{state.message}</AlertDescription>
            </Alert>
          )}

          {state.status === 'ready' && consoles.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <div className="rounded-full bg-muted p-4">
                <Gamepad2 className="h-8 w-8 text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium">No se encontraron consolas</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Asegúrate de que tu Xbox esté encendida y conectada a la misma cuenta
                </p>
              </div>
            </div>
          )}

          {consoles.map((c, i) => {
            const isOn = c.powerState === 'On'
            const canStream = c.consoleStreamingEnabled && isOn
            const isSelected = i === selectedIndex

            return (
              <Button
                key={c.id}
                variant={isSelected ? 'default' : 'outline'}
                disabled={!canStream}
                onClick={() => {
                  if (canStream) {
                    setSelectedIndex(i)
                    onSelect(c.id)
                  }
                }}
                className="h-auto justify-start gap-3 px-4 py-3"
              >
                <div className="flex items-center gap-3 flex-1">
                  {isOn ? (
                    <Power className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <PowerOff className="h-4 w-4 text-muted-foreground" />
                  )}
                  
                  <div className="flex flex-col items-start gap-1 flex-1">
                    <span className="font-medium">{c.name}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant={isOn ? 'default' : 'secondary'} className="text-xs">
                        {formatConsoleType(c.consoleType)}
                      </Badge>
                      {!canStream && (
                        <span className="text-xs text-muted-foreground">
                          {!isOn ? 'Apagada' : 'Streaming deshabilitado'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </Button>
            )
          })}
        </CardContent>
      </Card>
      
      <GamepadVisualizer />
    </div>
  )
}
