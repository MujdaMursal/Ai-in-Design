// A 3D map of the area between the Bauhaus-Universität main building and Weimar Hauptbahnhof:
// every building within CORRIDOR metres of the straight line between them, and the
// shortest walk from one to the other.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { Area, Buildings, Controls, GROUND, Streets, USE_COLOURS, USE_LABELS, useColour } from './City.jsx'
import Legend from './Legend.jsx'
import { ATTRIBUTION, loadKit } from './geo.js'
import { bandShape, buildNetwork, distToSegment, nearestNode, shortestRoute, SPEED } from './reach.js'

// The data has no building names; these ids were found by their location.
const LANDMARKS = [
  { id: '14780', name: 'Bauhaus-Universität', detail: 'main building, Geschwister-Scholl-Straße 8' },
  { id: '22132', name: 'Weimar Hauptbahnhof', detail: 'station building' },
]
const CORRIDOR = 250 // metres on each side of the straight line
const ACCENT = '#c2410c'
const ROUTE = '#2747b8'
const SELECTED = '#2b2b2b'

const number = (n) => Math.round(n).toLocaleString('en-GB')

function centre(house) {
  const ring = house.rings[0]
  return [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length]
}

function corridor(data) {
  const ends = LANDMARKS.map((l) => {
    const house = data.houses.find((h) => h.id === l.id)
    return { ...l, house, point: centre(house) }
  })
  const [a, b] = ends.map((e) => e.point)
  const near = ([x, y]) => distToSegment(x, y, a, b) <= CORRIDOR

  const houses = data.houses.filter((h) => h.rings[0].some(near))
  const edges = data.edges.filter((e) => e.line.some(near))
  const ground = bandShape([{ line: [a, b] }], CORRIDOR).polygons

  const network = buildNetwork(data.nodes, data.edges)
  const route = shortestRoute(network, nearestNode(network, ...a), nearestNode(network, ...b))
  const straight = Math.hypot(b[0] - a[0], b[1] - a[1])

  return { ends, houses, edges, ground, route, straight, summary: summarise(houses) }
}

const totalArea = (house) => Object.values(house.floorArea).reduce((s, v) => s + v, 0)

// Counts, floor areas and heights of the buildings in the area.
function summarise(houses) {
  const byUse = new Map()
  for (const h of houses) {
    const use = h.use ?? 'none'
    const row = byUse.get(use) ?? { use, buildings: 0, floorArea: 0 }
    row.buildings++
    row.floorArea += totalArea(h)
    byUse.set(use, row)
  }
  const heights = houses.map((h) => h.height).sort((p, q) => p - q)
  const middle = heights.length >> 1
  return {
    uses: [...byUse.values()].sort((p, q) => q.buildings - p.buildings),
    floorArea: houses.reduce((s, h) => s + totalArea(h), 0),
    lowest: heights[0],
    median: heights.length % 2 ? heights[middle] : (heights[middle - 1] + heights[middle]) / 2,
    tallest: houses.reduce((t, h) => (h.height > t.height ? h : t)),
  }
}

function Summary({ summary, count, onSelect }) {
  return (
    <section className="details">
      <h2>Buildings in this area</h2>
      <p>
        {number(count)} buildings with {number(summary.floorArea)} m² of floor area. Heights from{' '}
        {summary.lowest} m to {summary.tallest.height} m (
        <button className="link" onClick={() => onSelect(summary.tallest.id)}>
          show the tallest
        </button>
        ), {summary.median} m in the middle.
      </p>
      <table>
        <thead>
          <tr>
            <th>Main use</th>
            <th className="right">Buildings</th>
            <th className="right">Floor area</th>
          </tr>
        </thead>
        <tbody>
          {summary.uses.map((row) => (
            <tr key={row.use}>
              <td>
                <span className="swatch" style={{ background: USE_COLOURS[row.use] }} />
                {USE_LABELS[row.use]}
              </td>
              <td className="num right">{number(row.buildings)}</td>
              <td className="num right">{number(row.floorArea)} m²</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function BuildingCard({ house, onClose }) {
  const landmark = LANDMARKS.find((l) => l.id === house.id)
  const areas = Object.entries(house.floorArea).sort((p, q) => q[1] - p[1])
  return (
    <aside className="card">
      <button className="close" onClick={onClose} aria-label="Close">
        ×
      </button>
      <h2>{landmark ? landmark.name : USE_LABELS[house.use ?? 'none']}</h2>
      <p className="muted">
        Building {house.id}
        {landmark && ` · ${landmark.detail}`}
      </p>
      <table>
        <tbody>
          <tr>
            <td>Main use</td>
            <td className="right">{USE_LABELS[house.use ?? 'none']}</td>
          </tr>
          <tr>
            <td>Height</td>
            <td className="num right">{house.height} m</td>
          </tr>
          <tr>
            <td>Floors</td>
            <td className="num right">{house.floors ?? '–'}</td>
          </tr>
          <tr>
            <td>Floor area</td>
            <td className="num right">{number(totalArea(house))} m²</td>
          </tr>
          {areas.map(([use, m2]) => (
            <tr key={use} className="sub">
              <td>
                <span className="swatch" style={{ background: USE_COLOURS[use] ?? USE_COLOURS.undefined }} />
                {USE_LABELS[use] ?? use}
              </td>
              <td className="num right">{number(m2)} m²</td>
            </tr>
          ))}
        </tbody>
      </table>
    </aside>
  )
}

// The walking route as a line a few pixels wide, just above the ground.
function Route({ points, colour }) {
  const line = useMemo(() => {
    const geometry = new LineGeometry()
    geometry.setPositions(points.flatMap(([x, y]) => [x, 2, -y]))
    return new Line2(geometry, new LineMaterial({ color: colour, linewidth: 4 }))
  }, [points, colour])
  useEffect(
    () => () => {
      line.geometry.dispose()
      line.material.dispose()
    },
    [line],
  )
  return <primitive object={line} />
}

// Moves the HTML labels every frame so they float above their buildings.
function LabelTracker({ ends, labels }) {
  const v = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ camera, size }) => {
    ends.forEach((end, i) => {
      const el = labels.current[i]
      if (!el) return
      const [x, y] = end.point
      v.set(x, end.house.height + 25, -y).project(camera)
      el.style.display = v.z > 1 ? 'none' : '' // behind the camera
      el.style.transform = `translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px) translate(-50%, -100%)`
    })
  })
  return null
}

export default function Corridor() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    loadKit().then(setData).catch((e) => setError(e.message))
  }, [])

  const map = useMemo(() => data && corridor(data), [data])

  const [selectedId, setSelectedId] = useState(null)
  const labels = useRef([])

  const landmarkIds = useMemo(() => new Set(LANDMARKS.map((l) => l.id)), [])
  const colourOf = useCallback(
    (house) =>
      house.id === selectedId ? SELECTED : landmarkIds.has(house.id) ? ACCENT : useColour(house.use),
    [landmarkIds, selectedId],
  )

  if (error) return <p className="message error">The city kit didn't load ({error}).</p>
  if (!map) return <p className="message">Loading the city kit…</p>

  const selected = map.houses.find((h) => h.id === selectedId)
  // A click on the ground closes the card; a drag only moves the camera.
  const clearSelection = (e) => {
    if (e.delta <= 4) setSelectedId(null)
  }

  const [a, b] = map.ends.map((e) => e.point)
  const middle = [(a[0] + b[0]) / 2, 0, -(a[1] + b[1]) / 2]

  return (
    <div className="app">
      <Canvas
        // From the south-east: the Bauhaus in front, the station at the back.
        camera={{ position: [middle[0] + 550, 1500, middle[2] + 2050], fov: 40, near: 1, far: 20000 }}
        dpr={[1, 2]}
      >
        <color attach="background" args={['#e9e7e1']} />
        <ambientLight intensity={1.6} />
        <directionalLight position={[-600, 1200, 400]} intensity={1.6} />
        <directionalLight position={[800, 600, -600]} intensity={0.4} />

        <mesh rotation={[-Math.PI / 2, 0, 0]} onClick={clearSelection}>
          <planeGeometry args={[6000, 6000]} />
          <meshBasicMaterial color="#e2dfd7" />
        </mesh>
        <Area polygons={map.ground} colour={GROUND} lift={0.3} />

        <Streets edges={map.edges} />
        <Route points={map.route.points} colour={ROUTE} />
        <Buildings houses={map.houses} colourOf={colourOf} onSelect={(i) => setSelectedId(map.houses[i].id)} />
        <LabelTracker ends={map.ends} labels={labels} />

        <Controls target={middle} />
      </Canvas>

      {map.ends.map((end, i) => (
        <div key={end.id} className="label" ref={(el) => (labels.current[i] = el)}>
          <strong>{end.name}</strong>
          <span>{end.detail}</span>
        </div>
      ))}

      <aside className="panel">
        <h1>Bauhaus-Universität to Hauptbahnhof</h1>
        <a className="switch" href={import.meta.env.BASE_URL}>
          ← How far can you walk?
        </a>
        <p className="hint">Click a building for its details. Drag to orbit, right-drag to pan, scroll to zoom.</p>
        <table>
          <tbody>
            <tr>
              <td>
                <span className="swatch" style={{ background: ACCENT }} />
                As the crow flies
              </td>
              <td className="num">{number(map.straight)} m</td>
            </tr>
            <tr>
              <td>
                <span className="swatch" style={{ background: ROUTE }} />
                Shortest walk
              </td>
              <td className="num">
                {number(map.route.length)} m, about {Math.round(map.route.length / SPEED)} min
              </td>
            </tr>
          </tbody>
        </table>
        <Summary summary={map.summary} count={map.houses.length} onSelect={setSelectedId} />
        <div className="method">
          <p>
            The map shows every building within {CORRIDOR} m of the straight line between the two buildings in
            orange. The blue line is the shortest walk along the pedestrian network, from the junction nearest to
            one building to the junction nearest to the other, at {(SPEED * 60) / 1000} km/h.
          </p>
          <p>
            Height is measured from the ground to the highest point of the roof. Floor areas are estimates for the
            whole building, not surveyed floor by floor. A building's main use is the use with the most floor area.
          </p>
          <p>
            The city kit has no building names: the two buildings were picked by their location, and the kit ends
            just north of the station.
          </p>
        </div>
      </aside>

      {selected ? (
        <BuildingCard house={selected} onClose={() => setSelectedId(null)} />
      ) : (
        <Legend houses={map.houses} />
      )}
      <footer className="attribution">{ATTRIBUTION}</footer>
    </div>
  )
}
