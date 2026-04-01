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

await server.listen({ port: PORT })
