import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'

const BONE_COLOR = '#FFD700'
const SHAFT_LEN = 0.5
const BALL_R = 0.13

export default function Bone({ position = [0, 0, 0], scale = 1, pulse = false }) {
  const ref = useRef()

  useFrame(({ clock }) => {
    if (!ref.current) return
    ref.current.rotation.y = clock.elapsedTime * 0.8
    const s = pulse ? scale + Math.sin(clock.elapsedTime * 2) * 0.1 : scale
    ref.current.scale.setScalar(s)
  })

  return (
    <group ref={ref} position={position}>
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.06, 0.06, SHAFT_LEN, 8]} />
        <meshStandardMaterial color={BONE_COLOR} emissive={BONE_COLOR} emissiveIntensity={0.6} />
      </mesh>
      {[-1, 1].map((side) => (
        <group key={side} position={[(side * SHAFT_LEN) / 2, 0, 0]}>
          <mesh position={[0, BALL_R * 0.6, 0]}>
            <sphereGeometry args={[BALL_R, 8, 8]} />
            <meshStandardMaterial color={BONE_COLOR} emissive={BONE_COLOR} emissiveIntensity={0.6} />
          </mesh>
          <mesh position={[0, -BALL_R * 0.6, 0]}>
            <sphereGeometry args={[BALL_R, 8, 8]} />
            <meshStandardMaterial color={BONE_COLOR} emissive={BONE_COLOR} emissiveIntensity={0.6} />
          </mesh>
        </group>
      ))}
    </group>
  )
}
