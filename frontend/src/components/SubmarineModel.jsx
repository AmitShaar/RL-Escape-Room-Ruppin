import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'

export default function SubmarineModel({ position = [0, 0.4, 0] }) {
  const groupRef = useRef()
  const trailRef = useRef([])
  const prevPos = useRef(position)

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
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.26, 0.26, 0.85, 16]} />
          <meshStandardMaterial color="#6fb6ff" emissive="#2266aa" emissiveIntensity={0.6} metalness={0.6} roughness={0.3} />
        </mesh>
        <mesh position={[0, 0, 0.6]} rotation={[Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.26, 0.4, 16]} />
          <meshStandardMaterial color="#6fb6ff" emissive="#2266aa" emissiveIntensity={0.6} metalness={0.6} roughness={0.3} />
        </mesh>
        <spotLight position={[0, 0.1, 0.5]} target-position={[0, 0, 2]} color="#aee4ff" intensity={1.5} angle={0.5} />
      </group>
      {trailRef.current.map((p, i) => (
        <mesh key={i} position={p}>
          <sphereGeometry args={[Math.max(0.03, 0.08 - i * 0.01), 8, 8]} />
          <meshStandardMaterial color="#4488cc" transparent opacity={0.15 + i * 0.05} />
        </mesh>
      ))}
    </>
  )
}
