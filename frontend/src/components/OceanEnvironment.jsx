import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

function Bubbles({ count = 500 }) {
  const pointsRef = useRef()

  const [positions, speeds] = useMemo(() => {
    const pos = new Float32Array(count * 3)
    const spd = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 30
      pos[i * 3 + 1] = Math.random() * 12 - 2
      pos[i * 3 + 2] = (Math.random() - 0.5) * 30
      spd[i] = 0.3 + Math.random() * 0.6
    }
    return [pos, spd]
  }, [count])

  useFrame((_, delta) => {
    const geom = pointsRef.current?.geometry
    if (!geom) return
    const arr = geom.attributes.position.array
    for (let i = 0; i < count; i++) {
      arr[i * 3 + 1] += speeds[i] * delta
      if (arr[i * 3 + 1] > 10) {
        arr[i * 3 + 1] = -2
      }
    }
    geom.attributes.position.needsUpdate = true
  })

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color="#aee4ff" size={0.06} transparent opacity={0.6} sizeAttenuation />
    </points>
  )
}

export default function OceanEnvironment({ exitPosition = [4.5, 0.5, 4.5] }) {
  return (
    <>
      <color attach="background" args={['#020b18']} />
      <fogExp2 attach="fog" args={['#020b18', 0.03]} />
      <ambientLight color="#cfe9ff" intensity={1.1} />
      <hemisphereLight color="#aee4ff" groundColor="#04162c" intensity={0.8} />
      <pointLight position={exitPosition} color="#00ffaa" intensity={2.0} distance={10} />
      <directionalLight position={[6, 12, 6]} color="#ffffff" intensity={0.7} />
      <Bubbles />
    </>
  )
}
