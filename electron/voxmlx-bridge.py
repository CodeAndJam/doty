#!/usr/bin/env python3
"""
voxmlx-bridge.py — MLX Voxtral bridge for Doty.

Reads raw 16-bit PCM (16kHz mono) from stdin, transcribes using MLX on Apple Silicon GPU,
and writes JSON lines to stdout: {"type":"text","text":"..."} or {"type":"interim","text":"..."}

Usage: python3 voxmlx-bridge.py [--model MODEL_PATH]
"""
import sys
import json
import threading
import time
import numpy as np

def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="mlx-community/Voxtral-Mini-4B-Realtime-6bit")
    parser.add_argument("--temp", type=float, default=0.0)
    args = parser.parse_args()

    import mlx.core as mx
    from voxmlx import load_model, _build_prompt_tokens
    from voxmlx.audio import SAMPLES_PER_TOKEN, log_mel_spectrogram_step
    from voxmlx.cache import RotatingKVCache
    from mistral_common.tokens.tokenizers.base import SpecialTokenPolicy

    emit("status", "loading")
    model, sp, config = load_model(args.model)
    prompt_tokens, n_delay_tokens = _build_prompt_tokens(sp)
    prefix_len = len(prompt_tokens)
    eos_token_id = sp.eos_id
    t_cond = model.time_embedding(mx.array([n_delay_tokens], dtype=mx.float32))
    mx.eval(t_cond)
    prompt_ids = mx.array([prompt_tokens])
    text_embeds = model.language_model.embed(prompt_ids)[0]
    mx.eval(text_embeds)
    n_layers = len(model.language_model.layers)
    sliding_window = 8192
    emit("status", "ready")

    N_LEFT_PAD_TOKENS = 32
    N_RIGHT_PAD_TOKENS = 17

    def sample(logits):
        if args.temp <= 0:
            return mx.argmax(logits[0, -1:], axis=-1).squeeze()
        return mx.random.categorical(logits[0, -1:] / args.temp).squeeze()

    # State
    cache = None
    y = None
    audio_tail = None
    conv1_tail = None
    conv2_tail = None
    encoder_cache = None
    ds_buf = None
    pending_audio = np.zeros(0, dtype=np.float32)
    audio_embeds = None
    n_audio_samples_fed = 0
    n_total_decoded = 0
    first_cycle = True
    prefilled = False
    text_buffer = ""
    last_emit_time = time.monotonic()

    def reset_state():
        nonlocal cache, y, audio_tail, conv1_tail, conv2_tail, encoder_cache, ds_buf
        nonlocal pending_audio, audio_embeds, n_audio_samples_fed, n_total_decoded
        nonlocal first_cycle, prefilled, text_buffer
        cache = None
        y = None
        audio_tail = None
        conv1_tail = None
        conv2_tail = None
        encoder_cache = None
        ds_buf = None
        pending_audio = np.zeros(0, dtype=np.float32)
        audio_embeds = None
        n_audio_samples_fed = 0
        n_total_decoded = 0
        first_cycle = True
        prefilled = False
        text_buffer = ""

    def decode_steps(embeds, n_to_decode):
        nonlocal cache, y, text_buffer, last_emit_time
        for i in range(n_to_decode):
            token_embed = model.language_model.embed(y.reshape(1, 1))[0, 0]
            step_embed = (embeds[i] + token_embed)[None, None, :]
            logits = model.decode(step_embed, t_cond, mask=None, cache=cache)
            next_y = sample(logits)
            mx.async_eval(next_y)
            token_id = y.item()
            if token_id == eos_token_id:
                if text_buffer:
                    emit("text", text_buffer)
                    text_buffer = ""
                cache = None
                y = None
                return i, True
            text = sp.decode([token_id], special_token_policy=SpecialTokenPolicy.IGNORE)
            if text:
                text_buffer += text
                now = time.monotonic()
                # Emit interim every 200ms for responsive UI
                if now - last_emit_time > 0.2:
                    emit("interim", text_buffer)
                    last_emit_time = now
                # Flush on sentence boundary
                if len(text_buffer) > 30 and text_buffer.rstrip()[-1:] in ".!?":
                    emit("text", text_buffer)
                    text_buffer = ""
                    last_emit_time = now
            if i > 0 and i % 256 == 0:
                mx.clear_cache()
            y = next_y
        return n_to_decode, False

    # Read PCM from stdin in a thread
    audio_lock = threading.Lock()
    audio_inbox = np.zeros(0, dtype=np.float32)
    stdin_done = False

    def reader():
        nonlocal audio_inbox, stdin_done
        while True:
            data = sys.stdin.buffer.read(3200)  # 100ms of 16-bit mono 16kHz
            if not data:
                stdin_done = True
                break
            samples = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0
            with audio_lock:
                audio_inbox = np.append(audio_inbox, samples)

    t = threading.Thread(target=reader, daemon=True)
    t.start()

    # Main loop
    try:
        while not stdin_done or len(pending_audio) >= SAMPLES_PER_TOKEN:
            # Drain audio from reader
            with audio_lock:
                if len(audio_inbox) > 0:
                    pending_audio = np.append(pending_audio, audio_inbox)
                    audio_inbox = np.zeros(0, dtype=np.float32)

            if first_cycle and len(pending_audio) < SAMPLES_PER_TOKEN:
                time.sleep(0.02)
                continue

            # Encode
            if first_cycle and len(pending_audio) >= SAMPLES_PER_TOKEN:
                left_pad = np.zeros(N_LEFT_PAD_TOKENS * SAMPLES_PER_TOKEN, dtype=np.float32)
                n_feed = (len(pending_audio) // SAMPLES_PER_TOKEN) * SAMPLES_PER_TOKEN
                chunk = np.concatenate([left_pad, pending_audio[:n_feed]])
                pending_audio = pending_audio[n_feed:]
                n_audio_samples_fed += n_feed
                mel, audio_tail = log_mel_spectrogram_step(chunk, audio_tail)
                new_embeds, conv1_tail, conv2_tail, encoder_cache, ds_buf = (
                    model.encode_step(mel, conv1_tail, conv2_tail, encoder_cache, ds_buf)
                )
                if new_embeds is not None:
                    mx.eval(new_embeds)
                    audio_embeds = new_embeds
                first_cycle = False
            elif not first_cycle and len(pending_audio) >= SAMPLES_PER_TOKEN:
                n_feed = (len(pending_audio) // SAMPLES_PER_TOKEN) * SAMPLES_PER_TOKEN
                chunk = pending_audio[:n_feed]
                pending_audio = pending_audio[n_feed:]
                n_audio_samples_fed += n_feed
                mel, audio_tail = log_mel_spectrogram_step(chunk, audio_tail)
                new_embeds, conv1_tail, conv2_tail, encoder_cache, ds_buf = (
                    model.encode_step(mel, conv1_tail, conv2_tail, encoder_cache, ds_buf)
                )
                if new_embeds is not None:
                    mx.eval(new_embeds)
                    if audio_embeds is not None:
                        audio_embeds = mx.concatenate([audio_embeds, new_embeds])
                    else:
                        audio_embeds = new_embeds

            if audio_embeds is None:
                time.sleep(0.02)
                continue

            # Decode
            safe_total = N_LEFT_PAD_TOKENS + n_audio_samples_fed // SAMPLES_PER_TOKEN
            n_decodable = min(audio_embeds.shape[0], safe_total - n_total_decoded)
            if n_decodable <= 0:
                time.sleep(0.02)
                continue

            if not prefilled:
                if n_total_decoded + audio_embeds.shape[0] < prefix_len:
                    time.sleep(0.02)
                    continue
                cache = [RotatingKVCache(sliding_window) for _ in range(n_layers)]
                prefix_embeds = text_embeds + audio_embeds[:prefix_len]
                prefix_embeds = prefix_embeds[None, :, :]
                logits = model.decode(prefix_embeds, t_cond, "causal", cache)
                mx.eval(logits, *[x for c in cache for x in (c.keys, c.values)])
                y = sample(logits)
                mx.async_eval(y)
                audio_embeds = audio_embeds[prefix_len:]
                n_total_decoded = prefix_len
                prefilled = True
                n_decodable = min(audio_embeds.shape[0], safe_total - n_total_decoded)
                if n_decodable <= 0:
                    time.sleep(0.02)
                    continue

            n_consumed, hit_eos = decode_steps(audio_embeds, n_decodable)
            n_total_decoded += n_consumed
            if audio_embeds.shape[0] > n_consumed:
                audio_embeds = audio_embeds[n_consumed:]
            else:
                audio_embeds = None
            if hit_eos:
                reset_state()

            time.sleep(0.02)

    except (KeyboardInterrupt, BrokenPipeError):
        pass

    # Final flush
    if text_buffer:
        emit("text", text_buffer)


def emit(msg_type: str, text: str):
    line = json.dumps({"type": msg_type, "text": text})
    sys.stdout.write(line + "\n")
    sys.stdout.flush()


if __name__ == "__main__":
    main()
