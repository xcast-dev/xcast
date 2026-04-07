import { useState, useEffect } from 'react'
import { Settings as SettingsIcon, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'

export interface SettingsData {
  quality: '1080p' | '720p' | 'auto'
  showMetrics: boolean
  volume: number
  h264Profile: 'high' | 'main' | 'baseline'
}

interface SettingsProps {
  onBack: () => void
}

const DEFAULT_SETTINGS: SettingsData = {
  quality: 'auto',
  showMetrics: true,
  volume: 100,
  h264Profile: 'high',
}

export function loadSettings(): SettingsData {
  try {
    const stored = localStorage.getItem('xcast_settings')
    if (!stored) return DEFAULT_SETTINGS
    return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(settings: SettingsData) {
  localStorage.setItem('xcast_settings', JSON.stringify(settings))
}

export function Settings({ onBack }: SettingsProps) {
  const [settings, setSettings] = useState<SettingsData>(loadSettings)

  useEffect(() => {
    saveSettings(settings)
  }, [settings])

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8 animate-in fade-in duration-300">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={onBack}
              className="h-8 w-8 transition-transform hover:scale-105 active:scale-95"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="flex-1">
              <CardTitle className="flex items-center gap-2">
                <SettingsIcon className="h-5 w-5" />
                Configuración
              </CardTitle>
              <CardDescription>Personaliza tu experiencia de streaming</CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Quality */}
          <div className="space-y-3">
            <Label className="text-base">Calidad de video</Label>
            <div className="grid grid-cols-3 gap-2">
              {(['1080p', '720p', 'auto'] as const).map(q => (
                <Button
                  key={q}
                  variant={settings.quality === q ? 'default' : 'outline'}
                  onClick={() => setSettings(s => ({ ...s, quality: q }))}
                  className="w-full transition-transform hover:scale-[1.02] active:scale-[0.98]"
                >
                  {q === 'auto' ? 'Auto' : q}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {settings.quality === 'auto'
                ? 'Ajusta automáticamente según la conexión'
                : `Streaming forzado a ${settings.quality}`}
            </p>
          </div>

          {/* Show Metrics */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-base">Mostrar métricas (H)</Label>
              <p className="text-xs text-muted-foreground">
                FPS, bitrate, latencia durante el streaming
              </p>
            </div>
            <Switch
              checked={settings.showMetrics}
              onCheckedChange={checked => setSettings(s => ({ ...s, showMetrics: checked }))}
            />
          </div>

          {/* Volume */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-base">Volumen predeterminado</Label>
              <span className="text-sm font-mono text-muted-foreground">{settings.volume}%</span>
            </div>
            <Slider
              value={[settings.volume]}
              onValueChange={(value) => {
                const newVolume = Array.isArray(value) ? value[0] : value
                setSettings(s => ({ ...s, volume: newVolume }))
              }}
              min={0}
              max={200}
              step={5}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">
              Volumen inicial al conectar (0-200%)
            </p>
          </div>

          {/* H.264 Profile */}
          <div className="space-y-3">
            <Label className="text-base">Perfil H.264</Label>
            <div className="grid grid-cols-3 gap-2">
              {(['high', 'main', 'baseline'] as const).map(profile => (
                <Button
                  key={profile}
                  variant={settings.h264Profile === profile ? 'default' : 'outline'}
                  onClick={() => setSettings(s => ({ ...s, h264Profile: profile }))}
                  className="w-full capitalize transition-transform hover:scale-[1.02] active:scale-[0.98]"
                >
                  {profile}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {settings.h264Profile === 'high' && 'Mejor calidad, requiere más CPU'}
              {settings.h264Profile === 'main' && 'Balance entre calidad y rendimiento'}
              {settings.h264Profile === 'baseline' && 'Menor latencia, compatible con cualquier dispositivo'}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default Settings
