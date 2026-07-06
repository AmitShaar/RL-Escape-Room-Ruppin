import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'

// Tornado: a funnel cone (wide at top, tip at bottom) with a wireframe
// overlay that creates a swirling-grid illusion as it spins.
export default function Hurricane3D({
  position = [0, 0, 0],
  scale = 1,
  speed = 3,
}) {
  const ref = useRef()
  useFrame(({ clock }) => {
    if (ref.current) ref.current.rotation.y = clock.elapsedTime * speed
  })

  return (
    <group ref={ref} position={position} scale={scale}>
      {/* Funnel body — solid, semi-transparent gray-blue */}
      <mesh position={[0, 0.42, 0]}>
        <cylinderGeometry args={[0.38, 0.03, 0.84, 20, 1, true]} />
        <meshStandardMaterial
          color="#7799bb"
          emissive="#334466"
          emissiveIntensity={1.2}
          transparent
          opacity={0.55}
          side={2}
        />
      </mesh>

      {/* Wireframe overlay — grid lines spin → swirl illusion */}
      <mesh position={[0, 0.42, 0]}>
        <cylinderGeometry args={[0.40, 0.045, 0.87, 16, 10, true]} />
        <meshStandardMaterial
          color="#aabbdd"
          wireframe
          transparent
          opacity={0.40}
        />
      </mesh>

      {/* Dust disc at the base */}
      <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.0, 0.48, 28]} />
        <meshStandardMaterial
          color="#889aaa"
          emissive="#334455"
          emissiveIntensity={0.7}
          transparent
          opacity={0.35}
        />
      </mesh>

      {/* Cap ring at the top (cloud base) */}
      <mesh position={[0, 0.87, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.30, 0.08, 10, 24]} />
        <meshStandardMaterial
          color="#aabbcc"
          emissive="#556677"
          emissiveIntensity={1.2}
          transparent
          opacity={0.85}
        />
      </mesh>
    </group>
  )
}
