import { useMemo } from 'react'

// A size-parameterized sibling of GridWorld3D.jsx, kept separate (rather than
// adding a `size` prop there) so Rooms 1-4's hardcoded-10x10 rendering is
// guaranteed untouched. Room 6's grid actually grows between stages
// (4x4 -> 6x6 -> 10x10), which GridWorld3D has no notion of.

export function gridToWorld(row, col, size, y = 0) {
  return [col - (size - 1) / 2, y, row - (size - 1) / 2]
}

const LOW = [10, 42, 74] // #0a2a4a
const HIGH = [255, 153, 0] // #ff9900

function lerpColor(t) {
  const r = Math.round(LOW[0] + (HIGH[0] - LOW[0]) * t)
  const g = Math.round(LOW[1] + (HIGH[1] - LOW[1]) * t)
  const b = Math.round(LOW[2] + (HIGH[2] - LOW[2]) * t)
  return `rgb(${r},${g},${b})`
}

const ARROW_ROTATION = [
  [-Math.PI / 2, 0, 0], // UP
  [Math.PI / 2, 0, 0], // DOWN
  [0, 0, Math.PI / 2], // LEFT
  [0, 0, -Math.PI / 2], // RIGHT
]

function toKeySet(value) {
  if (value instanceof Set) return value
  return new Set((value || []).map((p) => `${p[0]},${p[1]}`))
}

export default function GrowingGridWorld3D({
  size,
  vTable,
  policy,
  walls = [],
  start = [0, 0],
  exit = null,
}) {
  const exitCell = exit || [size - 1, size - 1]
  const wallSet = useMemo(() => toKeySet(walls), [walls])

  const { min, max } = useMemo(() => {
    if (!vTable) return { min: 0, max: 1 }
    let mn = Infinity
    let mx = -Infinity
    for (const row of vTable) {
      for (const v of row) {
        if (v < mn) mn = v
        if (v > mx) mx = v
      }
    }
    if (!Number.isFinite(mn)) mn = 0
    if (!Number.isFinite(mx)) mx = 1
    return { min: mn, max: mx }
  }, [vTable])

  const cells = []
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const key = `${r},${c}`
      const isStart = r === start[0] && c === start[1]
      const isExit = r === exitCell[0] && c === exitCell[1]
      const isWall = wallSet.has(key)

      let color = '#0a2a4a'
      let height = 0.1

      if (isWall) {
        color = '#2a4a2a'
        height = 0.5
      } else if (isExit) {
        color = '#3a3015'
      } else if (isStart) {
        color = '#1a4a6a'
      } else if (vTable && vTable[r] && vTable[r][c] != null) {
        const v = vTable[r][c]
        const t = max > min ? (v - min) / (max - min) : 0
        color = lerpColor(t)
      }

      const [x, y, z] = gridToWorld(r, c, size, height / 2)
      cells.push(
        <mesh key={key} position={[x, y, z]}>
          <boxGeometry args={[0.9, height, 0.9]} />
          <meshStandardMaterial
            color={color}
            emissive={isExit ? '#FFD700' : '#000000'}
            emissiveIntensity={isExit ? 0.3 : 0}
          />
        </mesh>
      )

      const actionIdx = policy && policy[r] ? policy[r][c] : -1
      if (actionIdx >= 0 && !isWall && !isExit) {
        const [ax, ay, az] = gridToWorld(r, c, size, 0.35)
        cells.push(
          <mesh key={`${key}-arrow`} position={[ax, ay, az]} rotation={ARROW_ROTATION[actionIdx]}>
            <coneGeometry args={[0.12, 0.4, 8]} />
            <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.4} />
          </mesh>
        )
      }
    }
  }

  return <group>{cells}</group>
}
