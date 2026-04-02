import type { AuthSession } from '../auth/xsts'
import type { StreamSession } from '../streaming/session'

const SERVER = 'http://localhost:1209'

// SDP configuration sent alongside the offer
const SDP_CONFIGURATION = {
  chatConfiguration: {
    bytesPerSample:        2,
    expectedClipDurationMs: 20,
    format:                { codec: 'opus', container: 'webm' },
    numChannels:           1,
    sampleFrequencyHz:     24000,
  },
  chat:            { minVersion: 1, maxVersion: 1 },
  control:         { minVersion: 1, maxVersion: 3 },
  input:           { minVersion: 1, maxVersion: 9 },
  message:         { minVersion: 1, maxVersion: 1 },
  reliableinput:   { minVersion: 9, maxVersion: 9 },
  unreliableinput: { minVersion: 9, maxVersion: 9 },
}

// Reorder video codecs: H.264 High → Main → Baseline, then the rest.
function preferH264(pc: RTCPeerConnection): void {
  const caps = RTCRtpReceiver.getCapabilities('video')
  if (!caps) return

  const h264Order = ['4d', '42e', '420']
  const sorted = [...caps.codecs].sort((a, b) => {
    const pa = h264Order.findIndex(p => a.sdpFmtpLine?.includes(`profile-level-id=${p}`))
    const pb = h264Order.findIndex(p => b.sdpFmtpLine?.includes(`profile-level-id=${p}`))
    return (pa === -1 ? 999 : pa) - (pb === -1 ? 999 : pb)
  })

  const [videoTransceiver] = pc.getTransceivers().filter(t => t.receiver.track.kind === 'video')
  videoTransceiver?.setCodecPreferences(sorted)
}

// Patch SDP: enable stereo on opus audio.
function patchStereo(sdp: string): string {
  return sdp.replace(/useinbandfec=1/g, 'useinbandfec=1; stereo=1')
}

// Parse a Teredo IPv6 address (2001::) into IPv4 + port per RFC 4380.
function parseTeredoCandidate(ipv6: string): { ip: string; port: number } | null {
  if (!ipv6.startsWith('2001:')) return null
  const segs = ipv6.split(':')
  if (segs.length < 8) return null
  try {
    const ip = [
      parseInt(segs[6].substring(0, 2), 16) & 0xff,
      parseInt(segs[6].substring(2, 4), 16) & 0xff,
      parseInt(segs[7].substring(0, 2), 16) & 0xff,
      parseInt(segs[7].substring(2, 4), 16) & 0xff,
    ].join('.')
    const port = parseInt(segs[5], 16) & 0xffff
    return { ip, port }
  } catch {
    return null
  }
}

// Expand server ICE candidates: add synthetic UDP candidates for Teredo addresses.
function expandCandidates(candidates: string[]): string[] {
  const result: string[] = []
  for (const c of candidates) {
    result.push(c)
    const match = c.match(/typ host.*?(\S+:\S+:\S+:\S+:\S+:\S+:\S+:\S+)/)
    if (!match) continue
    const teredo = parseTeredoCandidate(match[1])
    if (!teredo) continue
    result.push(`a=candidate:10 1 UDP 1 ${teredo.ip} 9002 typ host`)
    result.push(`a=candidate:11 1 UDP 1 ${teredo.ip} ${teredo.port} typ host`)
  }
  return result
}

export interface WebRTCResult {
  pc:           RTCPeerConnection
  audioTrack:   MediaStreamTrack
  videoTrack:   MediaStreamTrack
}

export async function negotiate(
  authSession:   AuthSession,
  streamSession: StreamSession,
  signal:        AbortSignal,
  onProgress?:   (phase: 'ice-exchange' | 'waiting-tracks') => void
): Promise<WebRTCResult> {
  // TEST 1: Empty config like Greenlight (no STUN server)
  // Note: xbox.com also uses empty config and relies on default browser behavior
  const pc = new RTCPeerConnection({})
  pc.addTransceiver('audio', { direction: 'sendrecv' })
  pc.addTransceiver('video', { direction: 'recvonly' })
  preferH264(pc)

  // Register track handler early to avoid missing ontrack events.
  const tracksPromise = new Promise<[MediaStreamTrack, MediaStreamTrack]>((resolve, reject) => {
    const tracks: MediaStreamTrack[] = []
    pc.ontrack = e => {
      console.log('[TRACK] received:', e.track.kind, 'readyState:', e.track.readyState)
      tracks.push(e.track)
      if (tracks.length === 2) {
        const audio = tracks.find(t => t.kind === 'audio')
        const video = tracks.find(t => t.kind === 'video')
        if (!audio || !video) return
        resolve([audio, video])
      }
    }
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
  })

  // Monitor ICE connection state
  pc.oniceconnectionstatechange = () => {
    console.log('[ICE] connection state:', pc.iceConnectionState)
  }
  pc.onconnectionstatechange = () => {
    console.log('[PC] connection state:', pc.connectionState)
  }
  pc.onicegatheringstatechange = () => {
    console.log('[ICE] gathering state:', pc.iceGatheringState)
  }

  // Collect local ICE candidates as they arrive (trickle ICE)
  const localCandidates: RTCIceCandidate[] = []
  const iceGatheringDone = new Promise<void>(resolve => {
    pc.onicecandidate = e => {
      if (e.candidate) localCandidates.push(e.candidate)
      else resolve() // null candidate = gathering complete
    }
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') resolve()
    })
  })

  // Build and patch SDP offer — send immediately (without embedded candidates)
  const offer = await pc.createOffer()
  offer.sdp = patchStereo(offer.sdp ?? '')
  await pc.setLocalDescription(offer)

  // POST SDP offer right away (trickle ICE: no candidates in SDP yet)
  const sdpPost = await fetch(`${SERVER}/streaming/${streamSession.sessionId}/sdp`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      baseUri:       authSession.baseUri,
      gsToken:       authSession.gsToken,
      messageType:   'offer',
      sdp:           offer.sdp,
      requestId:     '1',
      configuration: SDP_CONFIGURATION,
    }),
    signal,
  })
  if (!sdpPost.ok) throw new Error(`SDP post failed: ${sdpPost.status}`)

  const abortRace = new Promise<never>((_, reject) =>
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
  )

  // POST ICE candidates as soon as gathering finishes — in parallel with SDP poll
  const icePostDone = Promise.race([iceGatheringDone, new Promise<void>(r => setTimeout(r, 5000)), abortRace])
    .then(async () => {
      console.log('[ICE] gathered candidates count:', localCandidates.length)
      localCandidates.forEach((c, i) => {
        console.log(`[ICE] candidate ${i}:`, c.candidate)
        console.log(`[ICE]   - sdpMid: ${c.sdpMid}, sdpMLineIndex: ${c.sdpMLineIndex}`)
      })
      
      console.log('[ICE] sending all candidates:', localCandidates.length)
      
      // Notify UI: starting ICE exchange
      onProgress?.('ice-exchange')
      
      // Wait 2s before sending ICE (let SDP settle)
      console.log('[ICE] waiting 2s before sending ICE...')
      await new Promise(r => setTimeout(r, 2000))
      
      // Format candidates like xbox.com does: each candidate is a JSON string
      // containing {candidate, sdpMid, sdpMLineIndex, usernameFragment}
      const formattedCandidates = localCandidates.map(c => 
        JSON.stringify({
          candidate: c.candidate,
          sdpMid: c.sdpMid ?? '',
          sdpMLineIndex: c.sdpMLineIndex ?? 0,
          usernameFragment: c.usernameFragment ?? '',
        })
      )
      
      // Xbox expects "a=end-of-candidates" marker
      formattedCandidates.push('a=end-of-candidates')
      
      console.log('[ICE] formatted candidates:', formattedCandidates)
      
      return fetch(`${SERVER}/streaming/${streamSession.sessionId}/ice`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUri:    authSession.baseUri,
          gsToken:    authSession.gsToken,
          candidates: formattedCandidates,
        }),
        signal,
      })
    })
    .then(r => { if (!r.ok) throw new Error(`ICE send failed: ${r.status}`) })

  // Poll GET /sdp until answer arrives — in parallel with ICE gathering/post
  let exchangeResponse: string | undefined
  while (!exchangeResponse) {
    await new Promise(r => setTimeout(r, 1000))
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    const sdpGet = await fetch(
      `${SERVER}/streaming/${streamSession.sessionId}/sdp?baseUri=${encodeURIComponent(authSession.baseUri)}&gsToken=${encodeURIComponent(authSession.gsToken)}`,
      { signal }
    )
    if (!sdpGet.ok) throw new Error(`SDP poll failed: ${sdpGet.status}`)
    const data = await sdpGet.json() as { exchangeResponse?: string }
    exchangeResponse = data.exchangeResponse
  }

  await pc.setRemoteDescription({ type: 'answer', sdp: JSON.parse(exchangeResponse).sdp as string })

  // Wait for ICE post to finish before polling remote candidates
  await icePostDone

  // Poll GET /ice until server has candidates
  type RemoteCandidate = { candidate: string; sdpMid?: string; sdpMLineIndex?: number }
  let remoteCandidates: RemoteCandidate[] = []
  while (remoteCandidates.length === 0) {
    await new Promise(r => setTimeout(r, 1000))
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    const remoteIceRes = await fetch(
      `${SERVER}/streaming/${streamSession.sessionId}/ice?baseUri=${encodeURIComponent(authSession.baseUri)}&gsToken=${encodeURIComponent(authSession.gsToken)}`,
      { signal }
    )
    if (!remoteIceRes.ok && remoteIceRes.status !== 204) throw new Error(`ICE fetch failed: ${remoteIceRes.status}`)
    if (remoteIceRes.status === 204) continue
    const data = await remoteIceRes.json() as { exchangeResponse?: string }
    console.log('[ICE] GET /ice response:', JSON.stringify(data))
    if (!data.exchangeResponse) continue
    // Xbox returns an array of candidate objects, not a wrapper object
    remoteCandidates = JSON.parse(data.exchangeResponse) as RemoteCandidate[]
  }

  console.log('[ICE] received', remoteCandidates.length, 'remote candidates')
  
  // Extract just the candidate strings for expandCandidates
  const candidateStrings = remoteCandidates.map(c => c.candidate)
  
  for (const c of expandCandidates(candidateStrings)) {
    // Skip end-of-candidates marker
    if (c === 'a=end-of-candidates') continue
    console.log('[ICE] adding remote candidate:', c)
    await pc.addIceCandidate({ candidate: c, sdpMid: '0' })
  }

  console.log('[ICE] All remote candidates added, waiting for connection...')
  
  // Notify UI: waiting for tracks/connection
  onProgress?.('waiting-tracks')

  // Wait for tracks
  const [audioTrack, videoTrack] = await tracksPromise

  return { pc, audioTrack, videoTrack }
}
