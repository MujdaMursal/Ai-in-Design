// The walking analysis: shortest walks along the network, the 25 m band around
// the streets reached, the buildings that touch it, and the residents inside it.
// All distances are in metres, in the local projection from geo.js.
import ClipperLib from 'clipper-lib'

export const SPEED = 80 // metres per minute, 4.8 km/h
export const MINUTES = [5, 10, 15]
export const BAND = 25 // metres on each side of a street
export const MAX_START = 100 // a walkable street must be this close to the click

// Clipper works on whole numbers, so shapes are handed to it in centimetres.
const SCALE = 100

// ---------- small geometry helpers ----------

export function distToSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

function segmentsCross(a, b, c, d) {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  const d1 = o(c, d, a)
  const d2 = o(c, d, b)
  const d3 = o(a, b, c)
  const d4 = o(a, b, d)
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0))
}

// Even-odd test over all rings, so courtyards (holes) count as outside.
function insideRings(x, y, rings) {
  let inside = false
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]
      const [xj, yj] = ring[j]
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
    }
  }
  return inside
}

// Shortest distance between a building footprint and a straight street piece; 0 if they overlap.
function distRingsToSegment(rings, a, b) {
  if (insideRings(a[0], a[1], rings) || insideRings(b[0], b[1], rings)) return 0
  let best = Infinity
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const p = ring[j]
      const q = ring[i]
      if (segmentsCross(p, q, a, b)) return 0
      best = Math.min(
        best,
        distToSegment(p[0], p[1], a, b),
        distToSegment(a[0], a[1], p, q),
        distToSegment(b[0], b[1], p, q),
      )
    }
  }
  return best
}

// ---------- the network ----------

export function buildNetwork(nodes, edges) {
  const adjacent = nodes.map(() => [])
  edges.forEach((e, i) => {
    adjacent[e.from].push({ to: e.to, length: e.length, edge: i })
    adjacent[e.to].push({ to: e.from, length: e.length, edge: i })
  })
  return { nodes, edges, adjacent }
}

// Where the walk starts: the nearest node, if a walkable street lies within MAX_START.
export function findStart(network, x, y) {
  let street = Infinity
  for (const e of network.edges) {
    for (let i = 1; i < e.line.length; i++) {
      street = Math.min(street, distToSegment(x, y, e.line[i - 1], e.line[i]))
    }
  }
  if (street > MAX_START) return { ok: false, street }

  return { ok: true, node: nearestNode(network, x, y), street }
}

// Dijkstra: walking distance in metres from the start node to every node,
// and for each node the node before it on the shortest walk.
function walkDistances(network, start) {
  const dist = new Float64Array(network.nodes.length).fill(Infinity)
  const previous = new Int32Array(network.nodes.length).fill(-1)
  dist[start] = 0
  const heap = [[0, start]]
  const push = (item) => {
    heap.push(item)
    let i = heap.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (heap[p][0] <= heap[i][0]) break
      ;[heap[p], heap[i]] = [heap[i], heap[p]]
      i = p
    }
  }
  const pop = () => {
    const top = heap[0]
    const last = heap.pop()
    if (heap.length) {
      heap[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r
        if (m === i) break
        ;[heap[m], heap[i]] = [heap[i], heap[m]]
        i = m
      }
    }
    return top
  }
  while (heap.length) {
    const [d, n] = pop()
    if (d > dist[n]) continue
    for (const { to, length } of network.adjacent[n]) {
      const nd = d + length
      if (nd < dist[to]) {
        dist[to] = nd
        previous[to] = n
        push([nd, to])
      }
    }
  }
  return { dist, previous }
}

// The shortest walk between two nodes: its points in metres and its length.
export function shortestRoute(network, from, to) {
  const { dist, previous } = walkDistances(network, from)
  const points = []
  for (let n = to; n !== -1; n = previous[n]) points.unshift(network.nodes[n])
  return { points, length: dist[to] }
}

// The node nearest to a point.
export function nearestNode(network, x, y) {
  let node = -1
  let best = Infinity
  network.nodes.forEach(([nx, ny], i) => {
    const d = Math.hypot(nx - x, ny - y)
    if (d < best) {
      best = d
      node = i
    }
  })
  return node
}

// The part of a line between fractions t0 and t1 of its drawn length.
function slice(line, t0, t1) {
  const lengths = [0]
  for (let i = 1; i < line.length; i++) {
    lengths.push(lengths[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]))
  }
  const total = lengths[lengths.length - 1]
  const at = (t) => {
    const s = t * total
    for (let i = 1; i < line.length; i++) {
      if (s <= lengths[i] || i === line.length - 1) {
        const k = lengths[i] > lengths[i - 1] ? (s - lengths[i - 1]) / (lengths[i] - lengths[i - 1]) : 0
        return [line[i - 1][0] + k * (line[i][0] - line[i - 1][0]), line[i - 1][1] + k * (line[i][1] - line[i - 1][1])]
      }
    }
  }
  const out = [at(t0)]
  for (let i = 1; i < line.length - 1; i++) {
    const t = lengths[i] / total
    if (t > t0 && t < t1) out.push(line[i])
  }
  out.push(at(t1))
  return out
}

// The street pieces reached within `limit` metres, including the reachable part of
// edges that are only partly walked. An edge can be entered from both ends.
function reachedPieces(network, dist, limit) {
  const pieces = []
  network.edges.forEach((e, i) => {
    const L = e.length
    const fromA = Math.max(0, Math.min(L, limit - dist[e.from]))
    const fromB = Math.max(0, Math.min(L, limit - dist[e.to]))
    if (fromA + fromB >= L) {
      pieces.push({ edge: i, line: e.line })
    } else {
      if (fromA > 0) pieces.push({ edge: i, line: slice(e.line, 0, fromA / L) })
      if (fromB > 0) pieces.push({ edge: i, line: slice(e.line, 1 - fromB / L, 1) })
    }
  })
  return pieces
}

// ---------- the band around the streets, as one joined shape ----------

const toClipper = (line) => line.map(([x, y]) => ({ X: Math.round(x * SCALE), Y: Math.round(y * SCALE) }))
const fromClipper = (path) => path.map((p) => [p.X / SCALE, p.Y / SCALE])

export function bandShape(pieces, width = BAND) {
  const offset = new ClipperLib.ClipperOffset(2, 0.25 * SCALE)
  for (const p of pieces) {
    offset.AddPath(toClipper(p.line), ClipperLib.JoinType.jtRound, ClipperLib.EndType.etOpenRound)
  }
  // Clipper joins all the overlapping bands into one shape while it widens them.
  const tree = new ClipperLib.PolyTree()
  offset.Execute(tree, width * SCALE)
  return { paths: ClipperLib.Clipper.PolyTreeToPaths(tree), polygons: polygonsFromTree(tree) }
}

// Polygons with their holes, in metres, for drawing.
function polygonsFromTree(tree) {
  const out = []
  const visit = (node) => {
    for (const child of node.Childs()) {
      // Each outer ring sits directly under the root or inside a hole.
      out.push({
        outer: fromClipper(child.Contour()),
        holes: child.Childs().map((h) => fromClipper(h.Contour())),
      })
      for (const hole of child.Childs()) visit(hole)
    }
  }
  visit(tree)
  return out
}

function overlapArea(paths, ring) {
  const c = new ClipperLib.Clipper()
  c.AddPaths(paths, ClipperLib.PolyType.ptSubject, true)
  c.AddPath(toClipper(ring), ClipperLib.PolyType.ptClip, true)
  const out = new ClipperLib.Paths()
  c.Execute(ClipperLib.ClipType.ctIntersection, out, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero)
  // Outer rings have positive area and holes negative, so the sum is the net area.
  return out.reduce((sum, p) => sum + ClipperLib.Clipper.Area(p), 0) / (SCALE * SCALE)
}

function ringArea(ring) {
  let a = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]
  return Math.abs(a) / 2
}

// ---------- the whole analysis for one start node ----------

export function analyse(network, start, houses, cells) {
  const { dist } = walkDistances(network, start)

  const areas = MINUTES.map((minutes) => {
    const pieces = reachedPieces(network, dist, minutes * SPEED)
    const { paths, polygons } = bandShape(pieces)
    return { minutes, pieces, paths, polygons }
  })

  // For each building: 0 if it touches no area, else 1, 2 or 3 for the smallest
  // area (5, 10, 15 min) it touches. A building touches an area when its footprint
  // comes within BAND metres of a street piece in that area.
  const level = new Uint8Array(houses.length)
  const grids = areas.map((area) =>
    gridIndex(area.pieces.flatMap((p) => p.line.slice(1).map((b, i) => ({ a: p.line[i], b })))),
  )
  houses.forEach((h, i) => {
    const [x0, y0, x1, y1] = h.bbox
    for (let k = 0; k < areas.length; k++) {
      const near = grids[k].near(x0 - BAND, y0 - BAND, x1 + BAND, y1 + BAND)
      if (near.some(({ a, b }) => distRingsToSegment(h.rings, a, b) <= BAND)) {
        level[i] = k + 1
        return
      }
    }
  })

  const results = areas.map((area, k) => {
    const buildings = level.reduce((n, l) => n + (l > 0 && l <= k + 1 ? 1 : 0), 0)
    let residents = 0
    let withoutFigure = 0
    const bounds = pathsBounds(area.paths)
    for (const cell of cells) {
      const [x0, y0, x1, y1] = cell.bbox
      if (x1 < bounds[0] || x0 > bounds[2] || y1 < bounds[1] || y0 > bounds[3]) continue
      const inside = overlapArea(area.paths, cell.ring)
      if (inside <= 0.01) continue
      if (cell.population == null) withoutFigure++
      else residents += (cell.population * inside) / ringArea(cell.ring)
    }
    return {
      minutes: area.minutes,
      buildings,
      residents: Math.round(residents / 10) * 10,
      withoutFigure,
      polygons: area.polygons,
    }
  })

  return { level, results }
}

function pathsBounds(paths) {
  let b = [Infinity, Infinity, -Infinity, -Infinity]
  for (const path of paths) {
    for (const { X, Y } of path) {
      b = [Math.min(b[0], X), Math.min(b[1], Y), Math.max(b[2], X), Math.max(b[3], Y)]
    }
  }
  return b.map((v) => v / SCALE)
}

// A coarse grid that finds the street pieces near a box quickly.
function gridIndex(segments, size = 50) {
  const cells = new Map()
  const key = (i, j) => `${i},${j}`
  for (const seg of segments) {
    const { a, b } = seg
    const i0 = Math.floor(Math.min(a[0], b[0]) / size)
    const i1 = Math.floor(Math.max(a[0], b[0]) / size)
    const j0 = Math.floor(Math.min(a[1], b[1]) / size)
    const j1 = Math.floor(Math.max(a[1], b[1]) / size)
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        if (!cells.has(key(i, j))) cells.set(key(i, j), [])
        cells.get(key(i, j)).push(seg)
      }
    }
  }
  return {
    near(x0, y0, x1, y1) {
      const found = new Set()
      for (let i = Math.floor(x0 / size); i <= Math.floor(x1 / size); i++) {
        for (let j = Math.floor(y0 / size); j <= Math.floor(y1 / size); j++) {
          for (const seg of cells.get(key(i, j)) ?? []) found.add(seg)
        }
      }
      return [...found]
    },
  }
}
