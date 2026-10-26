// The flood game: water level, fish, sharks, boats, the kraken and the people you drop.
// Everything here is plain three.js; the page in Flood.jsx draws it, runs update() every frame
// and turns the events it reports (drops, splashes, meals, level-ups) into sounds and messages.
// Distances are in metres in the local projection from geo.js (x east, y north);
// in three.js a point (x, y) at height h sits at (x, h, -y).
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { insideRings } from './reach.js'

const CELL = 3 // metres per square of the roof-height map
const GRAVITY = 30 // m/s², stronger than real so a drop doesn't take forever
const DROP_HEIGHT = 60 // people fall from this many metres above the water or roof
const SIGHT = 300 // fish and boats notice a person in the water this far away
const PERSON = 5 // people are drawn 5× life size so you can see them from above
const GROWTH = 1.18 // each level makes a fish 18% longer

// Sizes are game sizes in metres, much larger than life so they show on a city map.
// `from`: the water level in metres at which they start to appear.
// `maxLevel`: how far a fish can grow by eating.
export const SPECIES = [
  { key: 'minnow', name: 'Small fish', kind: 'fish', from: 0.5, size: 4, speed: 8, max: 40, colour: '#f2994a', maxLevel: 6 },
  { key: 'carp', name: 'Carp', kind: 'fish', from: 2, size: 7, speed: 7, max: 30, colour: '#d4a72c', maxLevel: 6 },
  { key: 'pike', name: 'Pike', kind: 'fish', from: 4, size: 10, speed: 11, max: 20, colour: '#6f8f3a', maxLevel: 6 },
  { key: 'shark', name: 'Shark', kind: 'shark', from: 6, size: 16, speed: 13, max: 14, colour: '#8394a1', maxLevel: 6 },
  { key: 'greatWhite', name: 'Great white', kind: 'shark', from: 12, size: 26, speed: 15, max: 8, colour: '#56636f', maxLevel: 6 },
  { key: 'whale', name: 'Whale', kind: 'whale', from: 20, size: 45, speed: 9, max: 4, colour: '#35577a', maxLevel: 6 },
  { key: 'kraken', name: 'Kraken', kind: 'kraken', from: 36, size: 70, speed: 7, max: 1, colour: '#5c0f24', maxLevel: 8 },
  { key: 'dinghy', name: 'Rubber dinghy', kind: 'dinghy', boat: true, from: 0.5, size: 6, speed: 6, max: 10, colour: '#f2c94c' },
  { key: 'rowboat', name: 'Rowing boat', kind: 'rowboat', boat: true, from: 2, size: 9, speed: 5, max: 10, colour: '#9a6634' },
  { key: 'sailboat', name: 'Sailing boat', kind: 'sailboat', boat: true, from: 6, size: 16, speed: 9, max: 8, colour: '#ffffff' },
  { key: 'ferry', name: 'Ferry', kind: 'ferry', boat: true, from: 12, size: 38, speed: 8, max: 4, colour: '#ffffff' },
  { key: 'cruise', name: 'Cruise ship', kind: 'cruise', boat: true, from: 20, size: 95, speed: 6, max: 2, colour: '#ffffff' },
]

// The kraken hunts boats from this level on, and only boats up to this share of its own length.
export const KRAKEN_HUNTS_FROM = 2
const KRAKEN_BITE = 0.5

// Meals a fish needs to go from `level` to the next one: 1, then 2, then 3…
export const mealsToNext = (level) => level

// How many of a species swim at this water level: more as the water rises.
function wanted(sp, level) {
  if (level < sp.from) return 0
  return Math.min(sp.max, Math.ceil((sp.max * (level - sp.from + 1)) / 12))
}

// How deep the water must be for it: fish need room to swim, boats only their draught.
// The kraken swims high, with its head out of the water, so it needs less depth than its size.
function depthNeeded(sp, scale = 1) {
  if (sp.boat) return sp.size * 0.06
  if (sp.kind === 'kraken') return Math.min(sp.size * scale * 0.12, 20)
  return sp.size * scale * 0.2
}

// ---------- cartoon models, 1 m long along +x, coloured per part ----------

function part(geometry, colour) {
  const c = new THREE.Color(colour)
  const n = geometry.attributes.position.count
  const colours = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) colours.set([c.r, c.g, c.b], i * 3)
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3))
  return geometry
}

const box = (w, h, d, x, y, z, colour) => part(new THREE.BoxGeometry(w, h, d).translate(x, y, z), colour)
const eye = (x, y, z) => part(new THREE.SphereGeometry(0.035, 8, 6).translate(x, y, z), '#111111')

function model(sp) {
  const c = sp.colour
  const parts = []
  if (sp.kind === 'fish' || sp.kind === 'shark' || sp.kind === 'whale') {
    const tall = sp.kind === 'whale' ? 0.5 : 0.45
    const wide = sp.kind === 'fish' ? 0.3 : 0.4
    parts.push(part(new THREE.SphereGeometry(0.5, 14, 10).scale(1, tall, wide), c))
    // Tail fin: a cone with its tip at the body, flattened upright (fish) or flat (whale).
    const tail = new THREE.ConeGeometry(0.22, 0.32, 8).rotateZ(-Math.PI / 2).translate(-0.6, 0, 0)
    parts.push(part(sp.kind === 'whale' ? tail.scale(1, 0.25, 1.4) : tail.scale(1, 1, 0.2), c))
    parts.push(eye(0.36, 0.07, wide * 0.42), eye(0.36, 0.07, -wide * 0.42))
    if (sp.kind === 'shark') {
      parts.push(part(new THREE.ConeGeometry(0.12, 0.3, 6).scale(1, 1, 0.25).translate(0.02, 0.32, 0), c))
      parts.push(box(0.12, 0.02, 0.02, 0.38, -0.08, 0, '#ffffff')) // teeth
    }
    if (sp.kind === 'fish') parts.push(box(0.12, 0.06, 0.32, 0, -0.02, 0, '#ffffff'))
  } else if (sp.kind === 'dinghy') {
    parts.push(part(new THREE.CapsuleGeometry(0.22, 0.55, 4, 10).rotateZ(Math.PI / 2).scale(1, 0.5, 1), c))
  } else if (sp.kind === 'rowboat') {
    parts.push(box(1, 0.18, 0.36, 0, 0.04, 0, c), box(0.06, 0.04, 0.34, 0, 0.14, 0, '#5b3a1c'))
    parts.push(box(0.8, 0.02, 0.02, 0, 0.14, 0.24, '#5b3a1c'), box(0.8, 0.02, 0.02, 0, 0.14, -0.24, '#5b3a1c'))
  } else if (sp.kind === 'sailboat') {
    parts.push(box(1, 0.14, 0.3, 0, 0.04, 0, c), box(1.02, 0.03, 0.31, 0, -0.02, 0, '#2747b8'))
    parts.push(part(new THREE.CylinderGeometry(0.012, 0.012, 0.9, 6).translate(0.05, 0.55, 0), '#5b3a1c'))
    const sail = new THREE.Shape([new THREE.Vector2(0.07, 0.15), new THREE.Vector2(0.07, 0.95), new THREE.Vector2(-0.4, 0.15)])
    parts.push(part(new THREE.ShapeGeometry(sail), '#f6f1e3'))
  } else if (sp.kind === 'ferry') {
    parts.push(box(1, 0.12, 0.26, 0, 0.02, 0, c), box(1.01, 0.03, 0.27, 0, -0.03, 0, '#c0392b'))
    parts.push(box(0.55, 0.1, 0.2, -0.05, 0.13, 0, '#e9eef2'), box(0.08, 0.1, 0.06, -0.15, 0.23, 0, '#f2c94c'))
  } else if (sp.kind === 'cruise') {
    parts.push(box(1, 0.08, 0.16, 0, -0.01, 0, '#1f3a5f'), box(0.96, 0.06, 0.15, 0, 0.06, 0, c))
    parts.push(box(0.8, 0.05, 0.13, -0.04, 0.115, 0, c), box(0.6, 0.05, 0.11, -0.06, 0.165, 0, c))
    parts.push(box(0.05, 0.08, 0.05, -0.12, 0.23, 0, '#c0392b'), box(0.05, 0.08, 0.05, 0.05, 0.23, 0, '#c0392b'))
  }
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)))
}

// The kraken: its own model with moving parts, about 1 m across, facing +x.
function makeKraken() {
  const group = new THREE.Group()
  const skin = new THREE.MeshLambertMaterial({ color: '#4a0d1f' })
  const dark = new THREE.MeshLambertMaterial({ color: '#22050d' })
  const pale = new THREE.MeshLambertMaterial({ color: '#d79a9a' })
  const bone = new THREE.MeshLambertMaterial({ color: '#f3ead2' })
  const glow = new THREE.MeshBasicMaterial({ color: '#ffd400' }) // eyes light up, unaffected by shade
  const black = new THREE.MeshBasicMaterial({ color: '#000000' })
  const throat = new THREE.MeshBasicMaterial({ color: '#6e0010', side: THREE.DoubleSide })
  const add = (geometry, material, x, y, z) => {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(x, y, z)
    group.add(mesh)
    return mesh
  }

  // A tall mantle leaning back, with spikes down its ridge.
  const mantle = add(new THREE.SphereGeometry(0.22, 20, 16).scale(1, 1.7, 1), skin, -0.1, 0.45, 0)
  mantle.rotation.z = 0.4
  for (let k = 0; k < 6; k++) {
    const spike = add(new THREE.ConeGeometry(0.028, 0.11, 6), dark, -0.12 - k * 0.045, 0.62 - k * 0.07, 0)
    spike.rotation.z = 0.9 + k * 0.12
  }
  // Head, glowing slit eyes and angry brows.
  add(new THREE.SphereGeometry(0.2, 20, 16).scale(1, 0.85, 1.15), skin, 0.08, 0.22, 0)
  const eyes = []
  for (const side of [1, -1]) {
    eyes.push(add(new THREE.SphereGeometry(0.058, 14, 10), glow, 0.21, 0.28, side * 0.11))
    add(new THREE.BoxGeometry(0.02, 0.08, 0.016), black, 0.265, 0.28, side * 0.11)
    const brow = add(new THREE.BoxGeometry(0.05, 0.03, 0.14), dark, 0.23, 0.35, side * 0.11)
    brow.rotation.x = side * 0.5 // inner ends down: a frown
  }
  // An open mouth ringed with teeth.
  const maw = add(new THREE.CircleGeometry(0.1, 24).rotateY(Math.PI / 2).scale(1, 0.75, 1), throat, 0.255, 0.12, 0)
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2
    const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.05, 5), bone)
    tooth.position.set(0.004, Math.sin(a) * 0.075, Math.cos(a) * 0.09)
    tooth.rotation.x = -a + Math.PI / 2 // points to the middle of the mouth
    maw.add(tooth)
  }
  // Eight tentacles, each a chain of joints so they can curl, with suckers and spiked tips.
  const tentacles = []
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    const root = new THREE.Group()
    root.position.set(0.04 + Math.cos(a) * 0.14, 0.06, Math.sin(a) * 0.14)
    root.rotation.y = -a
    group.add(root)
    const joints = []
    let parent = root
    for (let j = 0; j < 7; j++) {
      const joint = new THREE.Group()
      joint.position.x = j === 0 ? 0 : 0.09
      const r = 0.05 * (1 - j / 8)
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r, 0.1, 8).rotateZ(-Math.PI / 2).translate(0.045, 0, 0), skin)
      const sucker = new THREE.Mesh(new THREE.SphereGeometry(r * 0.45, 6, 4), pale)
      sucker.position.set(0.045, -r * 0.8, 0)
      joint.add(seg, sucker)
      if (j === 6) {
        const tip = new THREE.Mesh(new THREE.ConeGeometry(r * 0.7, 0.08, 6).rotateZ(-Math.PI / 2).translate(0.12, 0, 0), bone)
        joint.add(tip)
      }
      parent.add(joint)
      joints.push(joint)
      parent = joint
    }
    tentacles.push(joints)
  }
  group.visible = false
  return { group, tentacles, eyes, glow, maw }
}

// ---------- the world ----------

let nextId = 1

export class FloodWorld {
  constructor(data) {
    this.extent = data.extent
    this.level = 0
    this.group = new THREE.Group()
    this.agents = [] // fish, boats and the kraken
    this.people = []
    this.splashes = []
    this.events = []
    this.score = { fed: 0, rescued: 0, boatsEaten: 0 }
    this.buildHeights(data.houses)

    const material = new THREE.MeshLambertMaterial({ vertexColors: true })
    this.meshes = new Map(
      SPECIES.filter((sp) => sp.kind !== 'kraken').map((sp) => {
        const mesh = new THREE.InstancedMesh(model(sp), material, sp.max)
        mesh.count = 0
        mesh.frustumCulled = false
        this.group.add(mesh)
        return [sp.key, mesh]
      }),
    )
    this.kraken = makeKraken()
    this.group.add(this.kraken.group)

    this.personBody = new THREE.CapsuleGeometry(0.22 * PERSON, 0.8 * PERSON, 4, 8)
    this.personHead = new THREE.SphereGeometry(0.17 * PERSON, 10, 8)
    this.skin = new THREE.MeshLambertMaterial({ color: '#f1c9a5' })
    this.shirts = ['#e74c3c', '#3498db', '#2ecc71', '#9b59b6', '#f39c12', '#1abc9c'].map(
      (c) => new THREE.MeshLambertMaterial({ color: c }),
    )
    this.splashGeometry = new THREE.RingGeometry(0.8, 1, 32).rotateX(-Math.PI / 2)
  }

  // The height of the highest roof in every 3 m square; 0 where there is no building.
  buildHeights(houses) {
    const [x0, y0, x1, y1] = this.extent
    this.nx = Math.ceil((x1 - x0) / CELL)
    this.ny = Math.ceil((y1 - y0) / CELL)
    this.heights = new Float32Array(this.nx * this.ny)
    for (const h of houses) {
      const [bx0, by0, bx1, by1] = h.bbox
      for (let i = Math.max(0, Math.floor((bx0 - x0) / CELL)); i <= Math.min(this.nx - 1, Math.floor((bx1 - x0) / CELL)); i++) {
        for (let j = Math.max(0, Math.floor((by0 - y0) / CELL)); j <= Math.min(this.ny - 1, Math.floor((by1 - y0) / CELL)); j++) {
          const cx = x0 + (i + 0.5) * CELL
          const cy = y0 + (j + 0.5) * CELL
          const k = j * this.nx + i
          if (h.height > this.heights[k] && insideRings(cx, cy, h.rings)) this.heights[k] = h.height
        }
      }
    }
  }

  // Roof or ground height at a point; Infinity outside the kit, so nothing swims out of it.
  groundAt(x, y) {
    const i = Math.floor((x - this.extent[0]) / CELL)
    const j = Math.floor((y - this.extent[1]) / CELL)
    if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) return Infinity
    return this.heights[j * this.nx + i]
  }

  deepEnough(x, y, need) {
    return this.level - this.groundAt(x, y) >= need
  }

  setLevel(level) {
    this.level = level
  }

  emit(event) {
    this.events.push(event)
  }

  // The events since the last call, for sounds and messages.
  takeEvents() {
    const events = this.events
    this.events = []
    return events
  }

  // ---------- fish, boats and the kraken ----------

  spawn(sp) {
    const [x0, y0, x1, y1] = this.extent
    for (let tries = 0; tries < 60; tries++) {
      const x = x0 + Math.random() * (x1 - x0)
      const y = y0 + Math.random() * (y1 - y0)
      if (!this.deepEnough(x, y, depthNeeded(sp))) continue
      const ground = this.groundAt(x, y)
      this.agents.push({
        id: nextId++, sp, x, y, z: ground + (this.level - ground) / 2,
        heading: Math.random() * Math.PI * 2, phase: Math.random() * 10, stuck: 0, target: null,
        level: 1, meals: 0, scale: 1, fleeing: false,
      })
      if (sp.kind === 'kraken') this.emit({ type: 'kraken' })
      return
    }
  }

  population() {
    for (const sp of SPECIES) {
      const mine = this.agents.filter((a) => a.sp === sp)
      const goal = wanted(sp, this.level)
      // Add one at a time, so they appear gradually.
      if (mine.length < goal) this.spawn(sp)
      for (let k = goal; k < mine.length; k++) mine[k].gone = true
    }
    // Remove those told to go, those eaten and those left without enough water.
    this.agents = this.agents.filter((a) => !a.gone && this.deepEnough(a.x, a.y, depthNeeded(a.sp, a.scale) * 0.5))
  }

  krakenAgent() {
    return this.agents.find((a) => a.sp.kind === 'kraken')
  }

  // Can this kraken eat this boat? Only once it has grown, and only boats up to half its length.
  canEat(kraken, boat) {
    return kraken.level >= KRAKEN_HUNTS_FROM && boat.sp.size <= kraken.sp.size * kraken.scale * KRAKEN_BITE
  }

  // One meal: count it towards the next level, grow on a level-up.
  feed(a, meals = 1) {
    if (a.level >= a.sp.maxLevel) return
    a.meals += meals
    while (a.level < a.sp.maxLevel && a.meals >= mealsToNext(a.level)) {
      a.meals -= mealsToNext(a.level)
      a.level++
      a.scale = GROWTH ** (a.level - 1)
      this.emit({ type: 'levelup', name: a.sp.name, level: a.level, kraken: a.sp.kind === 'kraken', max: a.level === a.sp.maxLevel })
    }
    if (a.level >= a.sp.maxLevel) a.meals = 0
  }

  turnTowards(a, angle, rate, dt) {
    let turn = angle - a.heading
    turn = Math.atan2(Math.sin(turn), Math.cos(turn))
    a.heading += Math.max(-rate * dt, Math.min(rate * dt, turn))
  }

  move(a, dt, t, kraken) {
    const { sp } = a
    const isKraken = sp.kind === 'kraken'
    const size = sp.size * a.scale
    const need = depthNeeded(sp, a.scale)

    // Boats run from a kraken that is big enough to eat them.
    let flee = false
    if (sp.boat && kraken && this.canEat(kraken, a)) {
      const ks = kraken.sp.size * kraken.scale
      flee = Math.hypot(kraken.x - a.x, kraken.y - a.y) < 150 + ks * 1.2
    }
    if (flee && !a.fleeing) this.emit({ type: 'flee', name: sp.name, big: sp.size >= 16 })
    a.fleeing = flee

    // Targets: people in the water, and for a grown kraken, boats too.
    if (a.target && (a.target.state === 'gone' || a.target.gone || (a.target.state && a.target.state !== 'water'))) a.target = null
    if (flee) a.target = null
    else if (!a.target) {
      let best = SIGHT
      for (const p of this.people) {
        if (p.state !== 'water') continue
        const d = Math.hypot(p.x - a.x, p.y - a.y)
        if (d < best) {
          best = d
          a.target = p
        }
      }
      if (!a.target && isKraken && a.level >= KRAKEN_HUNTS_FROM) {
        best = SIGHT * 1.5
        for (const b of this.agents) {
          if (!b.sp.boat || !this.canEat(a, b)) continue
          const d = Math.hypot(b.x - a.x, b.y - a.y)
          if (d < best) {
            best = d
            a.target = b
          }
        }
      }
    }

    if (flee) this.turnTowards(a, Math.atan2(a.y - kraken.y, a.x - kraken.x), 4, dt)
    else if (a.target) this.turnTowards(a, Math.atan2(a.target.y - a.y, a.target.x - a.x), 3, dt)
    else a.heading += (Math.random() - 0.5) * 2 * dt

    // The kraken speeds up as it grows; anything chasing or fleeing goes faster.
    let speed = sp.speed * (isKraken ? 0.8 + 0.25 * a.scale : 1)
    if (flee) speed *= 1.6
    else if (a.target) speed *= 1.7
    const dx = Math.cos(a.heading)
    const dy = Math.sin(a.heading)
    const nx = a.x + dx * speed * dt
    const ny = a.y + dy * speed * dt
    // Look ahead so noses don't poke into houses; the kraken reaches over roofs with its arms.
    const ahead = isKraken ? 0.15 : 0.5
    if (this.deepEnough(nx + dx * size * ahead, ny + dy * size * ahead, need) && this.deepEnough(nx, ny, need)) {
      a.x = nx
      a.y = ny
      a.stuck = 0
    } else {
      a.heading += (Math.random() < 0.5 ? 1 : -1) * (0.8 + Math.random() * 1.5)
      a.stuck += dt
      if (a.stuck > 4) a.gone = true // trapped: a new one appears elsewhere
    }

    // Height: boats float, sharks show their fin, the kraken rears its head, fish swim halfway down.
    const ground = this.groundAt(a.x, a.y)
    let z
    if (sp.boat) z = this.level + Math.sin(t * 2 + a.phase) * 0.15
    else if (sp.kind === 'shark') z = this.level - size * 0.13
    else if (sp.kind === 'whale') z = this.level - size * 0.12
    else if (isKraken) z = this.level - size * 0.12 + Math.sin(t * 1.3) * size * 0.04
    else z = ground + (this.level - ground) * 0.5
    if (!isKraken) z = Math.max(z, Math.min(ground, this.level) + size * 0.12)
    a.z += (z - a.z) * Math.min(1, dt * 2)

    // Caught it?
    const target = a.target
    if (target && Math.hypot(target.x - a.x, target.y - a.y) < size * 0.5 + (target.sp ? target.sp.size * 0.3 : 3)) {
      a.target = null
      if (target.sp) {
        // The kraken eats a boat.
        target.gone = true
        this.splash(target.x, target.y, target.sp.size)
        this.score.boatsEaten++
        this.emit({ type: 'boatEaten', name: target.sp.name })
        this.feed(a, 2)
      } else {
        this.remove(target)
        this.splash(target.x, target.y, sp.boat ? 6 : 12)
        if (sp.boat) {
          this.score.rescued++
          this.emit({ type: 'rescued' })
        } else {
          this.score.fed++
          this.emit({ type: 'eaten', kraken: isKraken })
          this.feed(a)
        }
      }
    }
  }

  // ---------- people ----------

  // Drops a person and returns how long the fall takes, in seconds, and where it ends.
  drop(x, y) {
    const ground = this.groundAt(x, y)
    if (ground === Infinity) return null
    const group = new THREE.Group()
    const shirt = this.shirts[Math.floor(Math.random() * this.shirts.length)]
    const body = new THREE.Mesh(this.personBody, shirt)
    body.position.y = 0.62 * PERSON
    const head = new THREE.Mesh(this.personHead, this.skin)
    head.position.y = 1.35 * PERSON
    group.add(body, head)
    const top = Math.max(this.level, ground)
    const person = { x, y, z: top + DROP_HEIGHT, vz: 0, state: 'falling', group, phase: Math.random() * 10 }
    group.position.set(x, person.z, -y)
    this.group.add(group)
    this.people.push(person)
    // Keep the scene light: the oldest people leave first.
    if (this.people.length > 150) this.remove(this.people[0])
    return { fall: Math.sqrt((2 * DROP_HEIGHT) / GRAVITY), water: this.level > ground + 0.3 }
  }

  remove(person) {
    person.state = 'gone'
    this.group.remove(person.group)
    this.people = this.people.filter((p) => p !== person)
  }

  movePerson(p, dt, t) {
    const ground = this.groundAt(p.x, p.y)
    const flooded = this.level > ground + 0.3
    if (p.state === 'falling') {
      p.vz += GRAVITY * dt
      p.z -= p.vz * dt
      // Arms up, spinning: a cartoon fall.
      p.group.rotation.y += dt * 6
      const surface = flooded ? this.level : ground
      if (p.z <= surface) {
        p.z = surface
        p.state = flooded ? 'water' : 'standing'
        p.group.rotation.y = 0
        if (flooded) {
          this.splash(p.x, p.y, 8)
          this.emit({ type: 'splash' })
        } else this.emit({ type: 'land' })
      }
    } else if (p.state === 'water') {
      if (!flooded) p.state = 'standing'
      // Head above the water, bobbing.
      p.z = this.level - 0.9 * PERSON + Math.sin(t * 3 + p.phase) * 0.3
    } else if (p.state === 'standing') {
      if (flooded) p.state = 'water'
      p.z = ground
    }
    p.group.position.set(p.x, p.z, -p.y)
  }

  splash(x, y, size) {
    const mesh = new THREE.Mesh(
      this.splashGeometry,
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false }),
    )
    mesh.position.set(x, this.level + 0.3, -y)
    this.group.add(mesh)
    this.splashes.push({ mesh, age: 0, size })
  }

  // ---------- every frame ----------

  update(dt, t) {
    dt = Math.min(dt, 0.05)
    this.population()
    const kraken = this.krakenAgent()
    for (const a of this.agents) this.move(a, dt, t, kraken)
    for (const p of [...this.people]) this.movePerson(p, dt, t)

    for (const s of this.splashes) {
      s.age += dt
      const k = s.size * (1 + s.age * 3)
      s.mesh.scale.set(k, 1, k)
      s.mesh.material.opacity = Math.max(0, 0.9 - s.age)
    }
    for (const s of this.splashes.filter((s) => s.age > 1)) {
      this.group.remove(s.mesh)
      s.mesh.material.dispose()
    }
    this.splashes = this.splashes.filter((s) => s.age <= 1)

    // Draw: one instanced mesh per species.
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    const pos = new THREE.Vector3()
    const scale = new THREE.Vector3()
    const counts = new Map()
    for (const a of this.agents) {
      if (a.sp.kind === 'kraken') continue
      const mesh = this.meshes.get(a.sp.key)
      const i = counts.get(a.sp.key) ?? 0
      if (i >= a.sp.max) continue
      counts.set(a.sp.key, i + 1)
      const wiggle = a.sp.boat ? 0 : Math.sin(t * a.sp.speed * 0.8 + a.phase) * 0.18
      q.setFromAxisAngle(up, a.heading + wiggle)
      const s = a.sp.size * a.scale
      m.compose(pos.set(a.x, a.z, -a.y), q, scale.set(s, s, s))
      mesh.setMatrixAt(i, m)
    }
    for (const [key, mesh] of this.meshes) {
      mesh.count = counts.get(key) ?? 0
      mesh.instanceMatrix.needsUpdate = true
    }
    this.drawKraken(kraken, t)
  }

  // Thrashing tentacles, flickering eyes, a mouth that gapes wider while it hunts.
  drawKraken(a, t) {
    const k = this.kraken
    k.group.visible = Boolean(a)
    if (!a) return
    const s = a.sp.size * a.scale
    k.group.position.set(a.x, a.z, -a.y)
    k.group.rotation.y = a.heading
    k.group.scale.set(s, s, s)
    const fury = a.target ? 1.8 : 1
    k.tentacles.forEach((joints, i) => {
      joints.forEach((joint, j) => {
        joint.rotation.z = -0.15 + Math.sin(t * 2.2 * fury + i * 0.8 + j * 0.7) * 0.3
        joint.rotation.y = Math.sin(t * 1.3 * fury + i + j * 0.5) * 0.18
      })
    })
    k.glow.color.setRGB(1, 0.55 + 0.3 * Math.sin(t * 6), 0)
    const gape = 1 + (a.target ? 0.35 : 0.1) * (1 + Math.sin(t * 5))
    k.maw.scale.set(1, gape, gape)
  }

  // The fish that have grown, biggest first: the kraken, then by level and meals.
  leaders(n) {
    return this.agents
      .filter((a) => !a.sp.boat && (a.level > 1 || a.sp.kind === 'kraken'))
      .sort((p, q) => (q.sp.kind === 'kraken') - (p.sp.kind === 'kraken') || q.level - p.level || q.meals - p.meals)
      .slice(0, n)
  }

  stats() {
    const counts = {}
    for (const a of this.agents) counts[a.sp.key] = (counts[a.sp.key] ?? 0) + 1
    const kraken = this.krakenAgent()
    return {
      counts,
      ...this.score,
      swimming: this.people.filter((p) => p.state === 'water').length,
      safe: this.people.filter((p) => p.state === 'standing').length,
      leaders: this.leaders(5).map((a) => ({
        id: a.id, name: a.sp.name, colour: a.sp.colour, level: a.level, meals: a.meals,
        next: mealsToNext(a.level), max: a.level >= a.sp.maxLevel,
      })),
      kraken: kraken && {
        level: kraken.level,
        hunts: kraken.level >= KRAKEN_HUNTS_FROM,
        bite: Math.round(kraken.sp.size * kraken.scale * KRAKEN_BITE),
      },
    }
  }

  dispose() {
    for (const mesh of this.meshes.values()) mesh.geometry.dispose()
    this.kraken.group.traverse((o) => o.geometry?.dispose())
    this.personBody.dispose()
    this.personHead.dispose()
    this.splashGeometry.dispose()
  }
}
