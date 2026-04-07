export type StreamQuality = 'full' | 'optimized'
export type H264Profile = 'high' | 'main' | 'baseline'

export interface StreamSettings {
  quality: StreamQuality
  showMetrics: boolean
  volume: number
  h264Profile: H264Profile
}

export const DEFAULT_STREAM_SETTINGS: StreamSettings = {
  quality: 'full',
  showMetrics: true,
  volume: 100,
  h264Profile: 'high',
}

const SETTINGS_STORAGE_KEY = 'xcast_settings'

export function loadSettings(): StreamSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (!stored) return DEFAULT_STREAM_SETTINGS
    const parsed = JSON.parse(stored) as Record<string, unknown>
    const rawQuality = parsed.quality
    const migratedQuality: StreamQuality =
      rawQuality === 'optimized'
        ? 'optimized'
        : rawQuality === 'full'
          ? 'full'
          : DEFAULT_STREAM_SETTINGS.quality
    return {
      ...DEFAULT_STREAM_SETTINGS,
      ...(parsed as Partial<StreamSettings>),
      quality: migratedQuality,
    }
  } catch {
    return DEFAULT_STREAM_SETTINGS
  }
}

export function saveSettings(settings: StreamSettings): void {
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
}

export function getPreferredResolution(quality: StreamQuality): { width: number; height: number } {
  void quality
  return { width: 1920, height: 1080 }
}
