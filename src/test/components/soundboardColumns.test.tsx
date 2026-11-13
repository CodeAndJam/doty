import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Soundboard from '../../components/Soundboard'

function stubDoty() {
  Object.defineProperty(window, 'doty', {
    configurable: true,
    value: {
      getAllMetadata: vi.fn().mockResolvedValue({}),
      getTagsMap: vi.fn().mockResolvedValue({}),
      getAllTags: vi.fn().mockResolvedValue([]),
      getSfxList: vi.fn().mockResolvedValue([]),
      onSfxChanged: vi.fn(() => () => {}),
      onScanComplete: vi.fn(() => () => {}),
      getAutopilotConfig: vi.fn().mockResolvedValue({ enabled: false, musicEnabled: false, sfxEnabled: false }),
      setAutopilotConfig: vi.fn(),
      recordPlay: vi.fn().mockResolvedValue(undefined),
    },
  })
}

function renderBoard() {
  return render(
    <Soundboard
      recommendations={['battle-theme.mp3']}
      override={false}
      onManualAction={() => {}}
      onResumeAuto={() => {}}
      sfxRecommendations={[]}
      lastConfidence={0}
      lastRanker={null}
      rankerStatus="ready"
      lastTranscriptSnippet=""
      musicFolder="/music"
      settingsOpen={false}
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
})
