import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'

export default function TennisBall({ position = [0, 0, 0] }) {
  const ref = useRef()
  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.rotation.y = clock.elapsedTime * 2.0
      ref.current.rotation.x = clock.elapsedTime * 0.9
    }
  })

  const seamMat = (
    <meshStandardMaterial color="#f0f0f0" emissive="#ffffff" emissiveIntensity={0.4} roughness={0.5} />
  )

  return (
    <group ref={ref} position={position}>
      {/* Main ball — classic tennis yellow-green */}
      <mesh>
        <sphereGeometry args={[0.28, 32, 24]} />
        <meshStandardMaterial
          color="#c8f000"
          emissive="#80a000"
          emissiveIntensity={0.25}
          roughness={0.75}
          metalness={0.0}
        />
      </mesh>

      {/* Seam 1 — tilted torus ring approximating the curved seam */}
      <mesh rotation={[0, 0, Math.PI / 4]}>
        <torusGeometry args={[0.282, 0.016, 8, 80]} />
        {seamMat}
      </mesh>

      {/* Seam 2 — perpendicular ring, together they make the figure-8 seam */}
      <mesh rotation={[Math.PI / 2, Math.PI / 4, 0]}>
        <torusGeometry args={[0.282, 0.016, 8, 80]} />
        {seamMat}
      </mesh>
    </group>
  )
}
