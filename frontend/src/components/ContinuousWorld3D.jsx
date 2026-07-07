import { useMemo } from 'react'
import * as THREE from 'three'
import Bone from './Bone.jsx'

export const ROOM_SIZE = 10

export function continuousToWorld(x, y, height = 0) {
  return [x - ROOM_SIZE / 2, height, y - ROOM_SIZE / 2]
}

export default function ContinuousWorld3D({
  velocity = [0, 0],
  agentPos = [1, 1],
  exitCenter = [9, 9],
  obstacles = [],
}) {
  const [ex, ey, ez] = continuousToWorld(exitCenter[0], exitCenter[1], 0.5)

  const arrowDir = useMemo(() => {
    const [vx, vy] = velocity
    const mag = Math.hypot(vx, vy)
    if (mag < 1e-4) return null
    return { dir: new THREE.Vector3(vx, 0, vy).normalize(), length: Math.min(2, mag * 0.3) }
  }, [velocity])


  const [ax, ay, az] = continuousToWorld(agentPos[0], agentPos[1], 0.4)

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[ROOM_SIZE, ROOM_SIZE]} />
        <meshStandardMaterial color="#061a30" />
      </mesh>

      <mesh position={[0, 1, 0]}>
        <boxGeometry args={[ROOM_SIZE, 2, ROOM_SIZE]} />
        <meshBasicMaterial color="#2a6a9a" wireframe transparent opacity={0.25} />
      </mesh>

      <Bone position={[ex, ey, ez]} scale={1.4} pulse />
      <pointLight position={[ex, ey + 0.5, ez]} color="#1D9E75" intensity={1.2} distance={4} />

      {obstacles.map(([ox0, oy0], i) => {
        const [ox, oy, oz] = continuousToWorld(ox0, oy0, 0.5)
        return (
          <mesh key={i} position={[ox, oy, oz]}>
            <boxGeometry args={[0.5, 1, 0.5]} />
            <meshStandardMaterial color="#ff5522" emissive="#ff5522" emissiveIntensity={0.4} />
          </mesh>
        )
      })}

      {arrowDir && (
        <arrowHelper args={[arrowDir.dir, new THREE.Vector3(ax, ay, az), arrowDir.length, 0xaee4ff, arrowDir.length * 0.3, arrowDir.length * 0.2]} />
      )}

    </group>
  )
}
