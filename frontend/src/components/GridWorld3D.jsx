import { useMemo } from 'react'

export const GRID_SIZE = 10

export function gridToWorld(row, col, y = 0) {
  return [col - (GRID_SIZE - 1) / 2, y, row - (GRID_SIZE - 1) / 2]
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

export default function GridWorld3D({
  vTable,
  policy,
  walls = [],
  vents = [],
  traps = [],
  beacons = [],
  start = [0, 0],
  exit = [GRID_SIZE - 1, GRID_SIZE - 1],
}) {
  const wallSet = useMemo(() => toKeySet(walls), [walls])
  const ventSet = useMemo(() => toKeySet(vents), [vents])
  const trapSet = useMemo(() => toKeySet(traps), [traps])

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
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      const key = `${r},${c}`
      const isStart = r === start[0] && c === start[1]
      const isExit = r === exit[0] && c === exit[1]
      const isWall = wallSet.has(key)
      const isTrap = trapSet.has(key)
      const isVent = ventSet.has(key)

      let color = '#0a2a4a'
      let height = 0.1
      let emissive = '#000000'
      let emissiveIntensity = 0

      if (isWall) {
        color = '#2a4a2a'
        height = 0.5
      } else if (isTrap) {
        color = '#4a0a0a'
      } else if (isExit) {
        color = '#00ffaa'
        emissive = '#00ffaa'
        emissiveIntensity = 0.8
      } else if (isStart) {
        color = '#1a4a6a'
      } else if (vTable) {
        const v = vTable[r][c]
        const t = max > min ? (v - min) / (max - min) : 0
        color = lerpColor(t)
        if (isVent) emissiveIntensity = 0.15
      } else if (isVent) {
        color = '#1a4a6a'
      }

      const [x, y, z] = gridToWorld(r, c, height / 2)
      cells.push(
        <mesh key={key} position={[x, y, z]}>
          <boxGeometry args={[0.9, height, 0.9]} />
          <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={emissiveIntensity} />
        </mesh>
      )

      const actionIdx = policy ? policy[r][c] : -1
      if (actionIdx >= 0 && !isWall && !isExit) {
        const [ax, ay, az] = gridToWorld(r, c, 0.35)
        cells.push(
          <mesh key={`${key}-arrow`} position={[ax, ay, az]} rotation={ARROW_ROTATION[actionIdx]}>
            <coneGeometry args={[0.12, 0.4, 8]} />
            <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.4} />
          </mesh>
        )
      }
    }
  }

  for (const [r, c] of beacons) {
    const [x, y, z] = gridToWorld(r, c, 0.5)
    cells.push(
      <mesh key={`beacon-${r}-${c}`} position={[x, y, z]}>
        <sphereGeometry args={[0.22, 16, 16]} />
        <meshStandardMaterial color="#aaff44" emissive="#aaff44" emissiveIntensity={0.7} />
      </mesh>
    )
  }

  return <group>{cells}</group>
}
