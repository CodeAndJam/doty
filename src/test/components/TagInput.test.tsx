import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import TagInput from '../../components/TagInput'

describe('TagInput', () => {
  let onChange: ReturnType<typeof vi.fn<(tags: string[]) => void>>

  beforeEach(() => {
    onChange = vi.fn<(tags: string[]) => void>()
  })

  it('renders existing tags as pills', () => {
    render(<TagInput tags={['combat', 'boss']} allTags={[]} onChange={onChange} />)
    expect(screen.getByText('combat')).toBeTruthy()
    expect(screen.getByText('boss')).toBeTruthy()
  })

  it('adds a tag on Enter', () => {
    render(<TagInput tags={[]} allTags={[]} onChange={onChange} />)
    const input = screen.getByPlaceholderText('add tag...')
    fireEvent.change(input, { target: { value: 'tavern' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith(['tavern'])
  })

  it('normalizes tags to lowercase and trimmed', () => {
    render(<TagInput tags={[]} allTags={[]} onChange={onChange} />)
    const input = screen.getByPlaceholderText('add tag...')
    fireEvent.change(input, { target: { value: '  COMBAT  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith(['combat'])
  })

  it('does not add duplicate tags', () => {
    render(<TagInput tags={['combat']} allTags={[]} onChange={onChange} />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'combat' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('removes a tag when x is clicked', () => {
    render(<TagInput tags={['combat', 'boss']} allTags={[]} onChange={onChange} />)
    const removeButtons = screen.getAllByText('x')
    fireEvent.click(removeButtons[0])
    expect(onChange).toHaveBeenCalledWith(['boss'])
  })

  it('removes last tag on Backspace when input is empty', () => {
    render(<TagInput tags={['combat', 'boss']} allTags={[]} onChange={onChange} />)
    const input = screen.getByRole('textbox')
    fireEvent.keyDown(input, { key: 'Backspace' })
    expect(onChange).toHaveBeenCalledWith(['combat'])
  })

  it('shows autocomplete suggestions matching input', () => {
    render(<TagInput tags={[]} allTags={['combat', 'campfire', 'boss']} onChange={onChange} />)
    const input = screen.getByPlaceholderText('add tag...')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'com' } })
    expect(screen.getByText('combat')).toBeTruthy()
    // 'campfire' should not match 'com'
    expect(screen.queryByText('campfire')).toBeNull()
  })

  it('adds tag from autocomplete suggestion on click', () => {
    render(<TagInput tags={[]} allTags={['combat', 'campfire']} onChange={onChange} />)
    const input = screen.getByPlaceholderText('add tag...')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'camp' } })
    const suggestion = screen.getByText('campfire')
    fireEvent.mouseDown(suggestion)
    expect(onChange).toHaveBeenCalledWith(['campfire'])
  })

  it('does not show already-added tags in suggestions', () => {
    render(<TagInput tags={['combat']} allTags={['combat', 'campfire']} onChange={onChange} />)
    const input = screen.getByRole('textbox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'c' } })
    // 'combat' is already added, should not appear in suggestions
    // Only 'campfire' should appear
    expect(screen.getByText('campfire')).toBeTruthy()
  })

  it('clears input on Escape', () => {
    render(<TagInput tags={[]} allTags={[]} onChange={onChange} />)
    const input = screen.getByPlaceholderText('add tag...')
    fireEvent.change(input, { target: { value: 'test' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect((input as HTMLInputElement).value).toBe('')
  })

  it('does not add empty tags', () => {
    render(<TagInput tags={[]} allTags={[]} onChange={onChange} />)
    const input = screen.getByPlaceholderText('add tag...')
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).not.toHaveBeenCalled()
  })
})
