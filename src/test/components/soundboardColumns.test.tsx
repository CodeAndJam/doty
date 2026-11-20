import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Soundboard from '../../components/Soundboard'

const handlers: { scan?: () => void } = {}

function stubDoty() {
  handlers.scan = undefined
  Object.defineProperty(window, 'doty', {
    configurable: true,
    value: {
      getAllMetadata: vi.fn().mockResolvedValue({}),
      getTagsMap: vi.fn().mockResolvedValue({}),
      getAllTags: vi.fn().mockResolvedValue([]),
      getSfxList: vi.fn().mockResolvedValue([]),
      onSfxChanged: vi.fn(() => () => {}),
      onScanProgress: vi.fn(() => () => {}),
      onScanComplete: vi.fn((cb: () => void) => {
        handlers.scan = cb
        return () => {}
      }),
      getAutopilotConfig: vi.fn().mockResolvedValue({ enabled: false, musicEnabled: false, sfxEnabled: false }),
      setAutopilotConfig: vi.fn(),
      recordPlay: vi.fn().mockResolvedValue(undefined),
      sessionReport: vi.fn().mockResolvedValue({
        autoActions: 0,
        manualPicks: 0,
        overrideRate: 0,
        autoChangeRetention: null,
        timeToFirstManualPickMs: null,
      }),
    },
  })
}

function renderBoard() {
  return render(
    <Soundboard
      recommendations={['battle-theme.mp3']}
      sfxRecommendations={[]}
      sfxAutopilot={[]}
      lastConfidence={0}
      probabilities={{}}
      candidates={['battle-theme.mp3']}
      sessionText=""
      lastRanker={null}
      rankerStatus="ready"
      indexStatus={null}
      lastTranscriptSnippet=""
      musicFolder="/music"
      settingsOpen={false}
      sessionStartTime={null}
      rankerDownloading={false}
      autopilotEnabled={false}
      onNoFolder={() => {}}
    />,
  )
}

describe('Soundboard columns', () => {
  beforeEach(() => {
    stubDoty()
    localStorage.clear()
  })

  it('collapses the music column to a rail and expands it again', () => {
    renderBoard()
    expect(screen.getByText('battle-theme')).toBeTruthy()

    fireEvent.click(screen.getByText('Music'))
    expect(screen.queryByText('battle-theme')).toBeNull()

    fireEvent.click(screen.getByTitle('Expand Music column'))
    expect(screen.getByText('battle-theme')).toBeTruthy()
  })

  it('leaves the other column open when one collapses', () => {
    renderBoard()
    fireEvent.click(screen.getByText('SFX'))

    expect(screen.getByTitle('Expand SFX column')).toBeTruthy()
    expect(screen.getByText('battle-theme')).toBeTruthy()
  })

  it('re-reads the effects shelf when a scan settles', async () => {
    // Lanes are re-resolved by the scan and the audio pass, so a suggestion from
    // the new shelf has nothing to render against until the list is fetched again.
    renderBoard()
    await waitFor(() => expect(window.doty.getSfxList).toHaveBeenCalledTimes(1))
    handlers.scan?.()
    await waitFor(() => expect(window.doty.getSfxList).toHaveBeenCalledTimes(2))
  })
})
