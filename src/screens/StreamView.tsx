import { useEffect, useRef } from 'react'
import type { WebRTCResult } from '../../app/webrtc/negotiation'

interface StreamViewProps {
  webrtc: WebRTCResult
}

export function StreamView({ webrtc }: StreamViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    let active = true
    const stream = new MediaStream([webrtc.audioTrack, webrtc.videoTrack])
    el.srcObject = stream
    void el.play().catch(err => {
      if (!active) return
      if (err instanceof DOMException && err.name === 'AbortError') return
      console.warn('Video autoplay failed:', err)
    })
    return () => {
      active = false
      el.srcObject = null
    }
  }, [webrtc.audioTrack, webrtc.videoTrack])

  return (
    <video
      ref={videoRef}
      className="h-screen w-screen object-contain bg-black"
      playsInline
      muted={false}
    />
  )
}
