import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'

const KEY_COLOR   = '#FFB300'   // golden — uncollected
const DULL_COLOR  = '#5577aa'   // blue-grey — already collected

export default function Key3D({ position = [0, 0, 0], collected = false }) {
  const groupRef = useRef()

  useFrame(({ clock }) => {
    if (!groupRef.current) return
    groupRef.current.rotation.y = clock.elapsedTime * 1.2
    groupRef.current.position.y = position[1] + Math.sin(clock.elapsedTime * 2.5) * 0.04
  })

  const color = collected ? DULL_COLOR : KEY_COLOR
  const emit  = collected ? 0.1 : 0.7

  const mat = <meshStandardMaterial color={color} emissive={color} emissiveIntensity={emit} />

  return (
    <group ref={groupRef} position={position}>
      {/* Ring / bow */}
      <mesh position={[0, 0.17, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.1, 0.035, 8, 18]} />
        {mat}
      </mesh>
      {/* Shaft */}
      <mesh position={[0, -0.03, 0]}>
        <cylinderGeometry args={[0.028, 0.028, 0.38, 8]} />
        {mat}
      </mesh>
      {/* Tooth 1 (larger) */}
      <mesh position={[0.085, -0.12, 0]}>
        <boxGeometry args={[0.09, 0.038, 0.038]} />
        {mat}
      </mesh>
      {/* Tooth 2 (smaller) */}
      <mesh position={[0.075, -0.19, 0]}>
        <boxGeometry args={[0.07, 0.038, 0.038]} />
        {mat}
      </mesh>
    </group>
  )
}
