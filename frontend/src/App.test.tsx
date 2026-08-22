import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import App from './App'

function mockFetchOk(body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => Promise.resolve(body),
      } as Response),
    ),
  )
}

function mockFetchReject() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Promise.reject(new Error('ECONNREFUSED'))),
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('App shell', () => {
  it('renders the wordmark and subtitle', () => {
    mockFetchOk({ status: 'ok', service: 'dhruva', version: '0.1.0' })
    render(<App />)

    expect(
      screen.getByRole('heading', { level: 1, name: 'Dhruva' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('agent supervisor — flight recorder'),
    ).toBeInTheDocument()
  })

  it('shows "connected" with the reported version after a healthy response', async () => {
    mockFetchOk({ status: 'ok', service: 'dhruva-backend', version: '0.1.0' })
    render(<App />)

    expect(await screen.findByText('connected')).toBeInTheDocument()
    expect(screen.getByText('v0.1.0')).toBeInTheDocument()
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/health',
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    )
  })

  it('shows "disconnected" when the health request fails', async () => {
    mockFetchReject()
    render(<App />)

    expect(await screen.findByText('disconnected')).toBeInTheDocument()
    expect(screen.getByText(/retrying every 3s/)).toBeInTheDocument()
  })
})
