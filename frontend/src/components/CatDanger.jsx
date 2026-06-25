import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

const FUR = '#55555c'
const ACCENT = '#3d3d44' // ears, paws - darker than the main coat
const EYE_COLOR = '#3a6b4a'
const NOSE_COLOR = '#1a1a1a'
const WHISKER_COLOR = '#f0f0f0'

const LEG_LEN = 0.16
const LEG_X = 0.075
const LEG_FRONT_Z = 0.1
const LEG_BACK_Z = -0.1

const LEGS = [
  { key: 'FL', x: -LEG_X, z: LEG_FRONT_Z },
  { key: 'FR', x: LEG_X, z: LEG_FRONT_Z },
  { key: 'BL', x: -LEG_X, z: LEG_BACK_Z },
  { key: 'BR', x: LEG_X, z: LEG_BACK_Z },
]

const WHISKER_ANGLES = [-0.5, 0, 0.5]

function Part({ geometry, color, position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1] }) {
  return (
    <mesh geometry={geometry} position={position} rotation={rotation} scale={scale}>
      <meshStandardMaterial color={color} roughness={0.75} metalness={0.02} />
    </mesh>
  )
}

// A small standing cat (4 legs, tail straight up, pointed ears, whiskers)
// marking trap cells - realistic-proportioned rather than the low-poly
// style used for חיזקי, per the reference photo.
export default function CatDanger({ position = [0, 0, 0] }) {
  const groupRef = useRef()
  const tailRef = useRef()

  const geo = useMemo(
    () => ({
      body: new THREE.SphereGeometry(0.1, 14, 10),
      head: new THREE.SphereGeometry(0.075, 14, 10),
      snout: new THREE.SphereGeometry(0.035, 10, 8),
      nose: new THREE.SphereGeometry(0.012, 6, 6),
      eye: new THREE.SphereGeometry(0.016, 8, 6),
      ear: new THREE.ConeGeometry(0.032, 0.06, 4),
      leg: new THREE.CylinderGeometry(0.02, 0.016, LEG_LEN, 8),
      paw: new THREE.SphereGeometry(0.024, 8, 6),
      whisker: new THREE.CylinderGeometry(0.0025, 0.0025, 0.1, 4),
      tailBase: new THREE.CylinderGeometry(0.018, 0.014, 0.18, 8),
      tailTip: new THREE.CylinderGeometry(0.012, 0.009, 0.14, 8),
    }),
    []
  )

  const bodyY = LEG_LEN + 0.07
  const headPos = [0, bodyY + 0.05, 0.16]

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    if (groupRef.current) {
      groupRef.current.position.y = position[1] + Math.sin(t * 1.6) * 0.01
    }
    if (tailRef.current) {
      tailRef.current.rotation.x = Math.sin(t * 1.4) * 0.12
    }
  })

  return (
    <group ref={groupRef} position={position}>
      <Part geometry={geo.body} color={FUR} position={[0, bodyY, 0]} scale={[0.85, 0.7, 1.5]} />

      <Part geometry={geo.head} color={FUR} position={headPos} />
      <Part geometry={geo.snout} color={FUR} position={[0, headPos[1] - 0.025, headPos[2] + 0.06]} scale={[1, 0.85, 1]} />
      <Part geometry={geo.nose} color={NOSE_COLOR} position={[0, headPos[1] - 0.02, headPos[2] + 0.09]} />
      <Part geometry={geo.eye} color={EYE_COLOR} position={[-0.032, headPos[1] + 0.015, headPos[2] + 0.05]} />
      <Part geometry={geo.eye} color={EYE_COLOR} position={[0.032, headPos[1] + 0.015, headPos[2] + 0.05]} />

      <Part geometry={geo.ear} color={ACCENT} position={[-0.04, headPos[1] + 0.08, headPos[2] - 0.02]} rotation={[0, 0, -0.25]} />
      <Part geometry={geo.ear} color={ACCENT} position={[0.04, headPos[1] + 0.08, headPos[2] - 0.02]} rotation={[0, 0, 0.25]} />

      {WHISKER_ANGLES.map((a, i) => (
        <Part
          key={`wL-${i}`}
          geometry={geo.whisker}
          color={WHISKER_COLOR}
          position={[-0.04, headPos[1] - 0.02, headPos[2] + 0.07]}
          rotation={[0, Math.PI / 2 + a, 0]}
        />
      ))}
      {WHISKER_ANGLES.map((a, i) => (
        <Part
          key={`wR-${i}`}
          geometry={geo.whisker}
          color={WHISKER_COLOR}
          position={[0.04, headPos[1] - 0.02, headPos[2] + 0.07]}
          rotation={[0, -Math.PI / 2 - a, 0]}
        />
      ))}

      {LEGS.map((leg) => (
        <Part key={leg.key} geometry={geo.leg} color={FUR} position={[leg.x, LEG_LEN / 2, leg.z]} />
      ))}
      {LEGS.map((leg) => (
        <Part key={`paw-${leg.key}`} geometry={geo.paw} color={ACCENT} position={[leg.x, 0.015, leg.z]} scale={[1, 0.7, 1.1]} />
      ))}

      <group ref={tailRef} position={[0, bodyY + 0.04, -0.2]} rotation={[-0.55, 0, 0]}>
        <Part geometry={geo.tailBase} color={FUR} position={[0, 0.09, 0]} />
        <group position={[0, 0.18, 0]} rotation={[0.35, 0, 0]}>
          <Part geometry={geo.tailTip} color={FUR} position={[0, 0.07, 0]} />
        </group>
      </group>
    </group>
  )
}
