import { useRef, useCallback } from 'react'

export function useRecorder() {
  const contextRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const workletRef = useRef<AudioWorkletNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const activeRef = useRef(false)

  const start = useCallback(async () => {
    if (activeRef.current) return
    activeRef.current = true

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true },
    })
    streamRef.current = stream

    const ctx = new AudioContext({ sampleRate: 16000 })
    contextRef.current = ctx

    // Load worklet from public URL (Vite copies it to /assets)
    await ctx.audioWorklet.addModule('./pcm-capture.worklet.js')

    const source = ctx.createMediaStreamSource(stream)
    sourceRef.current = source

    const worklet = new AudioWorkletNode(ctx, 'pcm-capture')
    workletRef.current = worklet

    worklet.port.onmessage = async (e) => {
      if (!activeRef.current) return
      if (e.data?.type === 'segment') {
        // Send to main process for transcription
        await window.doty.sttTranscribeChunk(e.data.buffer)
      }
    }

    source.connect(worklet)
    worklet.connect(ctx.destination)
  }, [])

  const stop = useCallback(() => {
    activeRef.current = false
    workletRef.current?.disconnect()
    sourceRef.current?.disconnect()
    contextRef.current?.close()
    streamRef.current?.getTracks().forEach((t) => t.stop())
    workletRef.current = null
    sourceRef.current = null
    contextRef.current = null
    streamRef.current = null
  }, [])

  return { start, stop }
}
