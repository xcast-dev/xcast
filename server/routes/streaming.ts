import type { FastifyInstance } from 'fastify'

const DEVICE_INFO = JSON.stringify({
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
      dimensions:   { widthInPixels: 1920, heightInPixels: 1080 },
      pixelDensity: { dpiX: 2, dpiY: 2 },
    },
  },
})

function streamingHeaders(gsToken: string) {
  return {
    'Accept':           'application/json',
    'Content-Type':     'application/json',
    'X-Gssv-Client':    'XboxComBrowser',
    'X-MS-Device-Info': DEVICE_INFO,
    'Authorization':    `Bearer ${gsToken}`,
  }
}

export async function streamingRoutes(server: FastifyInstance) {
  server.post('/streaming/play', async (request, reply) => {
    const { baseUri, gsToken, serverId } = request.body as {
      baseUri: string; gsToken: string; serverId: string
    }
    const res = await fetch(`${baseUri}/v5/sessions/home/play`, {
      method:  'POST',
      headers: streamingHeaders(gsToken),
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
    return reply.status(res.status).send(await res.json())
  })

  server.post('/streaming/:sessionId/state', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string }
    const { baseUri, gsToken } = request.body as { baseUri: string; gsToken: string }
    const res = await fetch(`${baseUri}/v5/sessions/home/${sessionId}/state`, {
      headers: streamingHeaders(gsToken),
    })
    return reply.status(res.status).send(await res.json())
  })

  server.post('/streaming/:sessionId/connect', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string }
    const { baseUri, gsToken, userToken } = request.body as {
      baseUri: string; gsToken: string; userToken: string
    }
    const res = await fetch(`${baseUri}/v5/sessions/home/${sessionId}/connect`, {
      method:  'POST',
      headers: streamingHeaders(gsToken),
      body:    JSON.stringify({ userToken }),
    })
    return reply.status(res.status).send(await res.json())
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
