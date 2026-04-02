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
    const stream = new MediaStream([webrtc.audioTrack, webrtc.videoTrack])
    el.srcObject = stream
    void el.play()
    return () => { el.srcObject = null }
  }, [webrtc])

  return (
    <video
      ref={videoRef}
      className="h-screen w-screen object-contain bg-black"
      playsInline
      muted={false}
    />
  )
}
