import type { AuthSession } from '../auth/xsts'
import type { StreamSession } from '../streaming/session'

const SERVER = 'http://localhost:1209'
const CONTROL_ACCESS_KEY = '4BDB3609-C1F1-4195-9B37-FEFF45DA8B8E'

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

interface DataChannels {
  message: RTCDataChannel
  control: RTCDataChannel
  input:   RTCDataChannel
  chat:    RTCDataChannel
}

function createDataChannels(pc: RTCPeerConnection): DataChannels {
  return {
    message: pc.createDataChannel('message', { ordered: true, protocol: 'messageV1' }),
    control: pc.createDataChannel('control', { ordered: true, protocol: 'controlV1' }),
    input:   pc.createDataChannel('input',   { ordered: true, protocol: '1.0' }),
    chat:    pc.createDataChannel('chat',    { ordered: true, protocol: 'chatV1' }),
  }
}

function sendMessageHandshake(message: RTCDataChannel): void {
  message.send(JSON.stringify({ type: 'Handshake', version: 'messageV1', id: crypto.randomUUID(), cv: '0' }))
}

function sendConfigurationMessages(message: RTCDataChannel): void {
  const send = (target: string, content: Record<string, unknown>) =>
    message.send(JSON.stringify({ type: 'Message', target, content }))

  send('/streaming/systemUi/configuration', { version: [0, 2, 0], systemUis: [] })
  send('/streaming/properties/clientappinstallidchanged', { clientAppInstallId: crypto.randomUUID() })
  send('/streaming/characteristics/orientationchanged', { orientation: 0 })
  send('/streaming/characteristics/touchinputenabledchanged', { touchInputEnabled: false })
  send('/streaming/characteristics/clientdevicecapabilities', {})
  send('/streaming/characteristics/dimensionschanged', {
    horizontal: 1920, vertical: 1080,
    preferredWidth: 1920, preferredHeight: 1080,
    safeAreaLeft: 0, safeAreaTop: 0, safeAreaRight: 1920, safeAreaBottom: 1080,
    supportsCustomResolution: true,
  })
}

function sendControlAuth(control: RTCDataChannel): void {
  control.send(JSON.stringify({ message: 'authorizationRequest', accessKey: CONTROL_ACCESS_KEY }))
  // Reset gamepad slots then register slot 0 — mirrors Greenlight's sendAuthorization sequence.
  control.send(JSON.stringify({ message: 'gamepadChanged', gamepadIndex: 0, wasAdded: true }))
  control.send(JSON.stringify({ message: 'gamepadChanged', gamepadIndex: 0, wasAdded: false }))
}

function buildClientMetadata(seq: number): ArrayBuffer {
  const buf = new ArrayBuffer(15)
  const v = new DataView(buf)
  v.setUint16(0, 8, true)               // reportType
  v.setUint32(2, seq, true)             // sequenceNumber
  v.setFloat64(6, performance.now(), true)
  v.setUint8(14, navigator.maxTouchPoints)
  return buf
}

function normalizeAxis(value: number): number {
  const deadzone = 0.12
  const abs = Math.abs(value)
  if (abs < deadzone) return 0
  const normalized = (abs - deadzone) / (1 - deadzone)
  const curved = Math.pow(normalized, 0.75)
  return Math.sign(value) * curved
}

function normalizeTrigger(value: number): number {
  return Math.min(Math.round(Math.max(0, value) * 65535), 65535)
}

// Returns the 24-byte gamepad payload: 1-byte frame count + 23-byte gamepad frame.
// Deduplication compares only bytes 1-23 (the actual state, not the frame count).
function buildGamepadData(gp: Gamepad): Uint8Array {
  const buf = new ArrayBuffer(24)
  const v = new DataView(buf)
  const b = gp.buttons
  let mask = 0
  if (b[16]?.pressed) mask |= 1 << 1   // Nexus
  if (b[9]?.pressed)  mask |= 1 << 2   // Menu
  if (b[8]?.pressed)  mask |= 1 << 3   // View
  if (b[0]?.pressed)  mask |= 1 << 4   // A
  if (b[1]?.pressed)  mask |= 1 << 5   // B
  if (b[2]?.pressed)  mask |= 1 << 6   // X
  if (b[3]?.pressed)  mask |= 1 << 7   // Y
  if (b[12]?.pressed) mask |= 1 << 8   // DPad Up
  if (b[13]?.pressed) mask |= 1 << 9   // DPad Down
  if (b[14]?.pressed) mask |= 1 << 10  // DPad Left
  if (b[15]?.pressed) mask |= 1 << 11  // DPad Right
  if (b[4]?.pressed)  mask |= 1 << 12  // L Shoulder
  if (b[5]?.pressed)  mask |= 1 << 13  // R Shoulder
  if (b[10]?.pressed) mask |= 1 << 14  // L Thumb
  if (b[11]?.pressed) mask |= 1 << 15  // R Thumb
  const a = gp.axes
  v.setUint8(0, 1)           // frame count = 1
  v.setUint8(1, gp.index)
  v.setUint16(2, mask, true)
  v.setInt16(4,  Math.round(normalizeAxis(a[0] ?? 0) * 32767), true)   // LX
  v.setInt16(6,  Math.round(-normalizeAxis(a[1] ?? 0) * 32767), true)  // LY
  v.setInt16(8,  Math.round(normalizeAxis(a[2] ?? 0) * 32767), true)   // RX
  v.setInt16(10, Math.round(-normalizeAxis(a[3] ?? 0) * 32767), true)  // RY
  v.setUint16(12, normalizeTrigger(b[6]?.value ?? 0), true)            // LT
  v.setUint16(14, normalizeTrigger(b[7]?.value ?? 0), true)            // RT
  v.setUint32(16, 1, true)   // PhysicalPhysicality (LE)
  v.setUint32(20, 1, false)  // VirtualPhysicality (BE)
  return new Uint8Array(buf)
}

// Wraps a data payload with the 14-byte universal input header.
function wrapInputFrame(data: Uint8Array, reportType: number, seq: number): ArrayBuffer {
  const buf = new ArrayBuffer(14 + data.byteLength)
  const v = new DataView(buf)
  v.setUint16(0, reportType, true)
  v.setUint32(2, seq, true)
  v.setFloat64(6, performance.now(), true)
  new Uint8Array(buf).set(data, 14)
  return buf
}

function isPreferredGamepad(g: Gamepad): boolean {
  const id = g.id.toLowerCase()
  return (
    id.includes('xbox') ||
    id.includes('xinput') ||
    id.includes('wireless controller') ||
    id.includes('vendor: 045e')
  )
}

function startGamepadLoop(channel: RTCDataChannel, controlChannel: RTCDataChannel, seqRef: { value: number }, signal: AbortSignal): void {
  let stopped = false
  let last: Uint8Array | null = null
  let pending: ArrayBuffer | null = null
  let flushScheduled = false
  let registeredIndex = -1
  let rafId = 0

  const stop = () => {
    stopped = true
    if (rafId) cancelAnimationFrame(rafId)
  }

  signal.addEventListener('abort', stop, { once: true })
  channel.addEventListener('close', stop, { once: true })

  const flushPending = () => {
    flushScheduled = false
    if (stopped || channel.readyState !== 'open') return
    if (channel.bufferedAmount > 8192) {
      scheduleFlush()
      return
    }
    if (!pending) return
    channel.send(pending)
    pending = null
  }

  const scheduleFlush = () => {
    if (flushScheduled) return
    flushScheduled = true
    queueMicrotask(flushPending)
  }

  const tick = () => {
    if (stopped || channel.readyState !== 'open') return
    const gp = Array.from(navigator.getGamepads())
      .filter((g): g is Gamepad => !!g && g.connected)
      .find(isPreferredGamepad)
    if (!gp) {
      registeredIndex = -1
    } else {
      if (registeredIndex !== gp.index) {
        controlChannel.send(JSON.stringify({ message: 'gamepadChanged', gamepadIndex: gp.index, wasAdded: true }))
        registeredIndex = gp.index
      }
      const data = buildGamepadData(gp)
      if (!last || data.some((b, i) => b !== last![i])) {
        pending = wrapInputFrame(data, 2 /* Gamepad */, seqRef.value++)
        scheduleFlush()
        last = data
      }
    }
    rafId = requestAnimationFrame(tick)
  }
  tick()
}

function whenOpen(channel: RTCDataChannel, fn: () => void): void {
  if (channel.readyState === 'open') { fn(); return }
  channel.addEventListener('open', fn, { once: true })
}

function initDataChannels(channels: DataChannels, signal: AbortSignal): void {
  let handshaked = false
  const seqRef = { value: 0 }

  channels.message.onopen = () => sendMessageHandshake(channels.message)

  channels.message.onmessage = event => {
    if (typeof event.data !== 'string') return
    try {
      const msg = JSON.parse(event.data) as { type?: string; target?: string; id?: string }

      if (msg.type === 'HandshakeAck' && !handshaked) {
        handshaked = true
        whenOpen(channels.control, () => sendControlAuth(channels.control))
        whenOpen(channels.input, () => {
          channels.input.send(buildClientMetadata(seqRef.value++))
          startGamepadLoop(channels.input, channels.control, seqRef, signal)
        })
        sendConfigurationMessages(channels.message)
        return
      }

      // Auto-dismiss system dialogs (e.g. "stream starting" toast)
      if (msg.target === '/streaming/systemUi/messages/ShowMessageDialog' && msg.id) {
        channels.message.send(JSON.stringify({
          type: 'TransactionComplete', content: '{"Result": 0}', id: msg.id, cv: '',
        }))
      }
    } catch { /* resilient to non-JSON frames */ }
  }
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
  pc:         RTCPeerConnection
  audioTrack: MediaStreamTrack
  videoTrack: MediaStreamTrack
  channels:   DataChannels
}

export async function negotiate(
  authSession:   AuthSession,
  streamSession: StreamSession,
  signal:        AbortSignal,
  onProgress?:   (phase: 'ice-exchange' | 'waiting-tracks') => void
): Promise<WebRTCResult> {
  const pc = new RTCPeerConnection({})
  // Data channels must be created before the offer so they appear in the SDP.
  const channels = createDataChannels(pc)
  initDataChannels(channels, signal)
  pc.addTransceiver('audio', { direction: 'sendrecv' })
  pc.addTransceiver('video', { direction: 'recvonly' })
  preferH264(pc)

  // Register track handler early to avoid missing ontrack events.
  const tracksPromise = new Promise<[MediaStreamTrack, MediaStreamTrack]>((resolve, reject) => {
    const tracks: MediaStreamTrack[] = []
    pc.ontrack = e => {
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
      onProgress?.('ice-exchange')

      // Wait 2s before sending ICE (let SDP settle)
      await new Promise(r => setTimeout(r, 2000))

      // Each candidate is serialized as a JSON string; Xbox expects "a=end-of-candidates" as the last entry.
      const formattedCandidates = localCandidates.map(c =>
        JSON.stringify({
          candidate: c.candidate,
          sdpMid: c.sdpMid ?? '',
          sdpMLineIndex: c.sdpMLineIndex ?? 0,
          usernameFragment: c.usernameFragment ?? '',
        })
      )
      formattedCandidates.push('a=end-of-candidates')

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
    if (!data.exchangeResponse) continue
    // Xbox returns an array of candidate objects, not a wrapper object
    remoteCandidates = JSON.parse(data.exchangeResponse) as RemoteCandidate[]
  }

  const candidateStrings = remoteCandidates.map(c => c.candidate)
  for (const c of expandCandidates(candidateStrings)) {
    if (c === 'a=end-of-candidates') continue
    await pc.addIceCandidate({ candidate: c, sdpMid: '0' })
  }

  onProgress?.('waiting-tracks')

  // Wait for tracks
  const [audioTrack, videoTrack] = await tracksPromise

  return { pc, audioTrack, videoTrack, channels }
}
