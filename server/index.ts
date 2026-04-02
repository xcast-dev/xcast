import Fastify from 'fastify'
import cors from '@fastify/cors'

const PORT = 1209

const server = Fastify({ logger: true })

await server.register(cors, {
  origin: 'http://localhost:5173',
})

server.addContentTypeParser(
  'application/x-www-form-urlencoded',
  { parseAs: 'string' },
  (_req, body, done) => done(null, body)
)

server.post('/auth/devicecode', async (request, reply) => {
  const res = await fetch(
    'https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: request.body as string,
    }
  )
  const data = await res.json()
  return reply.status(res.status).send(data)
})

server.post('/auth/token', async (request, reply) => {
  const res = await fetch(
    'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: request.body as string,
    }
  )
  const data = await res.json()
  return reply.status(res.status).send(data)
})

server.post('/auth/xbl', async (request, reply) => {
  const res = await fetch(
    'https://user.auth.xboxlive.com/user/authenticate',
    {
      method: 'POST',
      headers: {
        'Content-Type':           'application/json',
        'x-xbl-contract-version': '1',
      },
      body: JSON.stringify(request.body),
    }
  )
  const data = await res.json()
  return reply.status(res.status).send(data)
})

server.post('/auth/xsts', async (request, reply) => {
  const res = await fetch(
    'https://xsts.auth.xboxlive.com/xsts/authorize',
    {
      method: 'POST',
      headers: {
        'Content-Type':           'application/json',
        'x-xbl-contract-version': '1',
      },
      body: JSON.stringify(request.body),
    }
  )
  const data = await res.json()
  return reply.status(res.status).send(data)
})

server.post('/auth/xhome', async (request, reply) => {
  const res = await fetch(
    'https://xhome.gssv-play-prod.xboxlive.com/v2/login/user',
    {
      method: 'POST',
      headers: {
        'Content-Type':    'application/json',
        'x-gssv-client':   'XboxComBrowser',
      },
      body: JSON.stringify(request.body),
    }
  )
  const data = await res.json()
  return reply.status(res.status).send(data)
})

server.post('/smartglass/devices', async (request, reply) => {
  const { uhs, token } = request.body as { uhs: string; token: string }
  const res = await fetch(
    'https://xccs.xboxlive.com/lists/devices?queryCurrentDevice=false&includeStorageDevices=true',
    {
      headers: {
        'Authorization':          `XBL3.0 x=${uhs};${token}`,
        'Accept':                 'application/json',
        'x-xbl-contract-version': '4',
        'skillplatform':          'RemotePlay',
      },
    }
  )
  const data = await res.json()
  return reply.status(res.status).send(data)
})

await server.listen({ port: PORT })
