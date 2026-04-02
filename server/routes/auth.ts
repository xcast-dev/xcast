import type { FastifyInstance } from 'fastify'

export async function authRoutes(server: FastifyInstance) {
  server.post('/auth/devicecode', async (request, reply) => {
    const res = await fetch(
      'https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode',
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    request.body as string,
      }
    )
    return reply.status(res.status).send(await res.json())
  })

  server.post('/auth/token', async (request, reply) => {
    const res = await fetch(
      'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    request.body as string,
      }
    )
    return reply.status(res.status).send(await res.json())
  })

  server.post('/auth/xbl', async (request, reply) => {
    const res = await fetch('https://user.auth.xboxlive.com/user/authenticate', {
      method:  'POST',
      headers: {
        'Content-Type':           'application/json',
        'x-xbl-contract-version': '1',
      },
      body: JSON.stringify(request.body),
    })
    return reply.status(res.status).send(await res.json())
  })

  server.post('/auth/xsts', async (request, reply) => {
    const res = await fetch('https://xsts.auth.xboxlive.com/xsts/authorize', {
      method:  'POST',
      headers: {
        'Content-Type':           'application/json',
        'x-xbl-contract-version': '1',
      },
      body: JSON.stringify(request.body),
    })
    return reply.status(res.status).send(await res.json())
  })

  server.post('/auth/xhome', async (request, reply) => {
    const res = await fetch('https://xhome.gssv-play-prod.xboxlive.com/v2/login/user', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'x-gssv-client': 'XboxComBrowser',
      },
      body: JSON.stringify(request.body),
    })
    return reply.status(res.status).send(await res.json())
  })

  server.post('/auth/purpose', async (request, reply) => {
    const { refreshToken } = request.body as { refreshToken: string }
    const res = await fetch('https://login.live.com/oauth20_token.srf', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     '1f907974-e22b-4810-a9de-d9647380c97e',
        grant_type:    'refresh_token',
        refresh_token: refreshToken,
        scope:         'service::http://Passport.NET/purpose::PURPOSE_XBOX_CLOUD_CONSOLE_TRANSFER_TOKEN',
      }).toString(),
    })
    return reply.status(res.status).send(await res.json())
  })
}
