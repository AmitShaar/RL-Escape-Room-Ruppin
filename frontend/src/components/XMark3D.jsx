// A small red X placed on danger/patrol cells in the 3D scene.
export default function XMark3D({ position = [0, 0, 0] }) {
  const mat = (
    <meshStandardMaterial
      color="#dd1111"
      emissive="#cc0000"
      emissiveIntensity={0.6}
      transparent
      opacity={0.85}
    />
  )

  return (
    <group position={position}>
      {/* First bar of X (rotated 45°) */}
      <mesh rotation={[0, 0, Math.PI / 4]}>
        <boxGeometry args={[0.08, 0.42, 0.08]} />
        {mat}
      </mesh>
      {/* Second bar of X (rotated −45°) */}
      <mesh rotation={[0, 0, -Math.PI / 4]}>
        <boxGeometry args={[0.08, 0.42, 0.08]} />
        {mat}
      </mesh>
    </group>
  )
}
