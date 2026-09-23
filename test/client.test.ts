import { describe, expect, it, vi } from 'vitest'

import { createLucentClient } from '../src/client'

const WALLET = '2qNjaYNaecnXLD5tTZy8yu26RN5mEJwmfjHLtKqtoJs4'

const profileResponse = () =>
  new Response(
    JSON.stringify({
      wallet: WALLET,
      positions: [],
      activity: [],
      lastActivityAt: null,
      historyExact: true,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )

describe('history API configuration', () => {
  it('uses lmns.fi for stake history by default', async () => {
    const fetch = vi.fn(async () => profileResponse())
    const client = createLucentClient({ fetch })

    await client.getHistory(WALLET)

    expect(fetch).toHaveBeenCalledWith(`https://lmns.fi/api/profile?wallet=${WALLET}`, {
      headers: { accept: 'application/json' },
    })
  })

  it('preserves an explicit API URL override', async () => {
    const fetch = vi.fn(async () => profileResponse())
    const client = createLucentClient({ apiUrl: 'https://example.com/', fetch })

    await client.getHistory(WALLET)

    expect(fetch).toHaveBeenCalledWith(`https://example.com/api/profile?wallet=${WALLET}`, {
      headers: { accept: 'application/json' },
    })
  })
})
