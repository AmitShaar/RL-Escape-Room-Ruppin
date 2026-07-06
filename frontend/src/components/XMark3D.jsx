// Bold red X placed on the patrol cell in the 3D scene.
export default function XMark3D({ position = [0, 0, 0] }) {
  const mat = (
    <meshStandardMaterial
      color="#ee1111"
      emissive="#cc0000"
      emissiveIntensity={1.4}
      transparent
      opacity={0.92}
    />
  )

  return (
    <group position={position}>
      <mesh rotation={[0, 0, Math.PI / 4]}>
        <boxGeometry args={[0.14, 0.65, 0.14]} />
        {mat}
      </mesh>
      <mesh rotation={[0, 0, -Math.PI / 4]}>
        <boxGeometry args={[0.14, 0.65, 0.14]} />
        {mat}
      </mesh>
    </group>
  )
}
