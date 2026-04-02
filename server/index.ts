import Fastify from 'fastify'
import cors from '@fastify/cors'
import { authRoutes } from './routes/auth'
import { smartglassRoutes } from './routes/smartglass'
import { streamingRoutes } from './routes/streaming'

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

await server.register(authRoutes)
await server.register(smartglassRoutes)
await server.register(streamingRoutes)

await server.listen({ port: PORT })
