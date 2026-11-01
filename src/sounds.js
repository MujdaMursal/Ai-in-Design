// Cartoon sound effects, made in the browser with the Web Audio API: no sound files.
// Browsers only allow sound after a click, so the audio starts with the first drop.

let ctx = null
let master = null
let muted = false
const lastPlayed = {}
const VOLUME = 0.3 // the whole game's loudness (was 0.6)
let screaming = 0 // how many people are screaming right now
const MAX_SCREAMS = 2

function audio() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)()
    master = ctx.createGain()
    master.gain.value = muted ? 0 : VOLUME
    master.connect(ctx.destination)
  }
  if (ctx.state === 'suspended') ctx.resume()
  return ctx
}

export function setMuted(value) {
  muted = value
  if (master) master.gain.value = muted ? 0 : VOLUME
}

// Skip a sound if the same one played a moment ago, so a feeding frenzy doesn't deafen you.
function tooSoon(name, gap) {
  const now = performance.now()
  if (now - (lastPlayed[name] ?? 0) < gap) return true
  lastPlayed[name] = now
  return false
}

// A volume envelope: quick rise, hold, fade out by `end`.
function envelope(c, peak, start, end, attack = 0.03) {
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, start)
  g.gain.exponentialRampToValueAtTime(peak, start + attack)
  g.gain.setValueAtTime(peak, Math.max(start + attack, end - 0.15))
  g.gain.exponentialRampToValueAtTime(0.0001, end)
  g.connect(master)
  return g
}

function noise(c, seconds) {
  const buffer = c.createBuffer(1, Math.ceil(c.sampleRate * seconds), c.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  const source = c.createBufferSource()
  source.buffer = buffer
  return source
}

// "Aaaaah!": a buzzy voice through two vowel filters, rising then sliding down as they fall.
// Kept soft: lower voice, rounded off by a filter, at most two at once, never longer than 1.2 s.
export function scream(seconds) {
  if (screaming >= MAX_SCREAMS || tooSoon('scream', 250)) return
  const c = audio()
  const t = c.currentTime
  const length = Math.min(seconds, 1.2)
  const end = t + length
  screaming++
  setTimeout(() => screaming--, length * 1000)
  const pitch = 380 + Math.random() * 260
  const soft = c.createBiquadFilter()
  soft.type = 'lowpass'
  soft.frequency.value = 1400
  soft.connect(envelope(c, 0.12, t, end, 0.08))
  const out = soft
  const vowels = [
    [700 + Math.random() * 150, 4],
    [1100 + Math.random() * 200, 5],
  ].map(([f, q]) => {
    const filter = c.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = f
    filter.Q.value = q
    filter.connect(out)
    return filter
  })
  const vibrato = c.createOscillator()
  vibrato.frequency.value = 6 + Math.random() * 3
  const depth = c.createGain()
  depth.gain.value = pitch * 0.03
  vibrato.connect(depth)
  for (const detune of [0, 12]) {
    const voice = c.createOscillator()
    voice.type = 'sawtooth'
    voice.detune.value = detune
    voice.frequency.setValueAtTime(pitch * 0.85, t)
    voice.frequency.linearRampToValueAtTime(pitch, t + 0.15)
    voice.frequency.exponentialRampToValueAtTime(pitch * 0.55, end)
    depth.connect(voice.frequency)
    for (const f of vowels) voice.connect(f)
    voice.start(t)
    voice.stop(end)
  }
  vibrato.start(t)
  vibrato.stop(end)
}

export function splash() {
  if (tooSoon('splash', 200)) return
  const c = audio()
  const t = c.currentTime
  const source = noise(c, 0.6)
  const filter = c.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.setValueAtTime(1800, t)
  filter.frequency.exponentialRampToValueAtTime(300, t + 0.5)
  source.connect(filter).connect(envelope(c, 0.3, t, t + 0.55, 0.02))
  source.start(t)
}

// A thud on a roof.
export function land() {
  if (tooSoon('land', 200)) return
  const c = audio()
  const t = c.currentTime
  const osc = c.createOscillator()
  osc.frequency.setValueAtTime(160, t)
  osc.frequency.exponentialRampToValueAtTime(50, t + 0.2)
  osc.connect(envelope(c, 0.3, t, t + 0.25, 0.005))
  osc.start(t)
  osc.stop(t + 0.3)
}

export function chomp() {
  if (tooSoon('chomp', 300)) return
  const c = audio()
  const t = c.currentTime
  for (const at of [0, 0.12]) {
    const source = noise(c, 0.1)
    const filter = c.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 700
    source.connect(filter).connect(envelope(c, 0.3, t + at, t + at + 0.09, 0.005))
    source.start(t + at)
  }
  const thump = c.createOscillator()
  thump.frequency.setValueAtTime(120, t)
  thump.frequency.exponentialRampToValueAtTime(45, t + 0.25)
  thump.connect(envelope(c, 0.3, t, t + 0.3, 0.005))
  thump.start(t)
  thump.stop(t + 0.35)
}

// The kraken: a low, rough, growling roar.
export function roar() {
  if (tooSoon('roar', 3000)) return
  const c = audio()
  const t = c.currentTime
  const end = t + 2
  const out = envelope(c, 0.4, t, end, 0.15)
  const filter = c.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.setValueAtTime(300, t)
  filter.frequency.linearRampToValueAtTime(900, t + 0.6)
  filter.frequency.exponentialRampToValueAtTime(200, end)
  const rough = c.createWaveShaper()
  const curve = new Float32Array(256)
  for (let i = 0; i < 256; i++) curve[i] = Math.tanh(((i / 128) - 1) * 6)
  rough.curve = curve
  rough.connect(filter).connect(out)
  const growl = c.createOscillator()
  growl.frequency.value = 22
  const growlDepth = c.createGain()
  growlDepth.gain.value = 18
  growl.connect(growlDepth)
  for (const f of [55, 58.5, 82]) {
    const osc = c.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(f, t)
    osc.frequency.linearRampToValueAtTime(f * 1.25, t + 0.5)
    osc.frequency.exponentialRampToValueAtTime(f * 0.7, end)
    growlDepth.connect(osc.frequency)
    osc.connect(rough)
    osc.start(t)
    osc.stop(end)
  }
  const breath = noise(c, 2)
  const breathFilter = c.createBiquadFilter()
  breathFilter.type = 'bandpass'
  breathFilter.frequency.value = 500
  breath.connect(breathFilter).connect(envelope(c, 0.25, t, end, 0.2))
  breath.start(t)
  growl.start(t)
  growl.stop(end)
}

// A ship's horn: two low notes together.
export function horn(big) {
  if (tooSoon('horn', 5000)) return
  const c = audio()
  const t = c.currentTime
  const end = t + (big ? 1.4 : 0.7)
  const filter = c.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 900
  filter.connect(envelope(c, 0.15, t, end, 0.1))
  for (const f of big ? [98, 131] : [220, 277]) {
    const osc = c.createOscillator()
    osc.type = 'triangle'
    osc.frequency.value = f
    osc.connect(filter)
    osc.start(t)
    osc.stop(end)
  }
}

// A rising three-note jingle; higher for bigger achievements.
export function levelUp(high = false) {
  if (tooSoon('levelUp', 800)) return
  const c = audio()
  const t = c.currentTime
  const notes = high ? [523, 659, 784, 1046] : [392, 494, 587]
  notes.forEach((f, i) => {
    const osc = c.createOscillator()
    osc.type = 'triangle'
    osc.frequency.value = f
    const at = t + i * 0.09
    osc.connect(envelope(c, 0.12, at, at + 0.22, 0.01))
    osc.start(at)
    osc.stop(at + 0.25)
  })
}

// A cheerful "ding" when a boat saves someone.
export function rescue() {
  if (tooSoon('rescue', 400)) return
  const c = audio()
  const t = c.currentTime
  const osc = c.createOscillator()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(1046, t)
  osc.frequency.setValueAtTime(1318, t + 0.08)
  osc.connect(envelope(c, 0.12, t, t + 0.35, 0.005))
  osc.start(t)
  osc.stop(t + 0.4)
}

// A building collapsing: a deep rumble with crumbling stone, about 3 seconds.
export function collapse() {
  if (tooSoon('collapse', 1000)) return
  const c = audio()
  const t = c.currentTime
  const end = t + 3.2
  const rumble = noise(c, 3.2)
  const low = c.createBiquadFilter()
  low.type = 'lowpass'
  low.frequency.setValueAtTime(180, t)
  low.frequency.exponentialRampToValueAtTime(60, end)
  rumble.connect(low).connect(envelope(c, 0.8, t, end, 0.3))
  rumble.start(t)
  // Stones breaking off: short knocks at random moments.
  for (let i = 0; i < 9; i++) {
    const at = t + 0.2 + Math.random() * 2.4
    const knock = noise(c, 0.08)
    const f = c.createBiquadFilter()
    f.type = 'bandpass'
    f.frequency.value = 300 + Math.random() * 500
    knock.connect(f).connect(envelope(c, 0.25, at, at + 0.08, 0.005))
    knock.start(at)
  }
}
