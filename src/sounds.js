// Cartoon sound effects, made in the browser with the Web Audio API: no sound files.
// Browsers only allow sound after a click, so the audio starts with the first drop.

let ctx = null
let master = null
let muted = false
const lastPlayed = {}

function audio() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)()
    master = ctx.createGain()
    master.gain.value = muted ? 0 : 0.6
    master.connect(ctx.destination)
  }
  if (ctx.state === 'suspended') ctx.resume()
  return ctx
}

export function setMuted(value) {
  muted = value
  if (master) master.gain.value = muted ? 0 : 0.6
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
export function scream(seconds) {
  const c = audio()
  const t = c.currentTime
  const end = t + seconds
  const pitch = 650 + Math.random() * 550
  const out = envelope(c, 0.3, t, end, 0.04)
  const vowels = [
    [800 + Math.random() * 200, 7],
    [1250 + Math.random() * 300, 9],
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
  depth.gain.value = pitch * 0.05
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
  if (tooSoon('splash', 60)) return
  const c = audio()
  const t = c.currentTime
  const source = noise(c, 0.6)
  const filter = c.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.setValueAtTime(1800, t)
  filter.frequency.exponentialRampToValueAtTime(300, t + 0.5)
  source.connect(filter).connect(envelope(c, 0.5, t, t + 0.55, 0.01))
  source.start(t)
}

// A thud on a roof.
export function land() {
  if (tooSoon('land', 60)) return
  const c = audio()
  const t = c.currentTime
  const osc = c.createOscillator()
  osc.frequency.setValueAtTime(160, t)
  osc.frequency.exponentialRampToValueAtTime(50, t + 0.2)
  osc.connect(envelope(c, 0.5, t, t + 0.25, 0.005))
  osc.start(t)
  osc.stop(t + 0.3)
}

export function chomp() {
  if (tooSoon('chomp', 90)) return
  const c = audio()
  const t = c.currentTime
  for (const at of [0, 0.12]) {
    const source = noise(c, 0.1)
    const filter = c.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 700
    source.connect(filter).connect(envelope(c, 0.6, t + at, t + at + 0.09, 0.005))
    source.start(t + at)
  }
  const thump = c.createOscillator()
  thump.frequency.setValueAtTime(120, t)
  thump.frequency.exponentialRampToValueAtTime(45, t + 0.25)
  thump.connect(envelope(c, 0.5, t, t + 0.3, 0.005))
  thump.start(t)
  thump.stop(t + 0.35)
}

// The kraken: a low, rough, growling roar.
export function roar() {
  if (tooSoon('roar', 1200)) return
  const c = audio()
  const t = c.currentTime
  const end = t + 2
  const out = envelope(c, 0.55, t, end, 0.15)
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
  if (tooSoon('horn', 1500)) return
  const c = audio()
  const t = c.currentTime
  const end = t + (big ? 1.4 : 0.7)
  const filter = c.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 900
  filter.connect(envelope(c, 0.3, t, end, 0.05))
  for (const f of big ? [98, 131] : [220, 277]) {
    const osc = c.createOscillator()
    osc.type = 'square'
    osc.frequency.value = f
    osc.connect(filter)
    osc.start(t)
    osc.stop(end)
  }
}

// A rising three-note jingle; higher for bigger achievements.
export function levelUp(high = false) {
  if (tooSoon('levelUp', 150)) return
  const c = audio()
  const t = c.currentTime
  const notes = high ? [784, 988, 1175, 1568] : [523, 659, 784]
  notes.forEach((f, i) => {
    const osc = c.createOscillator()
    osc.type = 'triangle'
    osc.frequency.value = f
    const at = t + i * 0.09
    osc.connect(envelope(c, 0.25, at, at + 0.22, 0.01))
    osc.start(at)
    osc.stop(at + 0.25)
  })
}

// A cheerful "ding" when a boat saves someone.
export function rescue() {
  if (tooSoon('rescue', 120)) return
  const c = audio()
  const t = c.currentTime
  const osc = c.createOscillator()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(1046, t)
  osc.frequency.setValueAtTime(1318, t + 0.08)
  osc.connect(envelope(c, 0.25, t, t + 0.35, 0.005))
  osc.start(t)
  osc.stop(t + 0.4)
}
