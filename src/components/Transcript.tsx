import { useEffect, useRef } from 'react'

interface Props {
  lines: string[]
  recording: boolean
}

export default function Transcript({ lines, recording }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines])

  return (
    <div className="flex-1 bg-panel border border-border rounded-xl p-4 overflow-hidden flex flex-col">
      <div className="flex items-center gap-2 mb-3 shrink-0">
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Transcript</span>
        {recording && (
          <span className="flex items-center gap-1 text-xs text-red-400">
            <span className="w-1.5 h-1.5 bg-red-400 rounded-full animate-pulse" />
            Live
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto space-y-2 pr-1">
        {lines.length === 0 ? (
          <p className="text-xs text-gray-600 italic">
            {recording ? 'Listening...' : 'Press Start Recording to begin.'}
          </p>
        ) : (
          lines.map((line, i) => (
            <p key={i} className="text-sm text-gray-300 leading-relaxed">
              {line}
            </p>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
