// Auth calls go through a local Fastify server (server/index.ts) to avoid browser CORS restrictions.
const SERVER = 'http://localhost:1209'

export interface AuthSession {
  gsToken:   string
  baseUri:   string
  webToken:  { uhs: string; token: string }
}

interface XstsResponse {
  Token: string
  DisplayClaims: { xui: [{ uhs: string }] }
}

interface XHomeResponse {
  gsToken:          string
  offeringSettings: {
    regions: Array<{ baseUri: string; isDefault: boolean }>
  }
}

// Step 1: exchange OAuth access_token for an XBL User Token
async function getXblUserToken(accessToken: string): Promise<string> {
  const res = await fetch(`${SERVER}/auth/xbl`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      Properties: {
        AuthMethod: 'RPS',
        SiteName:   'user.auth.xboxlive.com',
        RpsTicket:  `d=${accessToken}`,
      },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType:    'JWT',
    }),
  })
  const data = await res.json() as Record<string, unknown>
  if (!res.ok) throw new Error(`XBL user auth failed ${res.status}: ${JSON.stringify(data)}`)
  return (data as unknown as XstsResponse).Token
}

async function getXstsToken(xblToken: string, relyingParty: string): Promise<XstsResponse> {
  const res = await fetch(`${SERVER}/auth/xsts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      Properties:   { SandboxId: 'RETAIL', UserTokens: [xblToken] },
      RelyingParty: relyingParty,
      TokenType:    'JWT',
    }),
  })
  const data = await res.json() as Record<string, unknown>
  if (!res.ok) throw new Error(`XSTS failed (${relyingParty}) ${res.status}: ${JSON.stringify(data)}`)
  return data as unknown as XstsResponse
}

async function getXHomeToken(xstsToken: string): Promise<XHomeResponse> {
  const res = await fetch(`${SERVER}/auth/xhome`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ offeringId: 'xhome', token: xstsToken }),
  })
  const data = await res.json() as Record<string, unknown>
  if (!res.ok) throw new Error(`xHome failed ${res.status}: ${JSON.stringify(data)}`)
  console.log('[xhome response]', JSON.stringify(data, null, 2))
  return data as unknown as XHomeResponse
}

// Builds the full auth session from an OAuth access_token.
// The two XSTS calls run in parallel; xHome is chained on the GSSV result.
export async function buildAuthSession(accessToken: string): Promise<AuthSession> {
  const xblToken = await getXblUserToken(accessToken)

  const [xhome, webXsts] = await Promise.all([
    getXstsToken(xblToken, 'http://gssv.xboxlive.com/').then(xsts => getXHomeToken(xsts.Token)),
    getXstsToken(xblToken, 'http://xboxlive.com'),
  ])

  const regions = xhome.offeringSettings.regions
  const baseUri = regions.find(r => r.isDefault)?.baseUri ?? regions[0].baseUri

  return {
    gsToken:  xhome.gsToken,
    baseUri,
    webToken: {
      uhs:   webXsts.DisplayClaims.xui[0].uhs,
      token: webXsts.Token,
    },
  }
}
