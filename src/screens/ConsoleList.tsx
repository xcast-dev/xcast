import { useEffect, useState } from 'react'
import { getConsoles } from '../../app/consoles/smartglass'
import type { XboxConsole } from '../../app/consoles/smartglass'
import type { AuthSession } from '../../app/auth/xsts'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

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

  useEffect(() => {
    getConsoles(session.webToken)
      .then(consoles => setState({ status: 'ready', consoles }))
      .catch(err => setState({ status: 'error', message: (err as Error).message }))
  }, [])

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Select a console</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {state.status === 'loading' && (
            <p className="text-sm text-muted-foreground">Loading consoles…</p>
          )}

          {state.status === 'error' && (
            <p className="text-sm text-destructive">{state.message}</p>
          )}

          {state.status === 'ready' && state.consoles.length === 0 && (
            <p className="text-sm text-muted-foreground">No consoles found.</p>
          )}

          {state.status === 'ready' && state.consoles.map(c => (
            <Button key={c.id} variant="outline" onClick={() => onSelect(c.id)}>
              {c.name}
              <span className="ml-auto text-xs text-muted-foreground">{c.powerState}</span>
            </Button>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
