/**
 * PROTOTYPE — throw away once the question is answered.
 *
 * Question it settles: can Doty capture every Discord participant as a separate
 * speaker, give each its own recogniser, and stay real-time on this Mac?
 *
 * It does NOT touch the app: no UI, no VTT, no toggle, no IPC. It joins the last
 * voice channel, subscribes to whoever speaks, and prints one line per speaker.
 *
 * Usage (quit Doty first — same bot token, same channel):
 *   DOTY_DISCORD_TOKEN=xxx pnpm spike:discord
 *   DOTY_DISCORD_TOKEN=xxx pnpm spike:discord --channel 123 --guild 456 --model ~/.doty/models/x.gguf
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { EndBehaviorType, joinVoiceChannel } from '@discordjs/voice'
import { Client, GatewayIntentBits } from 'discord.js'
import ffmpegStatic from 'ffmpeg-static'
import prism from 'prism-media'
import { TranscribeModel, getAvailableBackends } from 'transcribe-cpp'

const OGG = '\x1b[2m' // dim, for status noise
const OFF = '\x1b[0m'

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? null : process.argv[i + 1]
}

const profile = process.env.DOTY_PROFILE?.trim()
const dotyHome = profile ? join(homedir(), '.doty', 'profiles', profile) : join(homedir(), '.doty')
const userData = profile ? join(dotyHome, 'electron') : join(homedir(), 'Library', 'Application Support', 'doty')
const configPath = join(userData, 'config.json')

function config() {
  try {
    return JSON.parse(readFileSync(configPath, 'utf-8'))
  } catch {
    return {}
  }
}

/** The app stores the token encrypted; the spike asks for it (and does not echo it). */
async function token() {
  const env = process.env.DOTY_DISCORD_TOKEN?.trim()
  if (env) return env
  if (!process.stdin.isTTY) {
    console.error('No bot token. Pass DOTY_DISCORD_TOKEN=<token> (the prototype never stores it).')
    process.exit(1)
  }
  console.log(`${OGG}1/3 bot token — not stored, not echoed${OFF}`)
  const value = await hiddenLine('Bot token: ')
  if (value.split('.').length !== 3) {
    console.error('That does not look like a bot token (three dot-separated parts).')
    process.exit(1)
  }
  return value
}

/** Read a line without echoing it, so the token stays out of scrollback. */
function hiddenLine(prompt) {
  return new Promise((resolve) => {
    process.stdout.write(prompt)
    let value = ''
    const done = () => {
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdin.off('data', onData)
      process.stdout.write('\n')
      resolve(value.trim())
    }
    const onData = (buf) => {
      for (const ch of buf.toString('utf8')) {
        if (ch === '\r' || ch === '\n') return done()
        if (ch === '\u0003') process.exit(130)
        if (ch === '\u007f') value = value.slice(0, -1)
        else value += ch
      }
    }
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.on('data', onData)
  })
}

async function ask(prompt) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return (await rl.question(prompt)).trim()
  } finally {
    rl.close()
  }
}

async function pick(prompt, items, label) {
  items.forEach((item, i) => console.log(`  ${i + 1}) ${label(item)}`))
  const answer = Number(await ask(`${prompt} [1-${items.length}]: `))
  const index = Number.isInteger(answer) && answer >= 1 && answer <= items.length ? answer - 1 : 0
  return items[index]
}

/**
 * Pick the model the app would use. `--model` wins; then a custom path in
 * settings; then any streaming GGUF in ~/.doty/models.
 */
function resolveModel() {
  const argModel = arg('model')
  if (argModel && existsSync(argModel.replace(/^~/, homedir()))) return argModel.replace(/^~/, homedir())
  const custom = config().modelPath
  if (typeof custom === 'string' && custom.endsWith('.gguf') && existsSync(custom)) return custom
  const dir = join(homedir(), '.doty', 'models')
  const ggufs = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.gguf') && !/vad|lang-id/.test(f)) : []
  const pick = ggufs.find((f) => /streaming/.test(f)) ?? ggufs.find((f) => /parakeet/.test(f)) ?? ggufs[0]
  if (!pick) {
    console.error(`No GGUF model in ${dir}. Download one in Doty's settings first.`)
    process.exit(1)
  }
  return join(dir, pick)
}

/** 48 kHz stereo s16le → 16 kHz mono s16le, the same resample the design picked. */
function resampler() {
  const ffmpeg = spawn(
    ffmpegStatic,
    '-hide_banner -loglevel error -f s16le -ar 48000 -ac 2 -i pipe:0 -f s16le -ar 16000 -ac 1 pipe:1'.split(' '),
    { stdio: ['pipe', 'pipe', 'inherit'] },
  )
  return ffmpeg
}

const FEED_SAMPLES = 3200 // 200 ms at 16 kHz
const speakers = new Map() // userId → state
const started = Date.now()
const clock = () => new Date().toISOString().slice(11, 19)

async function speakerFor(userId) {
  if (speakers.has(userId)) return speakers.get(userId)
  const state = {
    userId,
    label: null,
    model: null,
    session: null,
    stream: null,
    queue: Promise.resolve(),
    buf: new Float32Array(0),
    ffmpeg: null,
    printed: '',
    audioSamples: 0,
    decodeMs: 0,
    feeds: 0,
    modelMs: 0,
    utterances: 0,
  }
  speakers.set(userId, state)
  return state
}

/** Loads one model per speaker — the cost this prototype exists to measure. */
async function ensureRecogniser(state, modelPath, language) {
  if (state.session) return
  const t0 = Date.now()
  state.model = await TranscribeModel.load(modelPath, { backend: 'auto' })
  state.modelMs = Date.now() - t0
  state.session = state.model.createSession()
  const caps = state.model.capabilities
  if (!caps?.supportsStreaming) {
    console.error(`${state.label}: ${modelPath} cannot stream. Pick a streaming model (nemotron / parakeet).`)
    process.exit(1)
  }
  state.language = (caps.languages ?? []).includes(language) ? language : undefined
  console.log(
    `${OGG}${clock()} ${state.label}: model loaded in ${state.modelMs} ms (rss ${(process.memoryUsage().rss / 1e6) | 0} MB)${OFF}`,
  )
}

function feed(state, samples) {
  state.queue = state.queue.then(async () => {
    if (!state.stream) return
    const t0 = Date.now()
    await state.stream.feed(samples)
    state.decodeMs += Date.now() - t0
    state.feeds++
    const full = state.stream.text?.full ?? ''
    if (full && full !== state.printed) {
      state.printed = full
      console.log(`${clock()} ${state.label}: ${full}`)
    }
  })
}

async function onAudio(state, int16) {
  const floats = new Float32Array(int16.length / 2)
  for (let i = 0; i < floats.length; i++) floats[i] = int16.readInt16LE(i * 2) / 32768
  state.audioSamples += floats.length
  const joined = new Float32Array(state.buf.length + floats.length)
  joined.set(state.buf)
  joined.set(floats, state.buf.length)
  let offset = 0
  while (joined.length - offset >= FEED_SAMPLES) {
    feed(state, joined.slice(offset, offset + FEED_SAMPLES))
    offset += FEED_SAMPLES
  }
  state.buf = joined.slice(offset)
}

async function startUtterance(state) {
  if (state.stream) return
  if (!state.session) return
  state.stream = await state.session.stream({
    commitPolicy: 'stable_prefix',
    ...(state.language ? { language: state.language } : {}),
  })
  state.printed = ''
}

async function endUtterance(state) {
  if (!state.stream) return
  state.utterances++
  await state.stream.finalize()
  const final = (state.stream.text?.full ?? '').trim()
  if (final && final !== state.printed) console.log(`${clock()} ${state.label}: ${final}`)
  state.stream.reset()
  state.stream = null
}

function labelFor(guild, userId) {
  const member = guild?.members?.cache?.get(userId)
  if (member?.displayName) return member.displayName
  const user = client.users.cache.get(userId)
  if (user?.username) return user.username
  return `Remote ${speakers.size + 1}`
}

const cfg = config()
const modelPath = resolveModel()
const language = cfg.sttLanguage && cfg.sttLanguage !== 'auto' ? cfg.sttLanguage : undefined

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
})

client.once('ready', async (me) => {
  console.log(`${OGG}spike: connected as ${me.user.tag} — ${me.guilds.cache.size} guild(s)${OFF}`)
  let guild = client.guilds.cache.get(arg('guild') ?? cfg.discordLastGuildId)
  if (!guild) {
    const guilds = [...client.guilds.cache.values()]
    if (guilds.length === 0) {
      console.error('The bot is in no server. Invite it to yours first.')
      process.exit(1)
    }
    console.log(`${OGG}2/3 server — the remembered one is not one of them${OFF}`)
    guild = guilds.length === 1 ? guilds[0] : await pick('Server', guilds, (g) => g.name)
  }

  const remembered = arg('channel') ?? cfg.discordLastChannelId
  const voiceChannels = [...guild.channels.cache.values()].filter((c) => c.isVoiceBased())
  let channel = voiceChannels.find((c) => c.id === remembered)
  if (!channel) {
    if (voiceChannels.length === 0) {
      console.error(`${guild.name} has no voice channels. Create one, then rerun.`)
      process.exit(1)
    }
    console.log(`${OGG}3/3 voice channel in ${guild.name}${OFF}`)
    channel = await pick(
      'Channel',
      voiceChannels,
      (c) => `#${c.name}${c.members?.size ? ` — ${c.members.size} connected` : ''}`,
    )
  }

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: false,
  })
  const receiver = connection.receiver
  console.log(`${OGG}spike: joined #${channel.name} (${guild.name}) as a listener — 4/4 listening${OFF}`)
  console.log(`${OGG}spike: rerun with --guild ${guild.id} --channel ${channel.id} to skip the prompts${OFF}`)
  console.log(`${OGG}spike: model ${modelPath}${language ? ` (language ${language})` : ''}${OFF}`)
  console.log(`${OGG}spike: speak in the channel — one line per speaker${OFF}`)
  console.log(`${OGG}spike: backends ${getAvailableBackends().map((b) => b.kind).join(', ')}${OFF}`)

  receiver.speaking.on('start', async (userId) => {
    const state = await speakerFor(userId)
    if (!state.label) {
      state.label = labelFor(guild, userId)
      state.ffmpeg = resampler()
      state.ffmpeg.stdout.on('data', (chunk) => onAudio(state, chunk))
      state.ffmpeg.stdin.on('error', () => {}) // the child dies with the process
      console.log(`${OGG}${clock()} new speaker: ${state.label}${OFF}`)
    }
    await ensureRecogniser(state, modelPath, language)
    await startUtterance(state)
    if (state.subscribed) return
    state.subscribed = true

    const opus = receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: 1200 },
    })
    // 48 kHz stereo Opus → PCM; ffmpeg does the 16 kHz downmix.
    opus.pipe(new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 })).pipe(state.ffmpeg.stdin)
    opus.on('end', () => {
      state.subscribed = false
      // Let the last frames reach the recogniser before finalising.
      state.queue = state.queue.then(async () => {
        await new Promise((r) => setTimeout(r, 250))
        await endUtterance(state)
      })
    })
  })

  process.on('SIGINT', async () => {
    console.log(`\n${OGG}spike: stopping${OFF}`)
    connection.destroy()
    client.destroy()
    const summary = [...speakers.values()].map((s) => ({
      speaker: s.label,
      modelMs: s.modelMs,
      utterances: s.utterances,
      audioSec: +(s.audioSamples / 16000).toFixed(1),
      decodeMs: s.decodeMs,
      rtf: s.audioSamples ? +(s.decodeMs / 1000 / (s.audioSamples / 16000)).toFixed(2) : null,
      rssMb: (process.memoryUsage().rss / 1e6) | 0,
    }))
    console.table(summary)
    for (const s of speakers.values()) {
      s.ffmpeg?.kill()
      s.session?.dispose()
      s.model?.dispose()
    }
    // Metal teardown: never process.exit() straight after dispose.
    setTimeout(() => process.exit(0), 300)
  })

  const heap = setInterval(() => {
    const seconds = ((Date.now() - started) / 1000) | 0
    const feeds = [...speakers.values()].reduce((a, s) => a + s.feeds, 0)
    console.log(
      `${OGG}${clock()} ${speakers.size} speaker(s), ${feeds} feeds, ${seconds}s, rss ${(process.memoryUsage().rss / 1e6) | 0} MB${OFF}`,
    )
  }, 10000)
  heap.unref()
})

client.on('error', (e) => console.error(`discord: ${e.message}`))
const botToken = await token()
client.login(botToken).catch((e) => {
  console.error(`Discord refused to log in: ${e.message}`)
  process.exit(1)
})
