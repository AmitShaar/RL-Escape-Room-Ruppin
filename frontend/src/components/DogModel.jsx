import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

const DOG_COLOR = '#1D9E75'

function WirePart({ geometry, position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1] }) {
  return (
    <lineSegments position={position} rotation={rotation} scale={scale}>
      <edgesGeometry args={[geometry]} />
      <lineBasicMaterial color={DOG_COLOR} />
    </lineSegments>
  )
}

export default function DogModel({ position = [0, 0.4, 0] }) {
  const groupRef = useRef()
  const trailRef = useRef([])
  const prevPos = useRef(position)

  const geo = useMemo(
    () => ({
      body: new THREE.SphereGeometry(0.35, 8, 6),
      head: new THREE.SphereGeometry(0.22, 8, 6),
      snout: new THREE.SphereGeometry(0.1, 6, 4),
      ear: new THREE.SphereGeometry(0.12, 6, 4),
      tail: new THREE.CylinderGeometry(0.03, 0.06, 0.3, 6),
      leg: new THREE.CylinderGeometry(0.06, 0.06, 0.28, 6),
    }),
    []
  )

  useEffect(() => {
    const prev = prevPos.current
    const dx = position[0] - prev[0]
    const dz = position[2] - prev[2]
    if ((dx !== 0 || dz !== 0) && groupRef.current) {
      groupRef.current.rotation.y = Math.atan2(dx, dz)
    }
    trailRef.current = [...trailRef.current, prev].slice(-5)
    prevPos.current = position
  }, [position])

  useFrame(({ clock }) => {
    if (groupRef.current) {
      groupRef.current.position.set(...position)
      groupRef.current.position.y += Math.sin(clock.elapsedTime * 2) * 0.03
    }
  })

  return (
    <>
      <group ref={groupRef} position={position}>
        <WirePart geometry={geo.body} scale={[1, 0.8, 1.1]} />
        <WirePart geometry={geo.head} position={[0, 0.18, 0.32]} />
        <WirePart geometry={geo.snout} position={[0, 0.15, 0.5]} />
        <WirePart geometry={geo.ear} position={[-0.12, 0.34, 0.3]} rotation={[0, 0, 0.4]} />
        <WirePart geometry={geo.ear} position={[0.12, 0.34, 0.3]} rotation={[0, 0, -0.4]} />
        <WirePart geometry={geo.tail} position={[0, 0.25, -0.4]} rotation={[Math.PI / 3, 0, 0]} />
        <WirePart geometry={geo.leg} position={[-0.18, -0.25, 0.2]} />
        <WirePart geometry={geo.leg} position={[0.18, -0.25, 0.2]} />
        <WirePart geometry={geo.leg} position={[-0.18, -0.25, -0.2]} />
        <WirePart geometry={geo.leg} position={[0.18, -0.25, -0.2]} />
        <pointLight position={[0, 0.3, 0.4]} color={DOG_COLOR} intensity={0.8} distance={2} />
      </group>
      {trailRef.current.map((p, i) => (
        <mesh key={i} position={p}>
          <sphereGeometry args={[Math.max(0.03, 0.08 - i * 0.01), 8, 8]} />
          <meshStandardMaterial color={DOG_COLOR} transparent opacity={0.15 + i * 0.05} />
        </mesh>
      ))}
    </>
  )
}
