import type { AuthSession } from '../auth/xsts'
import { negotiate } from '../webrtc/negotiation'
import type { WebRTCResult } from '../webrtc/negotiation'
import { deleteSession, pollUntilProvisioned, startSession } from './session'
import type { StreamSession } from './session'

export interface ReconnectContext {
  authSession: AuthSession
  refreshToken: string
  consoleId: string
  oldStreamSession?: StreamSession
  signal: AbortSignal
}

export interface ReconnectResult {
  streamSession: StreamSession
  webrtc: WebRTCResult
}

export async function reconnect(context: ReconnectContext): Promise<ReconnectResult> {
  const { authSession, refreshToken, consoleId, oldStreamSession, signal } = context

  if (oldStreamSession) {
    await deleteSession(authSession, oldStreamSession.sessionId).catch(() => undefined)
  }

  const streamSession = await startSession(authSession, consoleId)
  await pollUntilProvisioned(authSession, streamSession.sessionId, refreshToken, signal)
  const webrtc = await negotiate(authSession, streamSession, signal)
  return { streamSession, webrtc }
}
