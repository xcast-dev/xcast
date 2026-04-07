import type { AuthSession } from '../auth/xsts'
import negotiate from '../webrtc/negotiation'
import type { NegotiationOptions, WebRTCResult } from '../webrtc/negotiation'
import { deleteSession, pollUntilProvisioned, startSession } from './session'
import type { StreamSession } from './session'

export interface ReconnectContext {
  authSession: AuthSession
  refreshToken: string
  consoleId: string
  options: NegotiationOptions
  oldStreamSession?: StreamSession
  signal: AbortSignal
}

export interface ReconnectResult {
  streamSession: StreamSession
  webrtc: WebRTCResult
}

async function reconnect(context: ReconnectContext): Promise<ReconnectResult> {
  const { authSession, refreshToken, consoleId, oldStreamSession, signal, options } = context

  if (oldStreamSession) {
    try {
      await pollUntilProvisioned(authSession, oldStreamSession.sessionId, refreshToken, signal)
      const resumedWebrtc = await negotiate(authSession, oldStreamSession, signal, options)
      return { streamSession: oldStreamSession, webrtc: resumedWebrtc }
    } catch {
      // Resume-first: if existing session is no longer usable, fall back to a fresh session below.
    }
  }

  if (oldStreamSession) {
    await deleteSession(authSession, oldStreamSession.sessionId).catch(() => undefined)
  }

  const streamSession = await startSession(authSession, consoleId, { quality: options.quality })
  await pollUntilProvisioned(authSession, streamSession.sessionId, refreshToken, signal)
  const webrtc = await negotiate(authSession, streamSession, signal, options)
  return { streamSession, webrtc }
}

export { reconnect }
export default reconnect
