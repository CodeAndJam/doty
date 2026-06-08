import { useCallback, useRef, useState } from 'react'
import type { MicPermission } from '../types'

export type { MicPermission }

async function ensureMicPermission(): Promise<MicPermission> {
  const status: MicPermission = await window.doty.micCheckPermission()
  if (status === 'not-determined') {
    const granted = await window.doty.micRequestPermission()
    return granted ? 'granted' : 'denied'
  }
  return status
}

export function useRecorder(deviceId?: string) {
  const contextRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const workletRef = useRef<AudioWorkletNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const activeRef = useRef(false)
  const [micPermission, setMicPermission] = useState<MicPermission>('unknown')

  const start = useCallback(async () => {
    if (activeRef.current) return

    const permission = await ensureMicPermission()
    setMicPermission(permission)
    if (permission !== 'granted') return

    activeRef.current = true

    const audioConstraints: MediaTrackConstraints = {
      sampleRate: 16000,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    }
    if (deviceId) audioConstraints.deviceId = { exact: deviceId }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints })
    streamRef.current = stream

    const ctx = new AudioContext({ sampleRate: 16000 })
    contextRef.current = ctx

    // Disable audio output — we only capture PCM, never play back
    // setSinkId({ type: 'none' }) is available in Chromium 110+ / Electron 31+
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (typeof (ctx as any).setSinkId === 'function') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (ctx as any).setSinkId({ type: 'none' })
    }

    await ctx.audioWorklet.addModule('./pcm-capture.worklet.js')

    const source = ctx.createMediaStreamSource(stream)
    sourceRef.current = source

    const worklet = new AudioWorkletNode(ctx, 'pcm-capture')
    workletRef.current = worklet

    worklet.port.onmessage = async (e) => {
      if (!activeRef.current) return
      if (e.data?.type === 'segment') {
        await window.doty.sttTranscribeChunk(e.data.buffer)
      }
    }

    source.connect(worklet)
    // Do NOT connect worklet to destination — we only want to capture, not play back
  }, [deviceId])

  const stop = useCallback(() => {
    activeRef.current = false
    workletRef.current?.disconnect()
    sourceRef.current?.disconnect()
    contextRef.current?.close()
    streamRef.current?.getTracks().forEach((t) => {
      t.stop()
    })
    workletRef.current = null
    sourceRef.current = null
    contextRef.current = null
    streamRef.current = null
  }, [])

  return { start, stop, micPermission }
}
