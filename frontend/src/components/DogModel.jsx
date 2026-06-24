import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

const BODY_COLOR = '#1a9e8f'
const LIGHT_COLOR = '#22c5b3'
const DARK_COLOR = '#0d6e63'
const NOSE_COLOR = '#111111'
const EYE_COLOR = '#111111'

const TRAIL_LENGTH = 8

function Part({ geometry, color, position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1] }) {
  return (
    <mesh geometry={geometry} position={position} rotation={rotation} scale={scale}>
      <meshStandardMaterial color={color} roughness={0.6} metalness={0.05} />
    </mesh>
  )
}

const LEG_POSITIONS = [
  [-0.16, -0.28, 0.18], // front-left
  [0.16, -0.28, 0.18], // front-right
  [-0.16, -0.28, -0.18], // back-left
  [0.16, -0.28, -0.18], // back-right
]

export default function DogModel({ position = [0, 0.4, 0] }) {
  const groupRef = useRef()
  const tailRef = useRef()
  const legRefs = [useRef(), useRef(), useRef(), useRef()]
  const trailRef = useRef([])
  const prevPos = useRef(position)
  const movingRef = useRef(false)

  const geo = useMemo(
    () => ({
      body: new THREE.SphereGeometry(0.38, 12, 8),
      head: new THREE.SphereGeometry(0.26, 12, 10),
      snout: new THREE.SphereGeometry(0.13, 8, 6),
      nose: new THREE.SphereGeometry(0.05, 6, 4),
      ear: new THREE.SphereGeometry(0.12, 8, 6),
      tail: new THREE.CylinderGeometry(0.04, 0.07, 0.35, 8),
      leg: new THREE.CylinderGeometry(0.07, 0.06, 0.32, 8),
      paw: new THREE.SphereGeometry(0.09, 8, 6),
      eye: new THREE.SphereGeometry(0.04, 6, 6),
    }),
    []
  )

  useEffect(() => {
    const prev = prevPos.current
    const dx = position[0] - prev[0]
    const dz = position[2] - prev[2]
    const moved = Math.abs(dx) > 1e-5 || Math.abs(dz) > 1e-5
    movingRef.current = moved
    if (moved && groupRef.current) {
      const targetYaw = Math.atan2(dx, dz)
      groupRef.current.userData.targetYaw = targetYaw
    }
    trailRef.current = [...trailRef.current, prev].slice(-TRAIL_LENGTH)
    prevPos.current = position
  }, [position])

  useFrame(({ clock }, delta) => {
    const t = clock.elapsedTime
    if (groupRef.current) {
      groupRef.current.position.set(position[0], position[1] + Math.sin(t * 2) * 0.03, position[2])
      const targetYaw = groupRef.current.userData.targetYaw
      if (targetYaw != null) {
        // Smoothly turn to face the direction of movement.
        const current = groupRef.current.rotation.y
        let diff = targetYaw - current
        diff = Math.atan2(Math.sin(diff), Math.cos(diff))
        groupRef.current.rotation.y = current + diff * Math.min(1, delta * 8)
      }
    }
    if (tailRef.current) {
      tailRef.current.rotation.z = Math.sin(t * 3) * 0.4
    }
    legRefs.forEach((ref, i) => {
      if (!ref.current) return
      if (movingRef.current) {
        const phase = i % 2 === 0 ? 0 : Math.PI
        ref.current.rotation.x = Math.sin(t * 8 + phase) * 0.3
      } else {
        ref.current.rotation.x = 0
      }
    })
  })

  return (
    <>
      <group ref={groupRef} position={position}>
        <Part geometry={geo.body} color={BODY_COLOR} scale={[1, 0.7, 1]} />
        <Part geometry={geo.head} color={LIGHT_COLOR} position={[0, 0.22, 0.3]} />
        <Part geometry={geo.snout} color={LIGHT_COLOR} position={[0, 0.18, 0.48]} scale={[1, 1, 0.7]} />
        <Part geometry={geo.nose} color={NOSE_COLOR} position={[0, 0.18, 0.58]} />
        <Part geometry={geo.eye} color={EYE_COLOR} position={[-0.1, 0.3, 0.45]} />
        <Part geometry={geo.eye} color={EYE_COLOR} position={[0.1, 0.3, 0.45]} />
        <Part geometry={geo.ear} color={DARK_COLOR} position={[-0.18, 0.4, 0.26]} rotation={[0, 0, 0.5]} scale={[1, 1.4, 1]} />
        <Part geometry={geo.ear} color={DARK_COLOR} position={[0.18, 0.4, 0.26]} rotation={[0, 0, -0.5]} scale={[1, 1.4, 1]} />

        <mesh ref={tailRef} geometry={geo.tail} position={[0, 0.15, -0.42]} rotation={[-Math.PI / 4, 0, 0]}>
          <meshStandardMaterial color={DARK_COLOR} roughness={0.6} metalness={0.05} />
        </mesh>

        {LEG_POSITIONS.map((pos, i) => (
          <mesh key={i} ref={legRefs[i]} geometry={geo.leg} position={pos}>
            <meshStandardMaterial color={BODY_COLOR} roughness={0.6} metalness={0.05} />
          </mesh>
        ))}
        {LEG_POSITIONS.map((pos, i) => (
          <Part key={`paw-${i}`} geometry={geo.paw} color={DARK_COLOR} position={[pos[0], pos[1] - 0.19, pos[2]]} />
        ))}

        <pointLight position={[0, 0.3, 0.4]} color={LIGHT_COLOR} intensity={0.6} distance={2} />
      </group>
      {trailRef.current.map((p, i) => (
        <mesh key={i} position={p}>
          <sphereGeometry args={[Math.max(0.03, 0.09 - i * 0.01), 8, 8]} />
          <meshStandardMaterial color={LIGHT_COLOR} transparent opacity={0.12 + i * 0.04} />
        </mesh>
      ))}
    </>
  )
}
