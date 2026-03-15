import { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom'

interface TagInputProps {
  tags: string[]
  allTags: string[]
  onChange: (tags: string[]) => void
}

export default function TagInput({ tags, allTags, onChange }: TagInputProps) {
  const [input, setInput] = useState('')
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null)

  const trimmed = input.toLowerCase().trim()
  const suggestions = trimmed ? allTags.filter((t) => t.includes(trimmed) && !tags.includes(t)).slice(0, 6) : []

  // Update dropdown position when suggestions change or focus changes
  useEffect(() => {
    if (!focused || suggestions.length === 0 || !containerRef.current) {
      setDropdownPos(null)
      return
    }
    const rect = containerRef.current.getBoundingClientRect()
    setDropdownPos({ top: rect.bottom, left: rect.left, width: rect.width })
  }, [focused, suggestions.length])

  function addTag(tag: string) {
    const normalized = tag.toLowerCase().trim()
    if (normalized && !tags.includes(normalized)) {
      onChange([...tags, normalized])
    }
    setInput('')
  }

  function removeTag(tag: string) {
    onChange(tags.filter((t) => t !== tag))
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && trimmed) {
      e.preventDefault()
      addTag(trimmed)
    } else if (e.key === 'Backspace' && !input && tags.length > 0) {
      removeTag(tags[tags.length - 1])
    } else if (e.key === 'Escape') {
      setInput('')
      inputRef.current?.blur()
    }
  }

  // Close suggestions on outside click
  useEffect(() => {
    if (!focused) return
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setFocused(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [focused])

  return (
    <div ref={containerRef} className="relative">
      <div
        className="flex flex-wrap items-center gap-1 px-1.5 py-1 min-h-[28px]"
        style={{
          background: 'rgba(15,13,9,0.8)',
          border: '1px solid #2e2416',
        }}
        onClick={() => inputRef.current?.focus()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.focus()
        }}
        role="presentation"
      >
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-0.5 px-1.5 py-0"
            style={{
              background: 'rgba(200,146,42,0.15)',
              border: '1px solid rgba(200,146,42,0.3)',
              fontSize: '11px',
              fontFamily: 'monospace',
              color: '#c8922a',
              lineHeight: '18px',
            }}
          >
            {tag}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                removeTag(tag)
              }}
              className="ml-0.5 hover:opacity-100 opacity-60"
              style={{ fontSize: '13px', color: '#c8922a', lineHeight: 1 }}
            >
              x
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          placeholder={tags.length === 0 ? 'add tag...' : ''}
          className="flex-1 min-w-[60px] bg-transparent outline-none"
          style={{
            fontSize: '11px',
            fontFamily: 'monospace',
            color: '#8a7050',
          }}
        />
      </div>

      {/* Autocomplete dropdown — rendered via portal to escape overflow clipping */}
      {focused &&
        suggestions.length > 0 &&
        dropdownPos &&
        ReactDOM.createPortal(
          <div
            className="fixed"
            style={{
              top: dropdownPos.top,
              left: dropdownPos.left,
              width: dropdownPos.width,
              zIndex: 9999,
              background: '#0f0d09',
              border: '1px solid #2e2416',
              borderTop: 'none',
              maxHeight: '120px',
              overflowY: 'auto',
              boxShadow: '0 4px 12px rgba(0,0,0,0.6)',
            }}
          >
            {suggestions.map((s) => (
              <button
                type="button"
                key={s}
                className="block w-full text-left px-2 py-1 hover:bg-[rgba(200,146,42,0.1)]"
                style={{
                  fontSize: '11px',
                  fontFamily: 'monospace',
                  color: '#8a7050',
                }}
                onMouseDown={(e) => {
                  e.preventDefault()
                  addTag(s)
                }}
              >
                {s}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  )
}
