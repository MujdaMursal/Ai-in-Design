// Weimar under water: a game. Raise the water with the slider; more and bigger fish and
// boats arrive. Click to drop a person: fish and sharks race the boats to reach them.
// Fish level up by eating; a grown kraken hunts the boats, and the boats flee.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Buildings, Controls, Streets, USE_LABELS, useColour } from './City.jsx'
import { ATTRIBUTION, loadKit } from './geo.js'
import { FloodWorld, KRAKEN_HUNTS_FROM, mealsToNext, SPECIES } from './floodWorld.js'
import * as sound from './sounds.js'
import { ACTIONS, askJudge, JUDGE_AVAILABLE } from './judge.js'

const MAX_LEVEL = 40 // metres; the tallest building in the kit is 36 m
const WATER = '#2f7fbf'
const BADGES = 8 // level badges shown at most, for the biggest fish
const number = (n) => n.toLocaleString('en-GB')

// The kraken judge: a verdict every 30 s if you dropped anyone, or at once after 5 doomed drops
// in a row (into the water closer to a fish or shark than to any boat). If you drop nobody, it
// speaks up after 60 s, at most 5 times in a row and only while the tab is open, so it doesn't
// use up your Claude usage limit while you're away.
const JUDGE_EVERY = 30 // seconds
const IDLE_AFTER = 60 // seconds
const IDLE_MAX = 5
const BUBBLE_TITLES = {
  spare: 'The kraken spares you',
  warn: 'The kraken warns you',
  sink_building: 'The kraken judges you: cruel',
  mock_silence: 'The kraken is bored',
}
const clock = () => new Date().toLocaleTimeString('en-GB')
const STREAK = 5
const BUBBLE_FOR = 5 // seconds the kraken's words stay up
const TAGS = 8 // labels over destroyed buildings shown at most

// Your level, from all the meals eaten so far (people, and boats the kraken ate).
const RANKS = [
  [0, 'Drizzle'],
  [3, 'Puddle'],
  [8, 'Pond'],
  [15, 'Ilm in flood'],
  [25, 'Lake Weimar'],
  [40, 'Inland sea'],
  [60, 'Open ocean'],
  [85, 'Shark tank'],
  [115, "Kraken's lair"],
  [150, 'Atlantis'],
]

function rankOf(meals) {
  let i = 0
  while (i + 1 < RANKS.length && meals >= RANKS[i + 1][0]) i++
  return { level: i + 1, name: RANKS[i][1], from: RANKS[i][0], to: RANKS[i + 1]?.[0] }
}

function Bar({ value, colour }) {
  return (
    <span className="bar">
      <i style={{ width: `${Math.min(100, value * 100)}%`, background: colour }} />
    </span>
  )
}

// Runs the game one step every frame and hands its events to the page.
function Simulation({ world, onEvents }) {
  useFrame((state, dt) => {
    world.update(dt, state.clock.elapsedTime)
    const events = world.takeEvents()
    if (events.length) onEvents.current(events)
  })
  return null
}

// Moves the level badges every frame so they float above the biggest fish.
function BadgeTracker({ world, badges }) {
  const v = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ camera, size }) => {
    const leaders = world.leaders(BADGES)
    const placed = [] // screen spots already taken, so badges don't pile up
    badges.current.forEach((el, i) => {
      if (!el) return
      const a = leaders[i]
      const s = a ? a.sp.size * a.scale : 0
      if (a) v.set(a.x, a.z + s * (a.sp.kind === 'kraken' ? 0.8 : 0.35) + 4, -a.y).project(camera)
      if (!a || v.z > 1) {
        el.style.display = 'none'
        return
      }
      el.style.display = ''
      const key = `${a.id}:${a.level}:${a.meals}`
      if (el.dataset.key !== key) {
        el.dataset.key = key
        const max = a.level >= a.sp.maxLevel
        el.className = a.sp.kind === 'kraken' ? 'badge kraken' : 'badge'
        el.querySelector('b').textContent = `${a.sp.name} · Lv ${a.level}${max ? ' (max)' : ''}`
        el.querySelector('i').style.width = `${max ? 100 : (a.meals / mealsToNext(a.level)) * 100}%`
      }
      // Move a badge up until it no longer covers one placed before it (the kraken's comes first).
      const x = ((v.x + 1) / 2) * size.width
      let y = ((1 - v.y) / 2) * size.height
      while (placed.some(([px, py]) => Math.abs(px - x) < 120 && Math.abs(py - y) < 28)) y -= 28
      placed.push([x, y])
      el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`
    })
  })
  return null
}

// Keeps the kraken's speech bubble above its head. While the kraken hasn't risen yet,
// the bubble speaks from the deep, at the bottom of the screen.
function BubbleTracker({ world, bubble }) {
  const v = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ camera, size }) => {
    const el = bubble.current
    if (!el) return
    const k = world.krakenAgent()
    if (k) v.set(k.x, k.z + k.sp.size * k.scale * 0.9 + 6, -k.y).project(camera)
    if (!k || v.z > 1) {
      el.classList.add('deep')
      el.style.transform = ''
      return
    }
    el.classList.remove('deep')
    const x = Math.min(size.width - 160, Math.max(160, ((v.x + 1) / 2) * size.width))
    const y = Math.max(120, ((1 - v.y) / 2) * size.height)
    el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`
  })
  return null
}

// Labels over the buildings the kraken destroyed: a big red one while it flashes and sinks,
// small ones over the outline for the few seconds it stays.
function DestroyedTracker({ world, tags }) {
  const v = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ camera, size }) => {
    const list = world.destroyed().slice(-TAGS)
    tags.current.forEach((el, i) => {
      if (!el) return
      const d = list[i]
      if (d) v.set(d.x, d.z, -d.y).project(camera)
      if (!d || v.z > 1) {
        el.style.display = 'none'
        return
      }
      el.style.display = ''
      const text = d.active ? `☠ Destroyed by your cruelty: ${d.label}` : `☠ ${d.label}`
      if (el.textContent !== text) el.textContent = text
      el.className = d.active ? 'ruin active' : 'ruin'
      el.style.transform = `translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px) translate(-50%, -100%)`
    })
  })
  return null
}

export default function Flood() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [level, setLevel] = useState(0)
  const [stats, setStats] = useState(null)
  const [muted, setMuted] = useState(false)
  const [toasts, setToasts] = useState([])
  const badges = useRef([])
  const lastRank = useRef(1)

  // The kraken judge.
  const [sunk, setSunk] = useState(() => new Set()) // ids of buildings dragged under, until reload
  const [verdicts, setVerdicts] = useState([]) // the log: { at, trigger, action, noticed, reason, speech, building, note }
  const [speech, setSpeech] = useState(null) // what the bubble says now
  const [judging, setJudging] = useState(false)
  const [judgeError, setJudgeError] = useState(null)
  const bubble = useRef(null)
  const tags = useRef([])
  const drops = useRef([]) // drops since the last verdict
  const since = useRef(performance.now()) // when the last verdict was
  const streak = useRef(0)
  const busy = useRef(false)
  const idleRuns = useRef(0) // verdicts in a row without any drop

  useEffect(() => {
    loadKit().then(setData).catch((e) => setError(e.message))
  }, [])

  const world = useMemo(() => data && new FloodWorld(data), [data])
  useEffect(() => () => world?.dispose(), [world])
  useEffect(() => world?.setLevel(level), [world, level])
  useEffect(() => sound.setMuted(muted), [muted])

  // The panel's numbers, four times a second.
  useEffect(() => {
    if (!world) return
    const timer = setInterval(() => setStats(world.stats()), 250)
    return () => clearInterval(timer)
  }, [world])

  // A message that pops up for a few seconds.
  const toast = useCallback((text, tone = '') => {
    const id = Math.random()
    setToasts((list) => [...list.slice(-3), { id, text, tone }])
    setTimeout(() => setToasts((list) => list.filter((m) => m.id !== id)), 2800)
  }, [])

  // Sounds and messages for what happened in the water.
  const onEvents = useRef(null)
  onEvents.current = (events) => {
    for (const e of events) {
      if (e.type === 'splash') sound.splash()
      else if (e.type === 'land') sound.land()
      else if (e.type === 'eaten') sound.chomp()
      else if (e.type === 'rescued') sound.rescue()
      else if (e.type === 'flee') sound.horn(e.big)
      else if (e.type === 'collapse') {
        sound.collapse()
        toast(`Destroyed by your cruelty: ${e.label}`, 'danger')
      }
      else if (e.type === 'kraken') {
        sound.roar()
        toast('The kraken has risen!', 'danger')
      } else if (e.type === 'boatEaten') {
        sound.chomp()
        sound.roar()
        toast(`The kraken ate a ${e.name.toLowerCase()}!`, 'danger')
      } else if (e.type === 'levelup') {
        if (e.kraken) sound.roar()
        else sound.levelUp(e.max)
        const text = `${e.name} reached level ${e.level}${e.max ? ' – fully grown!' : ''}`
        toast(text, e.kraken ? 'danger' : '')
        if (e.kraken && e.level === KRAKEN_HUNTS_FROM) toast('The kraken is hungry for boats. Boats, flee!', 'danger')
      }
    }
  }

  // Your level goes up with the meals: a jingle and a message.
  const meals = stats ? stats.fed + stats.boatsEaten : 0
  const rank = rankOf(meals)
  useEffect(() => {
    if (rank.level > lastRank.current) {
      sound.levelUp(true)
      toast(`Your level ${rank.level}: ${rank.name}!`, 'rank')
    }
    lastRank.current = rank.level
  }, [rank.level, rank.name, toast])

  // Buildings below the water take on its colour.
  const colourOf = useCallback((house) => {
    const c = new THREE.Color(useColour(house.use))
    return house.height <= level ? '#' + c.lerp(new THREE.Color(WATER), 0.55).getHexString() : '#' + c.getHexString()
  }, [level])

  const houses = useMemo(() => (data ? data.houses.filter((h) => !sunk.has(h.id)) : []), [data, sunk])
  const underwater = useMemo(() => houses.filter((h) => h.height <= level).length, [houses, level])

  // Asks Claude for a verdict on the drops since the last one, then carries out its action.
  const judge = useRef(null)
  judge.current = async (trigger) => {
    if (!JUDGE_AVAILABLE || busy.current || !world) return
    busy.current = true
    setJudging(true)
    const batch = drops.current
    const seconds = (performance.now() - since.current) / 1000
    drops.current = []
    streak.current = 0
    try {
      const answer = await askJudge({ drops: batch, seconds, trigger, level, past: verdicts.slice(-4) })
      setJudgeError(null)
      let building = null
      let note = null
      if (answer.action === 'sink_building' && !batch.length) {
        // It may only punish drops; with none to punish the game turns it into a warning.
        answer.action = 'warn'
        note = 'It wanted to sink a building, but nobody was dropped, so the game made it a warning.'
      }
      if (answer.action === 'sink_building') {
        // The building nearest to where the doomed people fell (or all of them, if none was doomed).
        const doomed = batch.filter((d) => d.doomed)
        const pool = doomed.length ? doomed : batch
        const cx = pool.reduce((a, d) => a + d.x, 0) / pool.length
        const cy = pool.reduce((a, d) => a + d.y, 0) / pool.length
        let best = Infinity
        for (const h of houses) {
          if (h.height < 4) continue
          const d = Math.hypot((h.bbox[0] + h.bbox[2]) / 2 - cx, (h.bbox[1] + h.bbox[3]) / 2 - cy)
          if (d < best) {
            best = d
            building = h
          }
        }
        if (building) {
          const label = `${USE_LABELS[building.use ?? 'none'] ?? 'Unknown use'} building, ${Math.round(building.height)} m`
          world.sinkBuilding(building, colourOf(building), label)
          setSunk((old) => new Set(old).add(building.id))
          sound.roar()
          toast('The kraken has chosen a building. Look for the red beam!', 'danger')
        }
      }
      if (answer.action === 'warn') sound.horn(true)
      setVerdicts((old) => [...old, { ...answer, at: clock(), trigger, building: building?.label, note }])
      setSpeech({ ...answer, id: Math.random() })
    } catch (e) {
      setJudgeError(e.message)
    } finally {
      since.current = performance.now()
      busy.current = false
      setJudging(false)
    }
  }

  // The kraken checks on you by itself: every 30 s if you dropped anyone, after 60 s if not.
  useEffect(() => {
    if (!world || !JUDGE_AVAILABLE) return
    const timer = setInterval(() => {
      if (busy.current) return
      const waited = (performance.now() - since.current) / 1000
      if (drops.current.length) {
        if (waited >= JUDGE_EVERY) judge.current('timer')
      } else if (waited >= IDLE_AFTER && idleRuns.current < IDLE_MAX && !document.hidden) {
        idleRuns.current++
        judge.current('idle')
      }
    }, 1000)
    return () => clearInterval(timer)
  }, [world])

  // The bubble goes away after a while.
  useEffect(() => {
    if (!speech) return
    const timer = setTimeout(() => setSpeech(null), BUBBLE_FOR * 1000)
    return () => clearTimeout(timer)
  }, [speech])

  // What the panel says the kraken is doing right now.
  const judgeStatus = () => {
    const waited = (performance.now() - since.current) / 1000
    if (judging) return 'The kraken is thinking… (a few seconds)'
    if (drops.current.length) return `Watching you. Next verdict in ${Math.max(0, Math.ceil(JUDGE_EVERY - waited))} s.`
    if (idleRuns.current >= IDLE_MAX) return 'The kraken has dozed off. Drop someone to wake it.'
    return `Quiet. If you do nothing, it speaks up in ${Math.max(0, Math.ceil(IDLE_AFTER - waited))} s.`
  }

  if (error) return <p className="message error">The city kit didn't load ({error}).</p>
  if (!data || !world) return <p className="message">Loading the city kit…</p>

  const [x0, y0, x1, y1] = data.extent
  // A click (not a drag) anywhere drops a person there, screaming all the way down.
  const drop = (e) => {
    e.stopPropagation()
    if (e.delta > 4) return
    const x = e.point.x
    const y = -e.point.z
    const fall = world.drop(x, y)
    if (!fall) return
    sound.scream(fall.fall)
    // What the judge sees: where you dropped them, and who is nearer, the hunters or the boats.
    const predator = world.nearest(x, y, false)
    const boat = world.nearest(x, y, true)
    const doomed = fall.water && predator.distance < boat.distance
    // The first drop after a quiet spell starts a fresh 30 s round.
    if (!drops.current.length && performance.now() - since.current > JUDGE_EVERY * 1000) since.current = performance.now()
    idleRuns.current = 0
    drops.current.push({
      t: (performance.now() - since.current) / 1000, x, y, water: fall.water, doomed,
      predator: predator.distance, predatorName: predator.name, boat: boat.distance,
    })
    streak.current = doomed ? streak.current + 1 : 0
    if (streak.current >= STREAK) judge.current('streak')
  }

  return (
    <div className="app">
      <Canvas camera={{ position: [700, 1100, 1500], fov: 40, near: 1, far: 20000 }} dpr={[1, 2]}>
        <color attach="background" args={['#dde7ee']} />
        <ambientLight intensity={1.5} />
        <directionalLight position={[-600, 1200, 400]} intensity={1.7} />
        <directionalLight position={[800, 600, -600]} intensity={0.4} />

        <mesh rotation={[-Math.PI / 2, 0, 0]} onClick={drop}>
          <planeGeometry args={[6000, 6000]} />
          <meshBasicMaterial color="#efece4" />
        </mesh>
        <Streets edges={data.edges} />
        <Buildings houses={houses} colourOf={colourOf} onPick={drop} />
        <primitive object={world.group} />
        <Simulation world={world} onEvents={onEvents} />
        <BadgeTracker world={world} badges={badges} />
        <BubbleTracker world={world} bubble={bubble} />
        <DestroyedTracker world={world} tags={tags} />

        <mesh
          position={[(x0 + x1) / 2, level, -(y0 + y1) / 2]}
          rotation={[-Math.PI / 2, 0, 0]}
          visible={level > 0}
          renderOrder={10}
          onClick={drop}
        >
          <planeGeometry args={[x1 - x0, y1 - y0]} />
          <meshPhongMaterial color={WATER} transparent opacity={0.55} shininess={90} depthWrite={false} />
        </mesh>

        <Controls />
      </Canvas>

      {Array.from({ length: BADGES }, (_, i) => (
        <div key={i} className="badge" style={{ display: 'none' }} ref={(el) => (badges.current[i] = el)}>
          <b />
          <span className="bar">
            <i />
          </span>
        </div>
      ))}

      {Array.from({ length: TAGS }, (_, i) => (
        <div key={i} className="ruin" style={{ display: 'none' }} ref={(el) => (tags.current[i] = el)} />
      ))}

      <div ref={bubble} className={`kraken-bubble deep ${speech?.action ?? ''}`} hidden={!speech}>
        <small>{speech && BUBBLE_TITLES[speech.action]}</small>
        {speech?.speech}
      </div>

      <div className="toasts">
        {toasts.map((m) => (
          <div key={m.id} className={`toast ${m.tone}`}>
            {m.text}
          </div>
        ))}
      </div>

      <aside className="panel">
        <h1>Weimar under water</h1>
        <a className="switch" href={import.meta.env.BASE_URL}>
          ← How far can you walk?
        </a>
        <p className="hint">
          Raise the water with the slider. Click to drop a person: fish and sharks race the boats to reach them.
          Every meal brings a fish closer to its next level.
        </p>
        <button className="mute" onClick={() => setMuted((m) => !m)}>
          Sound: {muted ? 'off' : 'on'}
        </button>

        <label className="slider">
          <span>
            Water level <strong>{level.toFixed(1)} m</strong>
          </span>
          <input
            type="range"
            min={0}
            max={MAX_LEVEL}
            step={0.5}
            value={level}
            onChange={(e) => setLevel(Number(e.target.value))}
          />
        </label>
        <p className="muted">
          {number(underwater)} of {number(data.houses.length)} buildings completely under water.
        </p>

        {stats && (
          <>
            <table className="score">
              <tbody>
                <tr>
                  <td>Fed to the fish</td>
                  <td className="num right">{stats.fed}</td>
                </tr>
                <tr>
                  <td>Boats eaten by the kraken</td>
                  <td className="num right">{stats.boatsEaten}</td>
                </tr>
                <tr>
                  <td>Rescued by boats</td>
                  <td className="num right">{stats.rescued}</td>
                </tr>
                <tr>
                  <td>Still in the water</td>
                  <td className="num right">{stats.swimming}</td>
                </tr>
                <tr>
                  <td>Standing on a roof or street</td>
                  <td className="num right">{stats.safe}</td>
                </tr>
              </tbody>
            </table>

            <h2 className="small">In the water now</h2>
            <ul className="species">
              {SPECIES.map((sp) => {
                const n = stats.counts[sp.key] ?? 0
                return (
                  <li key={sp.key} className={n ? '' : 'later'}>
                    <span className="swatch" style={{ background: sp.colour }} />
                    {sp.name}
                    <span className="num">{n ? n : `from ${sp.from} m`}</span>
                  </li>
                )
              })}
            </ul>
          </>
        )}

        <div className="method">
          <p>
            A game, not a flood model. The city kit has no ground heights, so the whole kit floods evenly, like a
            bathtub. The building heights are real (LoD2). Animals and boats are drawn far larger than life so you
            can see them from above.
          </p>
        </div>
      </aside>

      {stats && (
        <aside className="progress">
          <h2>
            Your level {rank.level}: {rank.name}
          </h2>
          <Bar value={rank.to ? (meals - rank.from) / (rank.to - rank.from) : 1} colour="#2747b8" />
          <p className="muted">
            {rank.to ? `${meals} meals – ${rank.to - meals} more to level ${rank.level + 1}` : `${meals} meals – top level!`}
          </p>

          <h2 className="small">Hungriest fish</h2>
          {stats.leaders.length === 0 && <p className="muted">No fish has grown yet. Drop someone near one!</p>}
          <ul className="leaders">
            {stats.leaders.map((f) => (
              <li key={f.id}>
                <span>
                  <span className="swatch" style={{ background: f.colour }} />
                  {f.name} <strong>Lv {f.level}</strong>
                </span>
                <Bar value={f.max ? 1 : f.meals / f.next} colour={f.colour} />
                <small>{f.max ? 'fully grown' : `${f.meals} / ${f.next} meals to level ${f.level + 1}`}</small>
              </li>
            ))}
          </ul>

          <h2 className="small">The kraken judge</h2>
          {!JUDGE_AVAILABLE ? (
            <p className="muted">The kraken only thinks on localhost: it asks Claude through the dev server on the author's laptop. Here on the live page it sleeps, but the game works.</p>
          ) : (
            <div className="judge">
              <p>{judgeStatus()}</p>
              <p className="muted">
                Doomed drops in a row: {streak.current} / {STREAK} · Buildings dragged under: {sunk.size}
              </p>
              {judgeError && <p className="error">The kraken couldn't reach Claude: {judgeError}</p>}
              {verdicts.some((v) => v.building) && (
                <>
                  <p className="destroyed-title">Destroyed by you</p>
                  <ol className="destroyed">
                    {verdicts.filter((v) => v.building).map((v, i) => (
                      <li key={i}>{v.building}</li>
                    ))}
                  </ol>
                </>
              )}
              {verdicts.length > 0 && (
                <>
                  <p className="destroyed-title log-title">The kraken's log</p>
                  <ol className="kraken-log">
                    {[...verdicts].reverse().map((v, i) => (
                      <li key={verdicts.length - i} className={v.action}>
                        <b>
                          {v.at} · {ACTIONS[v.action]}
                        </b>
                        <span>
                          <em>Noticed:</em> {v.noticed}
                        </span>
                        <span>
                          <em>Why:</em> {v.reason}
                        </span>
                        {v.building && (
                          <span>
                            <em>Did:</em> dragged a {v.building.toLowerCase()} into the deep
                          </span>
                        )}
                        {v.note && <span className="muted">{v.note}</span>}
                        <q>{v.speech}</q>
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </div>
          )}

          {stats.kraken && (
            <p className="kraken-status">
              {stats.kraken.hunts
                ? `The kraken hunts boats up to ${stats.kraken.bite} m long.`
                : `Feed the kraken to level ${KRAKEN_HUNTS_FROM} and it starts hunting boats.`}
            </p>
          )}
        </aside>
      )}

      <footer className="attribution">{ATTRIBUTION}</footer>
    </div>
  )
}
