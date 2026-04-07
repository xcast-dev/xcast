import { useEffect, useRef, useState } from 'react'
import { X, Maximize, Minimize, Keyboard, WifiOff, Signal, Volume2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { WebRTCResult } from '../../app/webrtc/negotiation'
import { getPreferredResolution, loadSettings, type H264Profile, type StreamQuality } from '../../app/settings/preferences'

interface StreamViewProps {
  webrtc: WebRTCResult
  requestedQuality: StreamQuality
  requestedH264Profile: H264Profile
  connectionStatus: 'Conectando' | 'Activo' | 'Reconectando'
  connectionDetail?: string
  isForegroundActive?: boolean
  onExit?: () => void
}

type VideoTrackProcessor = {
  readable: ReadableStream<VideoFrame>
}

type MediaStreamTrackProcessorCtor = new (init: { track: MediaStreamTrack }) => VideoTrackProcessor
type WebRtcStatsSample = RTCStats & {
  kind?: string
  isRemote?: boolean
  state?: string
  nominated?: boolean
  currentRoundTripTime?: number
  jitter?: number
  framesPerSecond?: number
  packetsLost?: number
  bytesReceived?: number
  codecId?: string
  mimeType?: string
  sdpFmtpLine?: string
}
const BASE_GAIN_AT_100 = 2

function getTrackProcessorCtor(): MediaStreamTrackProcessorCtor | null {
  const api = globalThis as typeof globalThis & {
    MediaStreamTrackProcessor?: MediaStreamTrackProcessorCtor
  }
  return api.MediaStreamTrackProcessor ?? null
}

export function StreamView({
  webrtc,
  requestedQuality,
  requestedH264Profile,
  connectionStatus,
  connectionDetail,
  isForegroundActive = true,
  onExit,
}: StreamViewProps) {
  const settings = loadSettings()
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [useVideoFallback, setUseVideoFallback] = useState(false)
  const [metricsOverlay, setMetricsOverlay] = useState('')
  const [showMetricsOverlay, setShowMetricsOverlay] = useState(settings.showMetrics)
  const [volume, setVolume] = useState(settings.volume)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [showControls, setShowControls] = useState(true)
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false)
  const hideControlsTimer = useRef<number>(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const gainNodeRef = useRef<GainNode | null>(null)
  const streamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const connectionStatusRef = useRef(connectionStatus)
  const volumeRef = useRef(volume)

  useEffect(() => {
    connectionStatusRef.current = connectionStatus
  }, [connectionStatus])

  useEffect(() => {
    volumeRef.current = volume
  }, [volume])

  useEffect(() => {
    if (localStorage.getItem('xcast_stream_onboarding_seen') === '1') return
    setShowOnboarding(true)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return
      const key = event.key.toLowerCase()
      
      if (key === 'h') {
        setShowMetricsOverlay(prev => !prev)
      } else if (key === '?') {
        setShowKeyboardHelp(prev => !prev)
      } else if (key === 'f') {
        toggleFullscreen()
      } else if (key === 'escape') {
        if (isFullscreen) exitFullscreen()
        else onExit?.()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isFullscreen, onExit])

  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    const audioApi = window as Window & { webkitAudioContext?: typeof AudioContext }
    const AudioContextCtor = window.AudioContext ?? audioApi.webkitAudioContext
    const stream = new MediaStream([webrtc.audioTrack])
    el.srcObject = stream
    el.muted = true
    el.volume = 0
    void el.play().catch(err => {
      if (err instanceof DOMException && err.name === 'AbortError') return
      console.warn('Audio autoplay failed:', err)
    })
    if (AudioContextCtor) {
      const ctx = new AudioContextCtor()
      const source = ctx.createMediaStreamSource(stream)
      const gainNode = ctx.createGain()
      source.connect(gainNode)
      gainNode.connect(ctx.destination)
      audioContextRef.current = ctx
      streamSourceRef.current = source
      gainNodeRef.current = gainNode
      void ctx.resume().catch(() => undefined)
    }
    return () => {
      el.srcObject = null
      gainNodeRef.current?.disconnect()
      streamSourceRef.current?.disconnect()
      streamSourceRef.current = null
      gainNodeRef.current = null
      const ctx = audioContextRef.current
      audioContextRef.current = null
      void ctx?.close().catch(() => undefined)
    }
  }, [webrtc.audioTrack])

  useEffect(() => {
    const level = Math.max(0, Math.min((volume / 100) * BASE_GAIN_AT_100, 2 * BASE_GAIN_AT_100))
    const el = audioRef.current
    if (!el) return
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = level
      el.muted = true
      el.volume = 0
      void audioContextRef.current?.resume().catch(() => undefined)
      return
    }
    el.volume = Math.max(0, Math.min(level, 1))
    el.muted = false
  }, [volume])

  const toggleFullscreen = async () => {
    const elem = containerRef.current as (HTMLDivElement & {
      webkitRequestFullscreen?: () => Promise<void>
      msRequestFullscreen?: () => Promise<void>
    }) | null
    if (!elem) return
    const doc = document as Document & {
      webkitExitFullscreen?: () => Promise<void>
      msExitFullscreen?: () => Promise<void>
    }

    try {
      if (!document.fullscreenElement) {
        if (elem.requestFullscreen) await elem.requestFullscreen()
        else if (elem.webkitRequestFullscreen) await elem.webkitRequestFullscreen()
        else if (elem.msRequestFullscreen) await elem.msRequestFullscreen()
      } else {
        if (document.exitFullscreen) await document.exitFullscreen()
        else if (doc.webkitExitFullscreen) await doc.webkitExitFullscreen()
        else if (doc.msExitFullscreen) await doc.msExitFullscreen()
      }
    } catch (err) {
      console.warn('Fullscreen toggle failed:', err)
    }
  }

  const exitFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => undefined)
    }
  }

  const scheduleHideControls = () => {
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current)
    setShowControls(true)
    hideControlsTimer.current = window.setTimeout(() => setShowControls(false), 3000)
  }

  useEffect(() => {
    const onMouseMove = () => scheduleHideControls()
    const onFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement)
    
    window.addEventListener('mousemove', onMouseMove)
    document.addEventListener('fullscreenchange', onFullscreenChange)
    scheduleHideControls()

    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('fullscreenchange', onFullscreenChange)
      if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current)
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const gpu = navigator.gpu
    const processorCtor = getTrackProcessorCtor()
    if (!gpu || !processorCtor) {
      setUseVideoFallback(true)
      return
    }

    let active = true
    let reader: ReadableStreamDefaultReader<VideoFrame> | null = null
    let context: GPUCanvasContext | null = null
    let onResize: (() => void) | null = null
    let onVisibilityChange: (() => void) | null = null
    let onFullscreenChange: (() => void) | null = null
    let onUncapturedError: ((event: GPUUncapturedErrorEvent) => void) | null = null
    let device: GPUDevice | null = null
    let latestFrame: VideoFrame | null = null
    let rafId = 0
    let metricsTimer = 0
    let lastCanvasWidth = 0
    let lastCanvasHeight = 0
    let lastVideoWidth = 0
    let lastVideoHeight = 0
    let transportRttMs: number | null = null
    let jitterMs: number | null = null
    let bitrateMbps: number | null = null
    let decodeFps: number | null = null
    let packetsLost: number | null = null
    let codecLabel = 'desconocido'
    let lastBytesReceived = 0
    let lastStatsAt = 0

    const resourcesBySize = new Map<string, { texture: GPUTexture; bindGroup: GPUBindGroup }>()
    let currentResource: { texture: GPUTexture; bindGroup: GPUBindGroup } | null = null
    const metrics = {
      copyMs: 0,
      renderMs: 0,
      rendered: 0,
      dropped: 0,
      loops: 0,
    }

    const updateWebRtcStats = async () => {
      try {
        const report = await webrtc.pc.getStats()
        let inboundVideo: WebRtcStatsSample | null = null
        let activePair: WebRtcStatsSample | null = null

        for (const raw of report.values()) {
          const stat = raw as WebRtcStatsSample
          if (stat.type === 'inbound-rtp' && stat.kind === 'video' && !stat.isRemote) {
            inboundVideo = stat
          }
          if (
            stat.type === 'candidate-pair' &&
            stat.state === 'succeeded' &&
            stat.nominated === true
          ) {
            activePair = stat
          }
        }

        if (!activePair) {
          for (const raw of report.values()) {
            const stat = raw as WebRtcStatsSample
            if (stat.type === 'candidate-pair' && stat.state === 'succeeded' && !activePair) {
              activePair = stat
            }
          }
        }

        const rtt = activePair?.currentRoundTripTime as number | undefined
        if (typeof rtt === 'number') {
          transportRttMs = Number((rtt * 1000).toFixed(1))
        }

        if (inboundVideo) {
          const jitter = inboundVideo.jitter as number | undefined
          if (typeof jitter === 'number') {
            jitterMs = Number((jitter * 1000).toFixed(1))
          }

          const fps = inboundVideo.framesPerSecond as number | undefined
          if (typeof fps === 'number') {
            decodeFps = Number(fps.toFixed(1))
          }

          const packetLoss = inboundVideo.packetsLost as number | undefined
          if (typeof packetLoss === 'number') {
            packetsLost = Number(packetLoss)
          }

          const bytes = inboundVideo.bytesReceived as number | undefined
          if (typeof bytes === 'number') {
            const now = performance.now()
            const bytesReceived = Number(bytes)
            if (lastStatsAt > 0 && bytesReceived >= lastBytesReceived) {
              const elapsedSec = (now - lastStatsAt) / 1000
              const deltaBytes = bytesReceived - lastBytesReceived
              if (elapsedSec > 0) {
                bitrateMbps = Number(((deltaBytes * 8) / (elapsedSec * 1_000_000)).toFixed(2))
              }
            }
            lastBytesReceived = bytesReceived
            lastStatsAt = now
          }

          const codecId = inboundVideo.codecId as string | undefined
          if (typeof codecId === 'string') {
            const codec = report.get(codecId) as WebRtcStatsSample | undefined
            const mimeType = typeof codec?.mimeType === 'string' ? codec.mimeType : undefined
            const fmtp = typeof codec?.sdpFmtpLine === 'string' ? codec.sdpFmtpLine : ''
            const profileMatch = fmtp.match(/profile-level-id=([0-9a-fA-F]{6})/)
            const profileHex = profileMatch ? profileMatch[1].slice(0, 2).toUpperCase() : null
            codecLabel = profileHex && mimeType ? `${mimeType} (${profileHex})` : (mimeType ?? codecLabel)
          }
        }
      } catch {
        // Ignore transient stats read failures; overlay continues with last known values.
      }
    }

    const start = async () => {
      try {
        const adapter = await gpu.requestAdapter()
        if (!adapter) throw new Error('No WebGPU adapter available')

        device = await adapter.requestDevice()
        const gpuDevice = device
        device.lost.then(info => {
          if (!active) return
          console.warn('WebGPU device lost, switching to video fallback:', info.message)
          setUseVideoFallback(true)
        })
        onUncapturedError = event => {
          if (!active) return
          console.warn('WebGPU uncaptured error:', event.error.message)
        }
        device.addEventListener('uncapturederror', onUncapturedError)

        let pausedByVisibility = document.visibilityState === 'hidden'
        onVisibilityChange = () => {
          pausedByVisibility = document.visibilityState === 'hidden'
        }
        document.addEventListener('visibilitychange', onVisibilityChange)

        context = canvas.getContext('webgpu')
        if (!context) throw new Error('Failed to get WebGPU canvas context')

        const format = gpu.getPreferredCanvasFormat()
        const configureCanvas = () => {
          if (!context) return
          const ratio = Math.max(1, window.devicePixelRatio || 1)
          const rect = canvas.getBoundingClientRect()
          const width = Math.max(1, Math.round(rect.width * ratio))
          const height = Math.max(1, Math.round(rect.height * ratio))
          if (width === lastCanvasWidth && height === lastCanvasHeight) return
          canvas.width = width
          canvas.height = height
            lastCanvasWidth = width
            lastCanvasHeight = height
            context.configure({
            device: gpuDevice,
            format,
            alphaMode: 'opaque',
          })
        }
        configureCanvas()
        onResize = configureCanvas
        window.addEventListener('resize', onResize)
        onFullscreenChange = () => {
          configureCanvas()
        }
        document.addEventListener('fullscreenchange', onFullscreenChange)

        const shaderModule = device.createShaderModule({
          code: `
struct VsOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn vs_main(@builtin(vertex_index) idx: u32) -> VsOut {
  var positions = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(1.0, -1.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(1.0, 1.0),
  );
  var uvs = array<vec2<f32>, 4>(
    vec2<f32>(0.0, 1.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(0.0, 0.0),
    vec2<f32>(1.0, 0.0),
  );

  var out: VsOut;
  out.position = vec4<f32>(positions[idx], 0.0, 1.0);
  out.uv = uvs[idx];
  return out;
}

@group(0) @binding(0) var frameTex: texture_2d<f32>;
@group(0) @binding(1) var frameSampler: sampler;

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  let color = textureSample(frameTex, frameSampler, in.uv);
  let rgb = (color.rgb - vec3<f32>(0.5, 0.5, 0.5)) * 1.03 + vec3<f32>(0.5, 0.5, 0.5);
  return vec4<f32>(rgb, color.a);
}
          `,
        })

        const pipeline = device.createRenderPipeline({
          layout: 'auto',
          vertex: { module: shaderModule, entryPoint: 'vs_main' },
          fragment: {
            module: shaderModule,
            entryPoint: 'fs_main',
            targets: [{ format }],
          },
          primitive: { topology: 'triangle-strip' },
        })

        const sampler = device.createSampler({
          magFilter: 'linear',
          minFilter: 'linear',
          addressModeU: 'clamp-to-edge',
          addressModeV: 'clamp-to-edge',
        })

        const processor = new processorCtor({ track: webrtc.videoTrack })
        reader = processor.readable.getReader()
        setUseVideoFallback(false)

        metricsTimer = window.setInterval(() => {
          void updateWebRtcStats()
          if (!metrics.rendered && !metrics.dropped && bitrateMbps == null) return
          const avgCopy = metrics.rendered ? metrics.copyMs / metrics.rendered : 0
          const avgRender = metrics.rendered ? metrics.renderMs / metrics.rendered : 0
          const rendered = metrics.rendered
          const dropped = metrics.dropped
          const avgCopyMs = Number(avgCopy.toFixed(3))
          const avgRenderMs = Number(avgRender.toFixed(3))
          const fps = Number((rendered / 2).toFixed(1))
          const dropPct = rendered + dropped > 0 ? Number(((dropped / (rendered + dropped)) * 100).toFixed(1)) : 0
          const streamResolution = `${lastVideoWidth || lastCanvasWidth}x${lastVideoHeight || lastCanvasHeight}`
          const canvasResolution = `${lastCanvasWidth}x${lastCanvasHeight}`
          const targetResolution = getPreferredResolution(requestedQuality)
          const targetResolutionLabel = `${targetResolution.width}x${targetResolution.height}`
          const vis = document.visibilityState === 'visible' ? 'activo' : 'pausado'
          const renderer = useVideoFallback ? 'video' : 'webgpu'
          const decodeFpsText = decodeFps != null ? `${decodeFps}` : '-'
          const bitrateText = bitrateMbps != null ? `${bitrateMbps} Mb/s` : '-'
          const rttText = transportRttMs != null ? `${transportRttMs} ms` : '-'
          const jitterText = jitterMs != null ? `${jitterMs} ms` : '-'
          const packetsLostText = packetsLost != null ? `${packetsLost}` : '-'
          setMetricsOverlay(
            `render: ${renderer} | solicitado: ${requestedQuality}/${requestedH264Profile} (${targetResolutionLabel}) | efectivo: stream ${streamResolution}, codec ${codecLabel} | estado: ${vis} | salida: ${canvasResolution} | fps render/dec: ${fps}/${decodeFpsText} | bitrate: ${bitrateText} | rtt/jitter: ${rttText}/${jitterText} | pérdida frame/pkt: ${dropPct}% (${dropped})/${packetsLostText} | copia/render: ${avgCopyMs}ms/${avgRenderMs}ms | vol: ${volumeRef.current}% | rtc: ${connectionStatusRef.current}`
          )
          if (import.meta.env.DEV) {
            console.debug('[webgpu]', {
              renderer,
              vis,
              streamResolution,
              canvasResolution,
              fps,
              rendered,
              dropped,
              dropPct,
              avgCopyMs,
              avgRenderMs,
              decodeFps,
              bitrateMbps,
              transportRttMs,
              jitterMs,
              packetsLost,
              codecLabel,
              requestedProfile: `${requestedQuality}/${requestedH264Profile}`,
              targetResolution: targetResolutionLabel,
            })
          }
          metrics.copyMs = 0
          metrics.renderMs = 0
          metrics.rendered = 0
          metrics.dropped = 0
        }, 2000)

        const readLoop = async () => {
          while (active && reader) {
            const { value: frame, done } = await reader.read()
            if (done || !frame) break
            lastVideoWidth = frame.displayWidth || frame.codedWidth
            lastVideoHeight = frame.displayHeight || frame.codedHeight
            if (latestFrame) {
              latestFrame.close()
              metrics.dropped += 1
            }
            latestFrame = frame
          }
        }

        const renderLoop = () => {
          if (!active) return
          if (pausedByVisibility) {
            rafId = requestAnimationFrame(renderLoop)
            return
          }
          metrics.loops += 1

          if (latestFrame && context) {
            const frame = latestFrame
            latestFrame = null
            const width = frame.displayWidth
            const height = frame.displayHeight
            const key = `${width}x${height}`

            let resource = resourcesBySize.get(key)
            if (!resource) {
              const texture = gpuDevice.createTexture({
                size: [width, height],
                format: 'rgba8unorm',
                usage:
                  GPUTextureUsage.TEXTURE_BINDING |
                  GPUTextureUsage.COPY_DST |
                  GPUTextureUsage.RENDER_ATTACHMENT,
              })
              const bindGroup = gpuDevice.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [
                  { binding: 0, resource: texture.createView() },
                  { binding: 1, resource: sampler },
                ],
              })
              resource = { texture, bindGroup }
              resourcesBySize.set(key, resource)
            }
            currentResource = resource

            const copyStart = performance.now()
            gpuDevice.queue.copyExternalImageToTexture(
              { source: frame },
              { texture: currentResource.texture },
              [width, height]
            )
            metrics.copyMs += performance.now() - copyStart

            const renderStart = performance.now()
            const encoder = gpuDevice.createCommandEncoder()
            const pass = encoder.beginRenderPass({
              colorAttachments: [
                {
                  view: context.getCurrentTexture().createView(),
                  loadOp: 'clear',
                  storeOp: 'store',
                  clearValue: { r: 0, g: 0, b: 0, a: 1 },
                },
              ],
            })
            pass.setPipeline(pipeline)
            pass.setBindGroup(0, currentResource.bindGroup)
            pass.draw(4)
            pass.end()
            gpuDevice.queue.submit([encoder.finish()])
            metrics.renderMs += performance.now() - renderStart
            metrics.rendered += 1

            frame.close()
          }

          rafId = requestAnimationFrame(renderLoop)
        }

        void readLoop()
        rafId = requestAnimationFrame(renderLoop)

      } catch (err) {
        if (!active) return
        console.warn('WebGPU renderer failed, using video fallback:', err)
        setUseVideoFallback(true)
      }
    }

    void start()

    return () => {
      active = false
      setMetricsOverlay('')
      if (onVisibilityChange) document.removeEventListener('visibilitychange', onVisibilityChange)
      if (onFullscreenChange) document.removeEventListener('fullscreenchange', onFullscreenChange)
      if (device && onUncapturedError) device.removeEventListener('uncapturederror', onUncapturedError)
      if (onResize) window.removeEventListener('resize', onResize)
      if (metricsTimer) window.clearInterval(metricsTimer)
      if (rafId) cancelAnimationFrame(rafId)
      if (latestFrame) {
        latestFrame.close()
        latestFrame = null
      }
      void reader?.cancel().catch(() => undefined)
      for (const { texture } of resourcesBySize.values()) texture.destroy()
      resourcesBySize.clear()
      currentResource = null
    }
  }, [requestedH264Profile, requestedQuality, useVideoFallback, webrtc.pc, webrtc.videoTrack])

  useEffect(() => {
    const el = videoRef.current
    if (!el) return

    if (!useVideoFallback) {
      el.srcObject = null
      return
    }

    let active = true
    let frameCallbackId = 0
    const stream = new MediaStream([webrtc.videoTrack])
    el.srcObject = stream
    void el.play().catch(err => {
      if (!active) return
      if (err instanceof DOMException && err.name === 'AbortError') return
      console.warn('Video fallback autoplay failed:', err)
    })

    if ('requestVideoFrameCallback' in el) {
      const withRvfc = el as HTMLVideoElement & {
        requestVideoFrameCallback: (cb: VideoFrameRequestCallback) => number
        cancelVideoFrameCallback: (handle: number) => void
      }
      const onFrame: VideoFrameRequestCallback = () => {
        if (!active) return
        frameCallbackId = withRvfc.requestVideoFrameCallback(onFrame)
      }
      frameCallbackId = withRvfc.requestVideoFrameCallback(onFrame)
    }

    return () => {
      active = false
      if (frameCallbackId && 'cancelVideoFrameCallback' in el) {
        ;(el as HTMLVideoElement & { cancelVideoFrameCallback: (handle: number) => void })
          .cancelVideoFrameCallback(frameCallbackId)
      }
      el.srcObject = null
    }
  }, [useVideoFallback, webrtc.videoTrack])

  const connectionQuality = connectionStatus === 'Activo' ? 'good' : connectionStatus === 'Reconectando' ? 'poor' : 'connecting'

  return (
    <TooltipProvider>
      <div 
        ref={containerRef}
        className="relative h-screen w-screen bg-black flex items-center justify-center animate-in fade-in duration-300"
        onMouseMove={() => scheduleHideControls()}
      >
        <canvas
          ref={canvasRef}
          className={useVideoFallback ? 'hidden' : 'w-full max-w-[177.78vh] aspect-video bg-black'}
        />
        <video
          ref={videoRef}
          className={useVideoFallback ? 'w-full max-w-[177.78vh] aspect-video object-contain bg-black' : 'hidden'}
          playsInline
          muted
        />
        <audio ref={audioRef} hidden autoPlay playsInline />

        {!isForegroundActive ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/65">
            <p className="rounded bg-black/70 px-4 py-2 text-sm text-white/90">
              Stream en pausa por estar en segundo plano
            </p>
          </div>
        ) : null}

        {/* Top bar - Status and connection */}
        <div className={`absolute left-0 right-0 top-0 flex items-start justify-between p-3 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0'}`}>
          <div className="flex flex-col gap-2">
            {!useVideoFallback && showMetricsOverlay && metricsOverlay && (
              <div className="rounded bg-black/70 px-3 py-2 font-mono text-xs text-emerald-300 shadow">
                {metricsOverlay}
              </div>
            )}
          </div>

          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2 rounded bg-black/70 px-3 py-2 text-xs text-white shadow">
              {connectionQuality === 'good' && <Signal className="h-3 w-3 text-emerald-500" />}
              {connectionQuality === 'poor' && <WifiOff className="h-3 w-3 text-amber-500" />}
              {connectionQuality === 'connecting' && <Signal className="h-3 w-3 text-muted-foreground animate-pulse" />}
              <span>{connectionStatus}</span>
            </div>
            {connectionDetail && (
              <div className="rounded bg-black/70 px-3 py-1 text-xs text-white/80 shadow">
                {connectionDetail}
              </div>
            )}
          </div>
        </div>

        {/* Bottom bar - Volume and controls */}
        <div className={`absolute bottom-0 left-0 right-0 flex items-end justify-between p-3 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0'}`}>
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger
                onClick={() => setShowKeyboardHelp(prev => !prev)}
                render={
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-8 w-8 rounded-full bg-black/70 p-0 text-white hover:bg-black/90 transition-all hover:scale-105 active:scale-95"
                  />
                }
              >
                <Keyboard className="h-4 w-4" />
              </TooltipTrigger>
              <TooltipContent>Atajos de teclado (?)</TooltipContent>
            </Tooltip>

            {onExit && (
              <Tooltip>
                <TooltipTrigger
                  onClick={onExit}
                  render={
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-8 w-8 rounded-full bg-black/70 p-0 text-white hover:bg-black/90 transition-all hover:scale-105 active:scale-95"
                    />
                  }
                >
                  <X className="h-4 w-4" />
                </TooltipTrigger>
                <TooltipContent>Salir (Esc)</TooltipContent>
              </Tooltip>
            )}

            <Tooltip>
              <TooltipTrigger
                onClick={toggleFullscreen}
                render={
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-8 w-8 rounded-full bg-black/70 p-0 text-white hover:bg-black/90 transition-all hover:scale-105 active:scale-95"
                  />
                }
              >
                {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
              </TooltipTrigger>
              <TooltipContent>Pantalla completa (F)</TooltipContent>
            </Tooltip>
          </div>

          <div className="flex items-center gap-3 rounded bg-black/70 px-4 py-2 text-xs text-white shadow">
            <Volume2 className="h-4 w-4" />
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={200}
                step={1}
                value={volume}
                onChange={event => setVolume(Number(event.target.value))}
                className="w-24"
              />
              <span className="w-10 text-right font-mono">{volume}%</span>
            </div>
          </div>
        </div>

        {/* Keyboard shortcuts overlay */}
        {showKeyboardHelp && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80">
            <div className="rounded-lg bg-black/90 p-6 shadow-xl border border-white/10 max-w-md">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-white">Atajos de teclado</h3>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0 text-white/60 hover:text-white transition-transform hover:scale-105 active:scale-95"
                  onClick={() => setShowKeyboardHelp(false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="space-y-2 text-sm text-white/80">
                <div className="flex justify-between">
                  <span className="font-mono">H</span>
                  <span>Mostrar/ocultar métricas</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-mono">F</span>
                  <span>Pantalla completa</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-mono">?</span>
                  <span>Mostrar esta ayuda</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-mono">Esc</span>
                  <span>Salir del stream</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {showOnboarding && (
          <div className="absolute bottom-20 left-4 z-50 max-w-sm rounded-lg border border-white/15 bg-black/85 p-4 text-white shadow-xl">
            <h3 className="mb-2 text-sm font-semibold">Primer stream en xcast</h3>
            <p className="mb-3 text-xs text-white/80">
              Pulsa <span className="font-mono">?</span> para atajos, <span className="font-mono">F</span> para fullscreen y <span className="font-mono">Esc</span> para salir.
            </p>
            <div className="flex items-center justify-end gap-2">
              <Button
                size="sm"
                variant="secondary"
                className="h-8 px-3 text-xs transition-transform hover:scale-[1.02] active:scale-[0.98]"
                onClick={() => {
                  localStorage.setItem('xcast_stream_onboarding_seen', '1')
                  setShowOnboarding(false)
                }}
              >
                Entendido
              </Button>
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}
