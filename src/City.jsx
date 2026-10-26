// The 3D city: ground, streets, the three walking areas and the buildings.
// Three.js has y pointing up, so a point (x east, y north) in metres sits at (x, 0, -y).
import { useCallback, useEffect, useMemo } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

// Orbit, pan and zoom with the mouse, around `target`, without going below the ground.
export function Controls({ target = [0, 0, 0] }) {
  const camera = useThree((s) => s.camera)
  const canvas = useThree((s) => s.gl.domElement)
  const invalidate = useThree((s) => s.invalidate)
  const [tx, ty, tz] = target
  useEffect(() => {
    const controls = new OrbitControls(camera, canvas)
    controls.target.set(tx, ty, tz)
    controls.maxPolarAngle = Math.PI / 2.1
    controls.minDistance = 60
    controls.maxDistance = 6000
    controls.update()
    controls.addEventListener('change', invalidate)
    return () => {
      controls.removeEventListener('change', invalidate)
      controls.dispose()
    }
  }, [camera, canvas, invalidate, tx, ty, tz])
  return null
}

// A quiet palette for the main use of each building.
export const USE_COLOURS = {
  residential: '#e4d8c3',
  undefined: '#d3d1cb',
  service: '#c3cbb0',
  office: '#b9b39c',
  retail: '#dfb59c',
  food_and_drink: '#d39a86',
  accommodation: '#cfa9b3',
  entertainment: '#bfa0b9',
  culture: '#a8907f',
  education: '#d6c283',
  civic: '#a3a68a',
  health: '#a0bea8',
  sport: '#8fae86',
  transport: '#8d8b85',
  light_industrial: '#9c8670',
  none: '#f3f1ec',
}

export const USE_LABELS = {
  residential: 'Residential',
  undefined: 'Use not known',
  service: 'Service',
  office: 'Office',
  retail: 'Retail',
  food_and_drink: 'Food and drink',
  accommodation: 'Accommodation',
  entertainment: 'Entertainment',
  culture: 'Culture',
  education: 'Education',
  civic: 'Civic',
  health: 'Health',
  sport: 'Sport',
  transport: 'Transport',
  light_industrial: 'Light industrial',
  none: 'No use given',
}

// One accent colour in three shades: darkest for 5 minutes, lightest for 15.
export const REACH_COLOURS = ['#2747b8', '#6a88e0', '#b3c5f2']

export const GROUND = '#f1efe9'
const STREET = '#8f8b82'

export const useColour = (use) => USE_COLOURS[use ?? 'none'] ?? USE_COLOURS.undefined

// All buildings in one mesh: walls and a flat roof at `height`.
// Each building's vertices are kept together so its colour can be changed later.
function buildingGeometry(houses) {
  const positions = []
  const ranges = []
  const vertex = ([x, y], h) => positions.push(x, h, -y)

  // Add a triangle, flipping it if needed so its face points along `normal`.
  const triangle = (a, b, c, normal) => {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    const n = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]]
    const order = n[0] * normal[0] + n[1] * normal[1] + n[2] * normal[2] >= 0 ? [a, b, c] : [a, c, b]
    for (const p of order) positions.push(...p)
  }
  const p3 = ([x, y], h) => [x, h, -y]

  for (const house of houses) {
    const start = positions.length / 3
    const h = Math.max(house.height, 0.5)
    const [outer, ...holes] = house.rings.map((ring) =>
      ring.map(([x, y]) => new THREE.Vector2(x, y)),
    )
    // Outer ring anticlockwise and holes clockwise, so "outward" is always to the right.
    if (THREE.ShapeUtils.isClockWise(outer)) outer.reverse()
    for (const hole of holes) if (!THREE.ShapeUtils.isClockWise(hole)) hole.reverse()

    // Roof
    const flat = [...outer, ...holes.flat()]
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(outer, holes)) {
      triangle(p3([flat[a].x, flat[a].y], h), p3([flat[b].x, flat[b].y], h), p3([flat[c].x, flat[c].y], h), [0, 1, 0])
    }
    // Walls
    for (const ring of [outer, ...holes]) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]
        const b = ring[(i + 1) % ring.length]
        const out = [b.y - a.y, 0, b.x - a.x] // the right-hand side, turned into Three.js axes
        const a0 = p3([a.x, a.y], 0), b0 = p3([b.x, b.y], 0)
        const a1 = p3([a.x, a.y], h), b1 = p3([b.x, b.y], h)
        triangle(a0, b0, b1, out)
        triangle(a0, b1, a1, out)
      }
    }
    ranges.push([start, positions.length / 3])
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(positions.length), 3))
  geometry.computeVertexNormals()
  return { geometry, ranges }
}

// Which building a clicked triangle belongs to, by its first vertex.
function buildingAt(ranges, faceIndex) {
  const v = faceIndex * 3
  let lo = 0
  let hi = ranges.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (ranges[mid][0] <= v) lo = mid
    else hi = mid - 1
  }
  return lo
}

// `colourOf(house, i)` gives each building its colour.
// `onSelect(i)`, if given, is told which building was clicked (not dragged).
export function Buildings({ houses, colourOf, onPick, onSelect }) {
  const { geometry, ranges } = useMemo(() => buildingGeometry(houses), [houses])

  useEffect(() => {
    const colours = geometry.attributes.color
    const c = new THREE.Color()
    houses.forEach((house, i) => {
      c.set(colourOf(house, i))
      for (let v = ranges[i][0]; v < ranges[i][1]; v++) colours.setXYZ(v, c.r, c.g, c.b)
    })
    colours.needsUpdate = true
  }, [geometry, ranges, houses, colourOf])

  useEffect(() => () => geometry.dispose(), [geometry])

  const select = (e) => {
    e.stopPropagation()
    if (e.delta > 4) return
    onSelect(buildingAt(ranges, e.faceIndex))
  }

  return (
    <mesh geometry={geometry} onClick={onSelect ? select : onPick}>
      <meshLambertMaterial vertexColors side={THREE.DoubleSide} />
    </mesh>
  )
}

export function Streets({ edges }) {
  const geometry = useMemo(() => {
    const points = []
    for (const e of edges) {
      for (let i = 1; i < e.line.length; i++) {
        const [ax, ay] = e.line[i - 1]
        const [bx, by] = e.line[i]
        points.push(ax, 0, -ay, bx, 0, -by)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
    return g
  }, [edges])
  return (
    <lineSegments geometry={geometry} position={[0, 1.2, 0]} renderOrder={5}>
      <lineBasicMaterial color={STREET} />
    </lineSegments>
  )
}

// One walking area: flat shapes with holes, lying just above the ground.
export function Area({ polygons, colour, lift }) {
  const geometry = useMemo(() => {
    const shapes = polygons.map(({ outer, holes }) => {
      const shape = new THREE.Shape(outer.map(([x, y]) => new THREE.Vector2(x, y)))
      shape.holes = holes.map((h) => new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))))
      return shape
    })
    const g = new THREE.ShapeGeometry(shapes)
    g.rotateX(-Math.PI / 2)
    return g
  }, [polygons])
  useEffect(() => () => geometry.dispose(), [geometry])
  return (
    <mesh geometry={geometry} position={[0, lift, 0]} renderOrder={lift}>
      <meshBasicMaterial color={colour} polygonOffset polygonOffsetFactor={-lift} polygonOffsetUnits={-lift} />
    </mesh>
  )
}

function Marker({ point }) {
  if (!point) return null
  const [x, y] = point
  return (
    <mesh position={[x, 6, -y]}>
      <sphereGeometry args={[6, 24, 16]} />
      <meshLambertMaterial color="#c2410c" />
    </mesh>
  )
}

export default function City({ data, level, results, start, onPick, busy }) {
  const [x0, y0, x1, y1] = data.extent
  // Colour by use, or by the shade of the smallest walking area the building touches.
  const colourOf = useCallback(
    (house, i) => (level?.[i] ? REACH_COLOURS[level[i] - 1] : useColour(house.use)),
    [level],
  )
  const size = Math.max(x1 - x0, y1 - y0) * 3

  // A click is a click only if the mouse didn't move much; otherwise it was a drag.
  const pick = (e) => {
    e.stopPropagation()
    if (e.delta > 4 || busy) return
    onPick(e.point.x, -e.point.z)
  }

  return (
    <Canvas camera={{ position: [700, 1100, 1500], fov: 40, near: 1, far: 20000 }} dpr={[1, 2]}>
      <color attach="background" args={['#e9e7e1']} />
      <ambientLight intensity={1.6} />
      <directionalLight position={[-600, 1200, 400]} intensity={1.6} />
      <directionalLight position={[800, 600, -600]} intensity={0.4} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} onClick={pick}>
        <planeGeometry args={[size, size]} />
        <meshBasicMaterial color={GROUND} />
      </mesh>

      {results &&
        [...results].reverse().map((r) => {
          const k = results.indexOf(r)
          return <Area key={r.minutes} polygons={r.polygons} colour={REACH_COLOURS[k]} lift={0.3 + 0.3 * (2 - k)} />
        })}

      <Streets edges={data.edges} />
      <Buildings houses={data.houses} colourOf={colourOf} onPick={pick} />
      <Marker point={start} />

      <Controls />
    </Canvas>
  )
}
