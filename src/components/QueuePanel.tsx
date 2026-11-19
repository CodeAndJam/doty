import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useCallback, useEffect, useRef } from 'react'
import { CloseIcon, DragHandleIcon, PauseIcon, PlayIcon } from './Icons'
import { trackName } from './PlayerBar'

interface QueuePanelProps {
  tracks: string[]
  currentIndex: number
  playing: string | null
  isPlaying: boolean
  onPlay: (index: number) => void
  onRemove: (index: number) => void
  onReorder: (fromIndex: number, toIndex: number) => void
  onClear: () => void
  onClose: () => void
}

/** A single sortable row in the queue. */
function SortableQueueItem({
  id,
  index,
  filename,
  isCurrent,
  isPlaying,
  onPlay,
  onRemove,
}: {
  id: string
  index: number
  filename: string
  isCurrent: boolean
  isPlaying: boolean
  onPlay: () => void
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    background: isCurrent ? 'linear-gradient(135deg, rgba(200,146,42,0.12), rgba(107,78,21,0.06))' : 'transparent',
    borderBottom: '1px solid rgba(46,36,22,0.3)',
  }

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2 px-3 py-1.5 group">
      {/* Drag handle */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="w-5 h-5 flex items-center justify-center shrink-0 cursor-grab opacity-30 group-hover:opacity-70 transition-opacity"
        style={{ color: '#a5813f', touchAction: 'none' }}
        title="Drag to reorder"
      >
        <DragHandleIcon />
      </button>

      {/* Index */}
      <span
        className="w-5 text-center shrink-0"
        style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: '11px',
          color: isCurrent ? '#d9a441' : '#9d8b66',
        }}
      >
        {index + 1}
      </span>

      {/* Play/pause button */}
      <button
        type="button"
        onClick={onPlay}
        className="w-6 h-6 flex items-center justify-center shrink-0"
        style={{ color: isCurrent ? '#d9a441' : '#a5813f' }}
      >
        {isCurrent && isPlaying ? <PauseIcon /> : <PlayIcon />}
      </button>

      {/* Track name */}
      <span
        className="flex-1 min-w-0 truncate cursor-pointer"
        onDoubleClick={onPlay}
        style={{
          fontFamily: "'Crimson Text', serif",
          fontSize: '13px',
          color: isCurrent ? '#f2e6c9' : '#b9a683',
        }}
      >
        {trackName(filename)}
      </span>

      {/* Remove */}
      <button
        type="button"
        onClick={() => {
          onRemove()
          // The row this button lived in is gone; keep focus inside the panel.
          requestAnimationFrame(() =>
            (document.querySelector('[aria-label="Playback queue"]') as HTMLElement | null)?.focus(),
          )
        }}
        aria-label={`Remove ${filename} from the queue`}
        className="w-5 h-5 flex items-center justify-center shrink-0 opacity-0 group-hover:opacity-60 focus-visible:opacity-100 hover:!opacity-100 transition-opacity"
        title="Remove from queue"
        style={{ color: '#a5813f' }}
      >
        <CloseIcon />
      </button>
    </div>
  )
}

export default function QueuePanel({
  tracks,
  currentIndex,
  playing,
  isPlaying,
  onPlay,
  onRemove,
  onReorder,
  onClear,
  onClose,
}: QueuePanelProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    // Keyboard reorder: focus a handle, Space, arrows, Space.
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const rootRef = useRef<HTMLDivElement>(null)

  // The panel covers the shelf; focus it, and give focus back when it closes.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    rootRef.current?.focus()
    return () => previous?.focus?.()
  }, [])

  // dnd-kit uses string IDs — we use "index:filename" to ensure uniqueness
  // even if the same file appears multiple times in the queue
  const itemIds = tracks.map((f, i) => `${i}:${f}`)

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return
      const fromIndex = itemIds.indexOf(active.id as string)
      const toIndex = itemIds.indexOf(over.id as string)
      if (fromIndex >= 0 && toIndex >= 0) {
        onReorder(fromIndex, toIndex)
      }
    },
    [itemIds, onReorder],
  )

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="Playback queue"
      tabIndex={-1}
      className="absolute inset-0 z-30 flex flex-col outline-none"
      style={{
        background: 'rgba(8,7,5,0.97)',
        backdropFilter: 'blur(8px)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 shrink-0"
        style={{
          borderBottom: '1px solid rgba(200,146,42,0.2)',
        }}
      >
        <span
          style={{
            fontFamily: "'Cinzel', serif",
            fontSize: '13px',
            letterSpacing: '0.2em',
            color: '#a5813f',
            textTransform: 'uppercase',
          }}
        >
          Queue
          {tracks.length > 0 && (
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: '11px',
                marginLeft: '8px',
                color: '#9d8b66',
              }}
            >
              ({tracks.length} track{tracks.length !== 1 ? 's' : ''})
            </span>
          )}
        </span>
        <div className="flex items-center gap-2">
          {tracks.length > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="px-2 py-0.5 hover:opacity-80 transition-opacity"
              style={{
                fontSize: '11px',
                fontFamily: "'IBM Plex Mono', monospace",
                color: '#a5813f',
                border: '1px solid rgba(200,146,42,0.2)',
              }}
            >
              Clear
            </button>
          )}
          <button type="button" onClick={onClose} className="p-1 hover:opacity-80 transition-opacity">
            <CloseIcon />
          </button>
        </div>
      </div>

      {/* Queue list */}
      {tracks.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <span
            style={{
              fontFamily: "'Cinzel', serif",
              fontSize: '13px',
              color: '#9d8b66',
              letterSpacing: '0.1em',
            }}
          >
            Queue is empty
          </span>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
              {tracks.map((filename, index) => (
                <SortableQueueItem
                  key={itemIds[index]}
                  id={itemIds[index]}
                  index={index}
                  filename={filename}
                  isCurrent={index === currentIndex}
                  isPlaying={index === currentIndex && playing === filename && isPlaying}
                  onPlay={() => onPlay(index)}
                  onRemove={() => onRemove(index)}
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>
      )}
    </div>
  )
}
