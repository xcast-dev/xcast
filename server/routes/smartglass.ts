import type { FastifyInstance } from 'fastify'

export async function smartglassRoutes(server: FastifyInstance) {
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
    return reply.status(res.status).send(await res.json())
  })
}
