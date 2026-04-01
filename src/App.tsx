import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'

const features = [
  {
    title: 'Low latency',
    description: 'WebRTC streaming with WebGPU rendering for minimal input lag.',
  },
  {
    title: 'Cross-platform',
    description: 'Runs on Windows, macOS and Linux from a single codebase.',
  },
  {
    title: 'Open source',
    description: 'No telemetry, no accounts beyond your Xbox credentials.',
  },
]

function App() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <header className="flex items-center justify-between px-8 py-5">
        <span className="font-semibold tracking-tight">xcast</span>
        <Button variant="outline" size="sm">Download</Button>
      </header>

      <Separator />

      {/* Hero */}
      <section className="flex flex-col items-center gap-6 px-8 py-24 text-center">
        <Badge variant="secondary">Early access</Badge>
        <h1 className="max-w-xl text-5xl font-semibold tracking-tight">
          Stream your Xbox, anywhere
        </h1>
        <p className="max-w-md text-muted-foreground">
          A lightweight, open-source Xbox Remote Play client built on WebRTC and WebGPU.
        </p>
        <div className="flex gap-3">
          <Button>Get started</Button>
          <Button variant="outline">View on GitHub</Button>
        </div>
      </section>

      <Separator />

      {/* Features */}
      <section className="mx-auto grid max-w-4xl grid-cols-1 gap-4 px-8 py-20 sm:grid-cols-3">
        {features.map((f) => (
          <Card key={f.title}>
            <CardHeader>
              <CardTitle className="text-base">{f.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{f.description}</p>
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  )
}

export default App
