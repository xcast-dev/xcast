import { useEffect, useRef, useState } from 'react'
import { Gamepad2 } from 'lucide-react'
import { getConsoles } from '../../app/consoles/smartglass'
import type { XboxConsole } from '../../app/consoles/smartglass'
import type { AuthSession } from '../../app/auth/xsts'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { GamepadVisualizer } from '@/components/GamepadVisualizer'

interface ConsoleListProps {
  session:  AuthSession
  onSelect: (consoleId: string) => void
}

type State =
  | { status: 'loading' }
  | { status: 'ready'; consoles: XboxConsole[] }
  | { status: 'error'; message: string }

export function ConsoleList({ session, onSelect }: ConsoleListProps) {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [gamepadConnected, setGamepadConnected] = useState(false)
  const selectedIndexRef = useRef(0)
  const consolesRef = useRef<XboxConsole[]>([])

  useEffect(() => {
    getConsoles(session.webToken)
      .then(consoles => setState({ status: 'ready', consoles }))
      .catch(err => setState({ status: 'error', message: (err as Error).message }))
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

  return (
    <div className="flex flex-col min-h-screen items-center justify-center gap-8 p-8">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Select a console</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Gamepad2 className={`h-3.5 w-3.5 ${gamepadConnected ? 'text-emerald-500' : ''}`} />
            {gamepadConnected ? 'Controller connected' : 'No controller detected'}
          </div>

          {state.status === 'loading' && (
            <p className="text-sm text-muted-foreground">Loading consoles…</p>
          )}

          {state.status === 'error' && (
            <p className="text-sm text-destructive">{state.message}</p>
          )}

          {state.status === 'ready' && consoles.length === 0 && (
            <p className="text-sm text-muted-foreground">No consoles found.</p>
          )}

          {consoles.map((c, i) => (
            <Button
              key={c.id}
              variant={i === selectedIndex ? 'default' : 'outline'}
              onClick={() => { setSelectedIndex(i); onSelect(c.id) }}
            >
              {c.name}
              <span className="ml-auto text-xs opacity-60">{c.powerState}</span>
            </Button>
          ))}
        </CardContent>
      </Card>
      
      <GamepadVisualizer />
    </div>
  )
}
