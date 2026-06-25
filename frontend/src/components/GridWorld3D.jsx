import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import Bone from './Bone.jsx'
import CatDanger from './CatDanger.jsx'

export const GRID_SIZE = 10

export function gridToWorld(row, col, y = 0) {
  return [col - (GRID_SIZE - 1) / 2, y, row - (GRID_SIZE - 1) / 2]
}

function RowSweepHighlight({ row }) {
  const groupRef = useRef()

  useFrame(({ clock }) => {
    if (!groupRef.current) return
    const intensity = 0.5 + Math.sin(clock.elapsedTime * 10) * 0.5
    for (const mesh of groupRef.current.children) {
      mesh.material.emissiveIntensity = 0.4 + intensity * 0.8
    }
  })

  const cells = []
  for (let c = 0; c < GRID_SIZE; c++) {
    const [x, y, z] = gridToWorld(row, c, 0.12)
    cells.push(
      <mesh key={c} position={[x, y, z]}>
        <boxGeometry args={[0.95, 0.04, 0.95]} />
        <meshStandardMaterial color="#ffffff" emissive="#7fd9ff" emissiveIntensity={0.6} transparent opacity={0.6} />
      </mesh>
    )
  }
  return <group ref={groupRef}>{cells}</group>
}

function HoleSwirl({ row, col }) {
  const ref = useRef()
  useFrame(({ clock }) => {
    if (ref.current) ref.current.rotation.z = clock.elapsedTime * 2
  })
  const [x, y, z] = gridToWorld(row, col, 0.15)
  return (
    <mesh ref={ref} position={[x, y, z]} rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[0.3, 0.05, 8, 24]} />
      <meshStandardMaterial color="#4a0a6a" emissive="#7a00ff" emissiveIntensity={0.5} />
    </mesh>
  )
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
  beaconsVisitedCount = 0,
  artifacts = [],
  collectedMask = 0,
  treats = [],
  treatsCollectedMask = 0,
  holes = [],
  sharkPos = null,
  currentRow = null,
  start = [0, 0],
  exit = [GRID_SIZE - 1, GRID_SIZE - 1],
}) {
  const wallSet = useMemo(() => toKeySet(walls), [walls])
  const ventSet = useMemo(() => toKeySet(vents), [vents])
  const trapSet = useMemo(() => toKeySet(traps), [traps])
  const holeSet = useMemo(() => toKeySet(holes), [holes])

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
      const isHole = holeSet.has(key)

      let color = '#0a2a4a'
      let height = 0.1
      let emissive = '#000000'
      let emissiveIntensity = 0

      if (isWall) {
        color = '#2a4a2a'
        height = 0.5
      } else if (isTrap) {
        color = '#4a0a0a'
      } else if (isHole) {
        color = '#150522'
      } else if (isExit) {
        color = '#3a3015'
        emissive = '#FFD700'
        emissiveIntensity = 0.3
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
      if (isHole) {
        cells.push(<HoleSwirl key={`${key}-swirl`} row={r} col={c} />)
      }
      if (isTrap) {
        const [tx, ty, tz] = gridToWorld(r, c, 0.28)
        cells.push(<CatDanger key={`${key}-cat`} position={[tx, ty, tz]} />)
      }

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

  beacons.forEach(([r, c], idx) => {
    const visited = idx < beaconsVisitedCount
    const color = visited ? '#5577aa' : '#aaff44'
    const [x, y, z] = gridToWorld(r, c, 0.5)
    cells.push(
      <mesh key={`beacon-${r}-${c}`} position={[x, y, z]}>
        <sphereGeometry args={[0.22, 16, 16]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={visited ? 0.2 : 0.7} />
      </mesh>
    )
  })

  artifacts.forEach(([r, c], idx) => {
    const collected = Boolean(collectedMask & (1 << idx))
    const color = collected ? '#5577aa' : '#ffd54a'
    const [x, y, z] = gridToWorld(r, c, 0.5)
    cells.push(
      <mesh key={`artifact-${r}-${c}`} position={[x, y, z]} rotation={[0, Math.PI / 4, 0]}>
        <octahedronGeometry args={[0.22, 0]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={collected ? 0.15 : 0.8} />
      </mesh>
    )
  })

  treats.forEach(([r, c], idx) => {
    const collected = Boolean(treatsCollectedMask & (1 << idx))
    if (collected) return
    const [x, y, z] = gridToWorld(r, c, 0.45)
    cells.push(
      <mesh key={`treat-${r}-${c}`} position={[x, y, z]}>
        <sphereGeometry args={[0.14, 12, 10]} />
        <meshStandardMaterial color="#ffd700" emissive="#ffd700" emissiveIntensity={0.8} />
      </mesh>
    )
  })

  {
    const [bx, by, bz] = gridToWorld(exit[0], exit[1], 0.4)
    cells.push(<Bone key="bone-exit" position={[bx, by, bz]} />)
  }

  if (sharkPos) {
    const [sx, sy, sz] = gridToWorld(sharkPos[0], sharkPos[1], 0.3)
    cells.push(
      <mesh key="shark" position={[sx, sy, sz]} rotation={[0, 0, Math.PI / 2]}>
        <coneGeometry args={[0.3, 0.7, 8]} />
        <meshStandardMaterial color="#ff3344" emissive="#ff3344" emissiveIntensity={0.6} />
      </mesh>
    )
  }

  return (
    <group>
      {cells}
      {currentRow != null && <RowSweepHighlight row={currentRow} />}
    </group>
  )
}
