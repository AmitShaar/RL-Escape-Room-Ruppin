import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'

useGLTF.preload('/barger.glb')

export default function Steak3D({ position = [0, 0, 0] }) {
  const ref = useRef()
  const { scene } = useGLTF('/barger.glb')

  useFrame(({ clock }) => {
    if (ref.current) ref.current.rotation.y = clock.elapsedTime * 1.5
  })

  return (
    <group ref={ref} position={position} scale={0.003}>
      <primitive object={scene.clone(true)} />
    </group>
  )
}
