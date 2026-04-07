export type StreamQuality = '1080p' | '720p' | 'auto'
export type H264Profile = 'high' | 'main' | 'baseline'

export interface StreamSettings {
  quality: StreamQuality
  showMetrics: boolean
  volume: number
  h264Profile: H264Profile
}

export const DEFAULT_STREAM_SETTINGS: StreamSettings = {
  quality: 'auto',
  showMetrics: true,
  volume: 100,
  h264Profile: 'high',
}

const SETTINGS_STORAGE_KEY = 'xcast_settings'

export function loadSettings(): StreamSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (!stored) return DEFAULT_STREAM_SETTINGS
    const parsed = JSON.parse(stored) as Partial<StreamSettings>
    return { ...DEFAULT_STREAM_SETTINGS, ...parsed }
  } catch {
    return DEFAULT_STREAM_SETTINGS
  }
}

export function saveSettings(settings: StreamSettings): void {
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
}

export function getPreferredResolution(quality: StreamQuality): { width: number; height: number } {
  if (quality === '1080p') return { width: 1920, height: 1080 }
  if (quality === '720p') return { width: 1280, height: 720 }

  const ratio = Math.max(1, window.devicePixelRatio || 1)
  const viewportWidth = Math.max(960, Math.min(1920, Math.round(window.innerWidth * ratio)))
  const width = Math.round(viewportWidth / 16) * 16
  const height = Math.round((width * 9) / 16)
  return { width, height }
}
