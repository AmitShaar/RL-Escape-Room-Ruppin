import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import OceanEnvironment from './OceanEnvironment.jsx'

export default function Scene3D({ children }) {
  return (
    <div style={{ width: '100%', height: '100%' }}>
      <Canvas camera={{ position: [11, 14, 11], fov: 50 }}>
        <OceanEnvironment />
        <OrbitControls makeDefault minDistance={4} maxDistance={25} />
        {children}
      </Canvas>
    </div>
  )
}
