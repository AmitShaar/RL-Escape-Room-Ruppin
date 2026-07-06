import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'

// Rings from bottom (narrow) to top (wide) — each slightly twisted
// so when the parent group rotates they form a continuous spiral.
const RINGS = [
  { y: 0.04, r: 0.07, t: 0.018 },
  { y: 0.15, r: 0.13, t: 0.025 },
  { y: 0.27, r: 0.19, t: 0.032 },
  { y: 0.41, r: 0.26, t: 0.040 },
  { y: 0.56, r: 0.33, t: 0.050 },
  { y: 0.70, r: 0.40, t: 0.058 },
]

export default function Hurricane3D({
  position = [0, 0, 0],
  scale = 1,
  speed = 3,
  color = '#8866ff',
  emissive = '#5533cc',
  emissiveIntensity = 1.5,
}) {
  const ref = useRef()
  useFrame(({ clock }) => {
    if (ref.current) ref.current.rotation.y = clock.elapsedTime * speed
  })

  return (
    <group ref={ref} position={position} scale={scale}>
      {/* Tip — tiny cone at the very bottom */}
      <mesh position={[0, 0.02, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.05, 0.07, 10]} />
        <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={emissiveIntensity + 0.5} />
      </mesh>

      {/* Stacked rings, each slightly twisted to form a spiral */}
      {RINGS.map(({ y, r, t }, i) => (
        <mesh
          key={i}
          position={[0, y, 0]}
          rotation={[-Math.PI / 2, 0, (i * Math.PI) / RINGS.length]}
        >
          <torusGeometry args={[r, t, 8, 30]} />
          <meshStandardMaterial
            color={color}
            emissive={emissive}
            emissiveIntensity={emissiveIntensity}
            transparent
            opacity={0.72 + i * 0.04}
          />
        </mesh>
      ))}
    </group>
  )
}
