import type { FastifyInstance } from 'fastify'

type StreamQuality = 'full' | 'optimized'

function resolutionForQuality(quality: StreamQuality): { width: number; height: number } {
  void quality
  return { width: 1920, height: 1080 }
}

function buildDeviceInfo(quality: StreamQuality): string {
  const resolution = resolutionForQuality(quality)
  return JSON.stringify({
    appInfo: {
      env: {
        clientAppId:      'Microsoft.GamingApp',
        clientAppType:    'native',
        clientAppVersion: '2203.1001.4.0',
        clientSdkVersion: '8.5.2',
        httpEnvironment:  'prod',
        sdkInstallId:     '',
      },
    },
    dev: {
      hw:  { make: 'Microsoft', model: 'Surface Pro', sdktype: 'native' },
      os:  { name: 'Windows 11', ver: '22631.2715', platform: 'desktop' },
      displayInfo: {
        dimensions:   { widthInPixels: resolution.width, heightInPixels: resolution.height },
        pixelDensity: { dpiX: 2, dpiY: 2 },
      },
    },
  })
}

function streamingHeaders(gsToken: string, quality: StreamQuality = 'full') {
  return {
    'Accept':           'application/json',
    'Content-Type':     'application/json',
    'X-Gssv-Client':    'XboxComBrowser',
    'X-MS-Device-Info': buildDeviceInfo(quality),
    'Authorization':    `Bearer ${gsToken}`,
  }
}

export async function streamingRoutes(server: FastifyInstance) {
  server.post('/streaming/play', async (request, reply) => {
    const { baseUri, gsToken, serverId, quality = 'full' } = request.body as {
      baseUri: string; gsToken: string; serverId: string; quality?: StreamQuality
    }
    const playQuality = quality
    const resolution = resolutionForQuality(playQuality)
    console.log(`[SERVER] /play requested quality=${quality} applied=${playQuality} deviceInfo=${resolution.width}x${resolution.height}`)
    const res = await fetch(`${baseUri}/v5/sessions/home/play`, {
      method:  'POST',
      headers: streamingHeaders(gsToken, playQuality),
      body: JSON.stringify({
        titleId:           '',
        serverId,
        systemUpdateGroup: '',
        clientSessionId:   '',
        settings: {
          nanoVersion:                  'V3;WebrtcTransport.dll',
          enableOptionalDataCollection: false,
          enableTextToSpeech:           false,
          highContrast:                 0,
          locale:                       'en-US',
          useIceConnection:             false,
          timezoneOffsetMinutes:        120,
          sdkType:                      'web',
          osName:                       'windows',
        },
        fallbackRegionNames: [],
      }),
    })
    const text = await res.text()
    return reply.status(res.status).send(text ? JSON.parse(text) : {})
  })

  server.post('/streaming/:sessionId/state', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string }
    const { baseUri, gsToken } = request.body as { baseUri: string; gsToken: string }
    const res = await fetch(`${baseUri}/v5/sessions/home/${sessionId}/state`, {
      headers: streamingHeaders(gsToken),
    })
    const text = await res.text()
    const data = text ? JSON.parse(text) : {}
    console.log('[SERVER] GET /state response:', JSON.stringify(data))
    return reply.status(res.status).send(data)
  })

  server.post('/streaming/:sessionId/connect', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string }
    const { baseUri, gsToken, userToken } = request.body as {
      baseUri: string; gsToken: string; userToken: string
    }
    console.log('[SERVER] POST /connect for session:', sessionId)
    const res = await fetch(`${baseUri}/v5/sessions/home/${sessionId}/connect`, {
      method:  'POST',
      headers: streamingHeaders(gsToken),
      body:    JSON.stringify({ userToken }),
    })
    const text = await res.text()
    console.log('[SERVER] POST /connect Xbox response status:', res.status)
    console.log('[SERVER] POST /connect Xbox response body:', text || '(empty)')
    return reply.status(res.status).send(text ? JSON.parse(text) : {})
  })

  server.post('/streaming/:sessionId/keepalive', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string }
    const { baseUri, gsToken } = request.body as { baseUri: string; gsToken: string }
    const res = await fetch(`${baseUri}/v5/sessions/home/${sessionId}/keepalive`, {
      method:  'POST',
      headers: streamingHeaders(gsToken),
      body:    '{}',
    })
    return reply.status(res.status).send({})
  })

  server.post('/streaming/:sessionId/sdp', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string }
    const { baseUri, gsToken, ...body } = request.body as {
      baseUri: string; gsToken: string; [k: string]: unknown
    }
    const res = await fetch(`${baseUri}/v5/sessions/home/${sessionId}/sdp`, {
      method:  'POST',
      headers: streamingHeaders(gsToken),
      body:    JSON.stringify(body),
    })
    const text = await res.text()
    return reply.status(res.status).send(text ? JSON.parse(text) : {})
  })

  server.get('/streaming/:sessionId/sdp', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string }
    const { baseUri, gsToken } = request.query as { baseUri: string; gsToken: string }
    const res = await fetch(`${baseUri}/v5/sessions/home/${sessionId}/sdp`, {
      headers: streamingHeaders(gsToken),
    })
    const text = await res.text()
    return reply.status(res.status).send(text ? JSON.parse(text) : {})
  })

  server.post('/streaming/:sessionId/ice', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string }
    const { baseUri, gsToken, ...body } = request.body as {
      baseUri: string; gsToken: string; [k: string]: unknown
    }
    console.log('[SERVER] POST /ice body sent to Xbox:', JSON.stringify(body, null, 2))
    const res = await fetch(`${baseUri}/v5/sessions/home/${sessionId}/ice`, {
      method:  'POST',
      headers: streamingHeaders(gsToken),
      body:    JSON.stringify(body),
    })
    const text = await res.text()
    console.log('[SERVER] POST /ice Xbox response status:', res.status)
    console.log('[SERVER] POST /ice Xbox response body:', text || '(empty)')
    return reply.status(res.status).send(text ? JSON.parse(text) : {})
  })

  server.get('/streaming/:sessionId/ice', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string }
    const { baseUri, gsToken } = request.query as { baseUri: string; gsToken: string }
    const res = await fetch(`${baseUri}/v5/sessions/home/${sessionId}/ice`, {
      headers: streamingHeaders(gsToken),
    })
    console.log('[SERVER] GET /ice Xbox response status:', res.status)
    if (res.status === 204) {
      console.log('[SERVER] GET /ice Xbox returned 204 (No Content)')
      return reply.status(204).send()
    }
    const text = await res.text()
    console.log('[SERVER] GET /ice Xbox response body:', text)
    return reply.status(res.status).send(text ? JSON.parse(text) : {})
  })

  server.delete('/streaming/:sessionId', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string }
    const { baseUri, gsToken } = request.body as { baseUri: string; gsToken: string }
    const res = await fetch(`${baseUri}/v5/sessions/home/${sessionId}`, {
      method:  'DELETE',
      headers: streamingHeaders(gsToken),
    })
    return reply.status(res.status).send({})
  })
}
