const SERVER = 'http://localhost:1209'

export interface XboxConsole {
  id:                       string
  name:                     string
  consoleType:              string
  powerState:               string
  consoleStreamingEnabled:  boolean
  remoteManagementEnabled:  boolean
}

export async function getConsoles(
  webToken: { uhs: string; token: string }
): Promise<XboxConsole[]> {
  const res = await fetch(`${SERVER}/smartglass/devices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(webToken),
  })
  if (!res.ok) throw new Error(`SmartGlass failed: ${res.status}`)
  const data = await res.json() as Record<string, unknown>
  if (Array.isArray(data)) return data as XboxConsole[]
  if (Array.isArray((data as Record<string, unknown>).result))
    return (data as { result: XboxConsole[] }).result
  return []
}
