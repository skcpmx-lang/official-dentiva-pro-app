import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '../../src/renderer/src/App'
import { useAppStore } from '../../src/renderer/src/store/appStore'
import { callLog, mockChannels } from './setup'

/**
 * Recovery mode on the screen.
 *
 * A clinic whose database cannot be opened gets an explanation and the actions that actually still
 * work — open the folders, restart, retry — instead of a bare failure. The channels behind those
 * buttons are answered by the main process without a router, which is exactly why they are worth
 * pinning here: with a router they would never be exercised.
 */

describe('recovery screen', () => {
  it('explains the recovery state and opens the folders that do not need the database', async () => {
    useAppStore.setState({ ready: false, session: null, settings: {} })
    mockChannels({
      'app.bootstrap': () => {
        throw new Error('The clinic database could not be opened.')
      },
      'app.startupState': () => ({ mode: 'recovery', reason: 'The clinic database could not be opened. Your data has not been changed.' }),
      'app.openDataFolder': () => ({ ok: true as const }),
      'app.relaunch': () => ({ ok: true as const })
    })

    render(<App />)

    expect(await screen.findByText('Dentiva Pro is in recovery mode')).toBeInTheDocument()
    expect(screen.getByText(/Your data has not been changed./)).toBeInTheDocument()
    expect(screen.getByText(/nothing has been changed/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Open data folder' }))
    await waitFor(() => expect(callLog.at(-1)).toMatchObject({ channel: 'app.openDataFolder', payload: { kind: 'data' } }))

    await userEvent.click(screen.getByRole('button', { name: 'Open log folder' }))
    await waitFor(() => expect(callLog.at(-1)).toMatchObject({ channel: 'app.openDataFolder', payload: { kind: 'logs' } }))

    await userEvent.click(screen.getByRole('button', { name: 'Restart Dentiva Pro' }))
    await waitFor(() => expect(callLog.at(-1)).toMatchObject({ channel: 'app.relaunch' }))
  })

  it('keeps a plain failure message when the application has not reached recovery', async () => {
    useAppStore.setState({ ready: false, session: null, settings: {} })
    mockChannels({
      'app.bootstrap': () => {
        throw new Error('Dentiva Pro is still starting up.')
      },
      'app.startupState': () => ({ mode: 'starting', reason: null }),
      'app.openDataFolder': () => ({ ok: true as const })
    })

    render(<App />)

    expect(await screen.findByText('Dentiva Pro could not start')).toBeInTheDocument()
    expect(screen.getByText('Dentiva Pro is still starting up.')).toBeInTheDocument()
    /* The recovery wording and the data-folder pointer are reserved for an actual recovery. */
    expect(screen.queryByText('Dentiva Pro is in recovery mode')).toBeNull()
    expect(screen.queryByText(/nothing has been changed/)).toBeNull()
  })
})
