import type { AuthSession } from '../auth/xsts'
import type { StreamSession } from '../streaming/session'
import { getPreferredResolution, type H264Profile, type StreamQuality } from '../settings/preferences'

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
    input:   pc.createDataChannel('input',   { ordered: false, maxRetransmits: 0, protocol: '1.0' }),
    chat:    pc.createDataChannel('chat',    { ordered: true, protocol: 'chatV1' }),
  }
}

function sendMessageHandshake(message: RTCDataChannel): void {
  message.send(JSON.stringify({ type: 'Handshake', version: 'messageV1', id: crypto.randomUUID(), cv: '0' }))
}

function sendConfigurationMessages(message: RTCDataChannel, quality: StreamQuality): void {
  const resolution = getPreferredResolution(quality)
  const send = (target: string, content: Record<string, unknown>) =>
    message.send(JSON.stringify({ type: 'Message', target, content }))

  send('/streaming/systemUi/configuration', { version: [0, 2, 0], systemUis: [] })
  send('/streaming/properties/clientappinstallidchanged', { clientAppInstallId: crypto.randomUUID() })
  send('/streaming/characteristics/orientationchanged', { orientation: 0 })
  send('/streaming/characteristics/touchinputenabledchanged', { touchInputEnabled: false })
  send('/streaming/characteristics/clientdevicecapabilities', {})
  send('/streaming/characteristics/dimensionschanged', {
    horizontal: resolution.width, vertical: resolution.height,
    preferredWidth: resolution.width, preferredHeight: resolution.height,
    safeAreaLeft: 0, safeAreaTop: 0, safeAreaRight: resolution.width, safeAreaBottom: resolution.height,
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
  const INPUT_TICK_MS = 1000 / 120
  const INPUT_BUFFER_HIGH_WATERMARK = 8192
  const INPUT_BUFFER_LOW_WATERMARK = 2048

  let stopped = false
  let lastSentOrQueued: Uint8Array | null = null
  let pending: ArrayBuffer | null = null
  let flushScheduled = false
  let registeredIndex = -1
  let tickTimer = 0

  const stop = () => {
    stopped = true
    if (tickTimer) window.clearInterval(tickTimer)
    channel.removeEventListener('bufferedamountlow', scheduleFlush)
  }

  signal.addEventListener('abort', stop, { once: true })
  channel.addEventListener('close', stop, { once: true })
  channel.bufferedAmountLowThreshold = INPUT_BUFFER_LOW_WATERMARK
  channel.addEventListener('bufferedamountlow', scheduleFlush)

  const hasInputChanged = (next: Uint8Array, prev: Uint8Array): boolean =>
    next.some((value, index) => value !== prev[index])

  const isCriticalInputChange = (next: Uint8Array, prev: Uint8Array): boolean => {
    for (let i = 2; i <= 15; i += 1) {
      if (next[i] !== prev[i]) return true
    }
    return false
  }

  const flushPending = () => {
    flushScheduled = false
    if (stopped || channel.readyState !== 'open') return
    if (channel.bufferedAmount > INPUT_BUFFER_HIGH_WATERMARK) {
      scheduleFlush()
      return
    }
    if (!pending) return
    channel.send(pending)
    pending = null
  }

  function scheduleFlush() {
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
      if (!lastSentOrQueued || hasInputChanged(data, lastSentOrQueued)) {
        const isCritical = !lastSentOrQueued || isCriticalInputChange(data, lastSentOrQueued)
        if (channel.bufferedAmount > INPUT_BUFFER_HIGH_WATERMARK && !isCritical) return
        pending = wrapInputFrame(data, 2 /* Gamepad */, seqRef.value++)
        lastSentOrQueued = data
        if (isCritical) {
          flushPending()
        } else {
          scheduleFlush()
        }
      }
    }
  }
  tick()
  tickTimer = window.setInterval(tick, INPUT_TICK_MS)
}

function whenOpen(channel: RTCDataChannel, fn: () => void): void {
  if (channel.readyState === 'open') { fn(); return }
  channel.addEventListener('open', fn, { once: true })
}

interface VibrationCommand {
  gamepadIndex: number
  leftMotor: number
  rightMotor: number
  durationMs: number
  delayMs: number
  repeat: number
}

function parseVibrationWithReportType(view: DataView, offset: number): VibrationCommand | null {
  if (view.byteLength < offset + 13) return null
  if (view.getUint8(offset) !== 128) return null
  return {
    gamepadIndex: view.getUint8(offset + 3),
    leftMotor: Math.max(0, Math.min(1, view.getUint8(offset + 4) / 100)),
    rightMotor: Math.max(0, Math.min(1, view.getUint8(offset + 5) / 100)),
    durationMs: view.getUint16(offset + 8, true),
    delayMs: view.getUint16(offset + 10, true),
    repeat: view.getUint8(offset + 12),
  }
}

function parseVibrationFromBinary(data: ArrayBuffer): VibrationCommand | null {
  const view = new DataView(data)

  const direct = parseVibrationWithReportType(view, 0)
  if (direct) return direct

  // Universal input header (14 bytes): reportType at [0..1], payload starts at 14.
  const reportType = view.getUint16(0, true)
  if (reportType === 128) {
    const wrapped = parseVibrationWithReportType(view, 14)
    if (wrapped) return wrapped

    // Variant observed in some clients: payload may omit inner reportType byte.
    if (view.byteLength >= 24) {
      return {
        gamepadIndex: view.getUint8(14),
        leftMotor: Math.max(0, Math.min(1, view.getUint8(15) / 100)),
        rightMotor: Math.max(0, Math.min(1, view.getUint8(16) / 100)),
        durationMs: view.getUint16(19, true),
        delayMs: view.getUint16(21, true),
        repeat: view.getUint8(23),
      }
    }
  }
  return null
}

async function applyVibrationCommand(command: VibrationCommand): Promise<void> {
  const gamepads = navigator.getGamepads()
  const hasActuator = (g: Gamepad | null): g is Gamepad => {
    if (!g || !g.connected) return false
    const extended = g as Gamepad & { hapticActuators?: GamepadHapticActuator[] }
    return Boolean(g.vibrationActuator) || Boolean(extended.hapticActuators?.length)
  }
  const directGamepad = gamepads[command.gamepadIndex] ?? null
  const targetGamepad = hasActuator(directGamepad) ? directGamepad : gamepads.find(hasActuator) ?? null
  if (!targetGamepad) return

  const extendedGamepad = targetGamepad as Gamepad & { hapticActuators?: GamepadHapticActuator[] }
  const actuators = [
    targetGamepad.vibrationActuator,
    ...(extendedGamepad.hapticActuators ?? []),
  ].filter(Boolean)
  if (!actuators.length) return

  const repeatCount = Math.max(1, Math.min(command.repeat + 1, 6))
  const duration = Math.max(10, Math.min(command.durationMs, 4000))
  const delay = Math.max(0, Math.min(command.delayMs, 1000))
  const effect = {
    startDelay: delay,
    duration,
    weakMagnitude: Math.max(0, Math.min(1, command.leftMotor)),
    strongMagnitude: Math.max(0, Math.min(1, command.rightMotor)),
  } as const
  for (let pass = 0; pass < repeatCount; pass += 1) {
    for (const actuator of actuators) {
      if (!actuator) continue
      await actuator.playEffect('dual-rumble', effect).catch(() => undefined)
    }
  }
}

function bindVibrationHandler(
  channel: RTCDataChannel,
  vibrationTimers: Set<number>,
  channelName: 'control' | 'input'
): void {
  channel.onmessage = event => {
    const data = event.data
    if (typeof data === 'string') return
    const handle = (buffer: ArrayBuffer) => {
      const vibration = parseVibrationFromBinary(buffer)
      if (!vibration) return
      if (import.meta.env.DEV) {
        console.debug(
          `[xcast][vibration] ${channelName} idx=${vibration.gamepadIndex} weak=${vibration.leftMotor} strong=${vibration.rightMotor} duration=${vibration.durationMs} repeat=${vibration.repeat} bytes=${buffer.byteLength}`
        )
      }
      const plays = Math.max(1, vibration.repeat + 1)
      const spacing = Math.max(vibration.durationMs + vibration.delayMs, 16)
      for (let i = 0; i < plays; i += 1) {
        const timer = window.setTimeout(() => {
          vibrationTimers.delete(timer)
          void applyVibrationCommand(vibration)
        }, i * spacing)
        vibrationTimers.add(timer)
      }
    }

    if (data instanceof ArrayBuffer) {
      handle(data)
      return
    }
    if (data instanceof Blob) {
      void data.arrayBuffer().then(handle).catch(() => undefined)
    }
  }
}

function initDataChannels(channels: DataChannels, signal: AbortSignal, quality: StreamQuality): void {
  let handshaked = false
  const seqRef = { value: 0 }
  const vibrationTimers = new Set<number>()

  const clearVibrationTimers = () => {
    for (const timer of vibrationTimers) window.clearTimeout(timer)
    vibrationTimers.clear()
  }
  signal.addEventListener('abort', clearVibrationTimers, { once: true })
  channels.control.addEventListener('close', clearVibrationTimers, { once: true })
  channels.input.addEventListener('close', clearVibrationTimers, { once: true })

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
        sendConfigurationMessages(channels.message, quality)
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

  bindVibrationHandler(channels.control, vibrationTimers, 'control')
  bindVibrationHandler(channels.input, vibrationTimers, 'input')
}

// Reorder video codecs according to user profile preference.
function preferH264(pc: RTCPeerConnection, preferredProfile: H264Profile): void {
  const caps = RTCRtpReceiver.getCapabilities('video')
  if (!caps) return

  const preferredOrder: Record<H264Profile, string[]> = {
    high: ['64', '4d', '42'],
    main: ['4d', '64', '42'],
    baseline: ['42', '4d', '64'],
  }
  const rankByProfile = preferredOrder[preferredProfile]

  const profileIdPrefix = (fmtp?: string): string | null => {
    if (!fmtp) return null
    const match = fmtp.match(/profile-level-id=([0-9a-fA-F]{6})/)
    if (!match) return null
    return match[1].slice(0, 2).toLowerCase()
  }

  const sorted = [...caps.codecs].sort((a, b) => {
    const pa = rankByProfile.findIndex(p => profileIdPrefix(a.sdpFmtpLine) === p)
    const pb = rankByProfile.findIndex(p => profileIdPrefix(b.sdpFmtpLine) === p)
    return (pa === -1 ? 999 : pa) - (pb === -1 ? 999 : pb)
  })

  const [videoTransceiver] = pc.getTransceivers().filter(t => t.receiver.track.kind === 'video')
  videoTransceiver?.setCodecPreferences(sorted)

  const codecSummary = sorted
    .filter(c => c.mimeType.toLowerCase().includes('h264'))
    .slice(0, 5)
    .map(c => {
      const match = c.sdpFmtpLine?.match(/profile-level-id=([0-9a-fA-F]{6})/)
      const profile = match?.[1]?.slice(0, 2)?.toLowerCase() ?? '--'
      return `${c.mimeType}:${profile}`
    })
    .join(', ')
  console.info(`[xcast][webrtc] codec order requested (${preferredProfile}): ${codecSummary || 'none'}`)
}

// Patch SDP: enable stereo on opus audio.
function patchStereo(sdp: string): string {
  return sdp.replace(/useinbandfec=1/g, 'useinbandfec=1; stereo=1')
}

interface LatencySdpCaps {
  minKbps: number
  startKbps: number
  maxKbps: number
  maxFr: number
  maxFs: number
}

function getOptimizedSdpCaps(): LatencySdpCaps {
  return { minKbps: 1200, startKbps: 1800, maxKbps: 3000, maxFr: 30, maxFs: 3600 }
}

function patchLatencyConstraints(sdp: string): string {
  const caps = getOptimizedSdpCaps()
  const lines = sdp.split('\n')
  const videoStart = lines.findIndex(line => line.startsWith('m=video'))
  if (videoStart === -1) return sdp
  let videoEnd = lines.findIndex((line, index) => index > videoStart && line.startsWith('m='))
  if (videoEnd === -1) videoEnd = lines.length

  const videoLines = lines.slice(videoStart, videoEnd).filter(line => !line.startsWith('b=AS:') && !line.startsWith('b=TIAS:'))
  const cLineIndex = videoLines.findIndex(line => line.startsWith('c='))
  const bitrateLines = [`b=AS:${caps.maxKbps}`, `b=TIAS:${caps.maxKbps * 1000}`]
  if (cLineIndex >= 0) {
    videoLines.splice(cLineIndex + 1, 0, ...bitrateLines)
  } else {
    videoLines.splice(1, 0, ...bitrateLines)
  }

  const payloadByCodec = new Map<string, Set<string>>()
  for (const line of videoLines) {
    const match = line.match(/^a=rtpmap:(\d+)\s+([^/]+)/i)
    if (!match) continue
    const payload = match[1]
    const codec = match[2].toLowerCase()
    const payloads = payloadByCodec.get(codec) ?? new Set<string>()
    payloads.add(payload)
    payloadByCodec.set(codec, payloads)
  }

  const h264Payloads = payloadByCodec.get('h264') ?? new Set<string>()
  const constrainedVideoLines = videoLines.map(line => {
    const fmtpMatch = line.match(/^a=fmtp:(\d+)\s+(.+)$/i)
    if (!fmtpMatch) return line
    const payload = fmtpMatch[1]
    if (!h264Payloads.has(payload)) return line
    const params = fmtpMatch[2]
    const extras = [
      `x-google-min-bitrate=${caps.minKbps}`,
      `x-google-start-bitrate=${caps.startKbps}`,
      `x-google-max-bitrate=${caps.maxKbps}`,
      `max-fr=${caps.maxFr}`,
      `max-fs=${caps.maxFs}`,
    ]
    const merged = [...extras.filter(extra => !params.includes(extra.split('=')[0])), params].join('; ')
    return `a=fmtp:${payload} ${merged}`
  })

  const patchedLines = [...lines.slice(0, videoStart), ...constrainedVideoLines, ...lines.slice(videoEnd)]
  return patchedLines.join('\n')
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

function parseH264ProfileFromSdp(sdp: string): string {
  const lines = sdp.split('\n').map(line => line.trim())
  const videoMLine = lines.find(line => line.startsWith('m=video'))
  if (!videoMLine) return 'unknown'
  const payloads = videoMLine
    .split(' ')
    .slice(3)
    .map(token => Number(token))
    .filter(Number.isFinite)
  const rtpmap = new Map<number, string>()
  const fmtp = new Map<number, string>()
  for (const line of lines) {
    const rtpMatch = line.match(/^a=rtpmap:(\d+)\s+([^/]+)/i)
    if (rtpMatch) {
      rtpmap.set(Number(rtpMatch[1]), rtpMatch[2].toLowerCase())
      continue
    }
    const fmtpMatch = line.match(/^a=fmtp:(\d+)\s+(.+)$/i)
    if (fmtpMatch) {
      fmtp.set(Number(fmtpMatch[1]), fmtpMatch[2])
    }
  }
  for (const payload of payloads) {
    if (rtpmap.get(payload) !== 'h264') continue
    const fmtpLine = fmtp.get(payload) ?? ''
    const profileMatch = fmtpLine.match(/profile-level-id=([0-9a-fA-F]{6})/)
    const profile = profileMatch?.[1]?.slice(0, 2)?.toLowerCase()
    if (!profile) return 'h264(unknown)'
    if (profile === '42') return 'h264-baseline'
    if (profile === '4d') return 'h264-main'
    if (profile === '64') return 'h264-high'
    return `h264-${profile}`
  }
  return 'non-h264'
}

export interface WebRTCResult {
  pc:         RTCPeerConnection
  audioTrack: MediaStreamTrack
  videoTrack: MediaStreamTrack
  channels:   DataChannels
}

export interface NegotiationOptions {
  quality: StreamQuality
  h264Profile: H264Profile
}

async function negotiate(
  authSession:   AuthSession,
  streamSession: StreamSession,
  signal:        AbortSignal,
  options:       NegotiationOptions,
  onProgress?:   (phase: 'ice-exchange' | 'waiting-tracks') => void
): Promise<WebRTCResult> {
  const pc = new RTCPeerConnection({})
  console.info(
    `[xcast][webrtc] negotiate requested profile=${options.quality} h264=${options.h264Profile}`
  )
  // Data channels must be created before the offer so they appear in the SDP.
  const channels = createDataChannels(pc)
  initDataChannels(channels, signal, options.quality)
  pc.addTransceiver('audio', { direction: 'sendrecv' })
  pc.addTransceiver('video', { direction: 'recvonly' })
  preferH264(pc, options.h264Profile)

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
  let patchedSdp = patchStereo(offer.sdp ?? '')
  if (options.quality === 'optimized') {
    patchedSdp = patchLatencyConstraints(patchedSdp)
    const caps = getOptimizedSdpCaps()
    console.info(
      `[xcast][webrtc] optimized caps profile=${options.quality} bitrate=${caps.minKbps}-${caps.maxKbps}kbps start=${caps.startKbps} maxFr=${caps.maxFr}`
    )
  }
  offer.sdp = patchedSdp
  await pc.setLocalDescription(offer)
  const offerProfile = parseH264ProfileFromSdp(offer.sdp ?? '')
  console.info(`[xcast][webrtc] local offer video profile=${offerProfile}`)

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

  const answerSdp = JSON.parse(exchangeResponse).sdp as string
  const answerProfile = parseH264ProfileFromSdp(answerSdp)
  console.info(`[xcast][webrtc] remote answer video profile=${answerProfile}`)
  await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })

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

export { negotiate }
export default negotiate
