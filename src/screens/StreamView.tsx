import { useEffect, useRef, useState } from 'react'
import type { WebRTCResult } from '../../app/webrtc/negotiation'
import { FrameWatchdog } from '../../app/webrtc/watchdog'

interface StreamViewProps {
  webrtc: WebRTCResult
  connectionStatus: 'Conectando' | 'Activo' | 'Reconectando'
  onStreamFrozen: () => void
}

type VideoTrackProcessor = {
  readable: ReadableStream<VideoFrame>
}

type MediaStreamTrackProcessorCtor = new (init: { track: MediaStreamTrack }) => VideoTrackProcessor

function getTrackProcessorCtor(): MediaStreamTrackProcessorCtor | null {
  const api = globalThis as typeof globalThis & {
    MediaStreamTrackProcessor?: MediaStreamTrackProcessorCtor
  }
  return api.MediaStreamTrackProcessor ?? null
}

export function StreamView({ webrtc, connectionStatus, onStreamFrozen }: StreamViewProps) {
  const [useVideoFallback, setUseVideoFallback] = useState(false)
  const [metricsOverlay, setMetricsOverlay] = useState('')
  const [showMetricsOverlay, setShowMetricsOverlay] = useState(true)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return
      if (event.key.toLowerCase() !== 'h') return
      setShowMetricsOverlay(prev => !prev)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    let active = true
    const stream = new MediaStream([webrtc.audioTrack])
    el.srcObject = stream
    void el.play().catch(err => {
      if (!active) return
      if (err instanceof DOMException && err.name === 'AbortError') return
      console.warn('Audio autoplay failed:', err)
    })
    return () => {
      active = false
      el.srcObject = null
    }
  }, [webrtc.audioTrack])

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
    let onUncapturedError: ((event: GPUUncapturedErrorEvent) => void) | null = null
    let device: GPUDevice | null = null
    let latestFrame: VideoFrame | null = null
    let rafId = 0
    let metricsTimer = 0
    const watchdog = new FrameWatchdog({
      thresholdMs: 3000,
      checkIntervalMs: 1000,
      onFrozen: () => onStreamFrozen(),
    })
    let lastCanvasWidth = 0
    let lastCanvasHeight = 0

    const resourcesBySize = new Map<string, { texture: GPUTexture; bindGroup: GPUBindGroup }>()
    let currentResource: { texture: GPUTexture; bindGroup: GPUBindGroup } | null = null
    const metrics = {
      copyMs: 0,
      renderMs: 0,
      rendered: 0,
      dropped: 0,
      loops: 0,
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
        watchdog.start()

        metricsTimer = window.setInterval(() => {
          if (!metrics.rendered && !metrics.dropped) return
          const avgCopy = metrics.rendered ? metrics.copyMs / metrics.rendered : 0
          const avgRender = metrics.rendered ? metrics.renderMs / metrics.rendered : 0
          const rendered = metrics.rendered
          const dropped = metrics.dropped
          const avgCopyMs = Number(avgCopy.toFixed(3))
          const avgRenderMs = Number(avgRender.toFixed(3))
          const fps = Number((rendered / 2).toFixed(1))
          const dropPct = rendered + dropped > 0 ? Number(((dropped / (rendered + dropped)) * 100).toFixed(1)) : 0
          const queueLag = latestFrame ? 1 : 0
          const resolution = `${lastCanvasWidth}x${lastCanvasHeight}`
          const vis = document.visibilityState === 'visible' ? 'active' : 'paused'
          const renderer = useVideoFallback ? 'video-fallback' : 'webgpu'
          setMetricsOverlay(
            `${renderer} | ${vis} | ${resolution} | ${fps}fps | drop ${dropPct}% (${dropped}) | copy ${avgCopyMs}ms | render ${avgRenderMs}ms | queue ${queueLag}`
          )
          if (import.meta.env.DEV) {
            console.debug('[webgpu]', {
              renderer,
              vis,
              resolution,
              fps,
              rendered,
              dropped,
              dropPct,
              avgCopyMs,
              avgRenderMs,
              queueLag,
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
            if (latestFrame) {
              latestFrame.close()
              metrics.dropped += 1
            }
            latestFrame = frame
            watchdog.recordFrame()
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
      if (device && onUncapturedError) device.removeEventListener('uncapturederror', onUncapturedError)
      if (onResize) window.removeEventListener('resize', onResize)
      if (metricsTimer) window.clearInterval(metricsTimer)
      watchdog.stop()
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
  }, [webrtc.videoTrack, onStreamFrozen])

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

  return (
    <div className="relative h-screen w-screen bg-black flex items-center justify-center">
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
      <audio ref={audioRef} hidden />
      <div className="absolute right-3 top-3 rounded bg-black/70 px-3 py-1 text-xs text-white shadow">
        {connectionStatus}
      </div>
      {!useVideoFallback && showMetricsOverlay && metricsOverlay && (
        <div className="absolute left-3 top-3 max-w-[calc(100vw-2rem)] rounded bg-black/70 px-3 py-2 font-mono text-xs text-emerald-300 shadow">
          {metricsOverlay}
        </div>
      )}
    </div>
  )
}
