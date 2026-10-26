// Loading the city kit and turning longitude/latitude into metres.
// The kit is only about 1.3 × 2 km, so a flat local projection around its centre
// is accurate to well under a metre: x points east, y points north, both in metres.

const BASE = import.meta.env.BASE_URL

// Worded as in public/data/SOURCES.md.
export const ATTRIBUTION =
  'Buildings: 3D building models LoD2 © GDI-Th (dl-de/by-2-0). Land use and pedestrian network: Egor Gaydukov, InfAU, Bauhaus-Universität Weimar. Census grid: Zensus 2022, © Statistische Ämter des Bundes und der Länder (dl-de/by-2-0).'

async function load(name) {
  const r = await fetch(`${BASE}data/${name}`)
  if (!r.ok) throw new Error(`data/${name}: ${r.status}`)
  return r.json()
}

export async function loadKit() {
  const [kit, buildings, graph, zensus] = await Promise.all([
    load('kit.json'),
    load('buildings.geojson'),
    load('streets.graph.json'),
    load('zensus.geojson'),
  ])
  return prepare(kit, buildings, graph, zensus)
}

// Metres per degree at the kit's latitude.
function projection([lon0, lat0]) {
  const phi = (lat0 * Math.PI) / 180
  const mLat = 111132.954 - 559.822 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi)
  const mLon = 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi)
  return ([lon, lat]) => [(lon - lon0) * mLon, (lat - lat0) * mLat]
}

// Drop the closing point that GeoJSON repeats at the end of every ring.
function openRing(ring) {
  const a = ring[0]
  const b = ring[ring.length - 1]
  return a[0] === b[0] && a[1] === b[1] ? ring.slice(0, -1) : ring
}

function bboxOf(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of points) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return [minX, minY, maxX, maxY]
}

function prepare(kit, buildings, graph, zensus) {
  const project = projection(kit.center)

  const houses = buildings.features.map((f) => {
    const rings = f.geometry.coordinates.map((r) => openRing(r).map(project))
    return {
      id: f.properties.id,
      height: f.properties.height,
      use: f.properties.use ?? null,
      floors: f.properties.floors,
      floorArea: f.properties.floor_area_m2 ?? {}, // m² per use
      rings,
      bbox: bboxOf(rings[0]),
    }
  })

  const index = new Map(graph.nodes.map((n, i) => [n.id, i]))
  const nodes = graph.nodes.map((n) => project([n.lon, n.lat]))
  const edges = graph.edges
    .filter((e) => e.walkable)
    .map((e) => ({
      from: index.get(e.from),
      to: index.get(e.to),
      length: e.length,
      // The line drawn from `from` to `to`, in metres.
      line: e.coords.map(project),
    }))

  const cells = zensus.features.map((f) => {
    const ring = openRing(f.geometry.coordinates[0]).map(project)
    return {
      id: f.properties.id,
      population: f.properties.population,
      ring,
      bbox: bboxOf(ring),
    }
  })

  const [west, south, east, north] = kit.bbox
  const [x0, y0] = project([west, south])
  const [x1, y1] = project([east, north])

  return { kit, houses, nodes, edges, cells, extent: [x0, y0, x1, y1] }
}
