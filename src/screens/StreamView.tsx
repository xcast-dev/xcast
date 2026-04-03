import { useEffect, useRef, useState } from 'react'
import type { WebRTCResult } from '../../app/webrtc/negotiation'

interface StreamViewProps {
  webrtc: WebRTCResult
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

export function StreamView({ webrtc }: StreamViewProps) {
  const [useVideoFallback, setUseVideoFallback] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)

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
    let texture: GPUTexture | null = null
    let bindGroup: GPUBindGroup | null = null
    let reader: ReadableStreamDefaultReader<VideoFrame> | null = null
    let context: GPUCanvasContext | null = null
    let lastWidth = 0
    let lastHeight = 0
    let onResize: (() => void) | null = null

    const start = async () => {
      try {
        const adapter = await gpu.requestAdapter()
        if (!adapter) throw new Error('No WebGPU adapter available')

        const device = await adapter.requestDevice()
        context = canvas.getContext('webgpu')
        if (!context) throw new Error('Failed to get WebGPU canvas context')

        const format = gpu.getPreferredCanvasFormat()
        const configureCanvas = () => {
          if (!context) return
          const ratio = Math.max(1, window.devicePixelRatio || 1)
          const rect = canvas.getBoundingClientRect()
          canvas.width = Math.max(1, Math.round(rect.width * ratio))
          canvas.height = Math.max(1, Math.round(rect.height * ratio))
          context.configure({
            device,
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
  return textureSample(frameTex, frameSampler, in.uv);
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

        while (active && reader) {
          const { value: frame, done } = await reader.read()
          if (done || !frame) break

          const width = frame.displayWidth
          const height = frame.displayHeight

          if (!texture || width !== lastWidth || height !== lastHeight) {
            texture?.destroy()
            texture = device.createTexture({
              size: [width, height],
              format: 'rgba8unorm',
              usage:
                GPUTextureUsage.TEXTURE_BINDING |
                GPUTextureUsage.COPY_DST |
                GPUTextureUsage.RENDER_ATTACHMENT,
            })

            bindGroup = device.createBindGroup({
              layout: pipeline.getBindGroupLayout(0),
              entries: [
                { binding: 0, resource: texture.createView() },
                { binding: 1, resource: sampler },
              ],
            })

            lastWidth = width
            lastHeight = height
          }

          device.queue.copyExternalImageToTexture(
            { source: frame },
            { texture },
            [width, height]
          )

          if (context && bindGroup) {
            const encoder = device.createCommandEncoder()
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
            pass.setBindGroup(0, bindGroup)
            pass.draw(4)
            pass.end()
            device.queue.submit([encoder.finish()])
          }

          frame.close()
        }
      } catch (err) {
        if (!active) return
        console.warn('WebGPU renderer failed, using video fallback:', err)
        setUseVideoFallback(true)
      }
    }

    void start()

    return () => {
      active = false
      if (onResize) window.removeEventListener('resize', onResize)
      void reader?.cancel().catch(() => undefined)
      texture?.destroy()
    }
  }, [webrtc.videoTrack])

  useEffect(() => {
    const el = videoRef.current
    if (!el) return

    if (!useVideoFallback) {
      el.srcObject = null
      return
    }

    let active = true
    const stream = new MediaStream([webrtc.videoTrack])
    el.srcObject = stream
    void el.play().catch(err => {
      if (!active) return
      if (err instanceof DOMException && err.name === 'AbortError') return
      console.warn('Video fallback autoplay failed:', err)
    })

    return () => {
      active = false
      el.srcObject = null
    }
  }, [useVideoFallback, webrtc.videoTrack])

  return (
    <div className="h-screen w-screen bg-black flex items-center justify-center p-4">
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
    </div>
  )
}
