// Weimar under water: a game. Raise the water with the slider; more and bigger fish and
// boats arrive. Click to drop a person: fish and sharks race the boats to reach them.
// Fish level up by eating; a grown kraken hunts the boats, and the boats flee.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Buildings, Controls, Streets, useColour } from './City.jsx'
import { ATTRIBUTION, loadKit } from './geo.js'
import { FloodWorld, KRAKEN_HUNTS_FROM, mealsToNext, SPECIES } from './floodWorld.js'
import * as sound from './sounds.js'

const MAX_LEVEL = 40 // metres; the tallest building in the kit is 36 m
const WATER = '#2f7fbf'
const BADGES = 8 // level badges shown at most, for the biggest fish
const number = (n) => n.toLocaleString('en-GB')

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

export default function Flood() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [level, setLevel] = useState(0)
  const [stats, setStats] = useState(null)
  const [muted, setMuted] = useState(false)
  const [toasts, setToasts] = useState([])
  const badges = useRef([])
  const lastRank = useRef(1)

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

  const underwater = useMemo(() => (data ? data.houses.filter((h) => h.height <= level).length : 0), [data, level])

  if (error) return <p className="message error">The city kit didn't load ({error}).</p>
  if (!data || !world) return <p className="message">Loading the city kit…</p>

  const [x0, y0, x1, y1] = data.extent
  // A click (not a drag) anywhere drops a person there, screaming all the way down.
  const drop = (e) => {
    e.stopPropagation()
    if (e.delta > 4) return
    const fall = world.drop(e.point.x, -e.point.z)
    if (fall) sound.scream(fall.fall)
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
        <Buildings houses={data.houses} colourOf={colourOf} onPick={drop} />
        <primitive object={world.group} />
        <Simulation world={world} onEvents={onEvents} />
        <BadgeTracker world={world} badges={badges} />

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
