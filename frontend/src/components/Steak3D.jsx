// Meat-on-bone artifact — static, sits close to the grid cell.
function BoneKnob({ position, rotation = [0, 0, 0] }) {
  const mat = <meshStandardMaterial color="#F0EDE4" roughness={0.35} />
  return (
    <group position={position} rotation={rotation}>
      <mesh><sphereGeometry args={[0.072, 14, 10]} />{mat}</mesh>
      <mesh position={[ 0.063, 0.037, 0]}><sphereGeometry args={[0.058, 12, 9]} />{mat}</mesh>
      <mesh position={[-0.063, 0.037, 0]}><sphereGeometry args={[0.058, 12, 9]} />{mat}</mesh>
    </group>
  )
}

export default function Steak3D({ position = [0, 0, 0] }) {
  return (
    <group position={position} rotation={[0.3, 0.5, 0.4]}>
      {/* Meat body */}
      <mesh scale={[1, 0.95, 1]}>
        <sphereGeometry args={[0.26, 26, 18]} />
        <meshStandardMaterial color="#D85C12" emissive="#7a2800" emissiveIntensity={0.18} roughness={0.42} />
      </mesh>

      {/* Cut face border */}
      <mesh position={[-0.23, 0, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <circleGeometry args={[0.215, 26]} />
        <meshStandardMaterial color="#EDD8B0" roughness={0.55} />
      </mesh>
      {/* Red interior */}
      <mesh position={[-0.225, 0, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <circleGeometry args={[0.180, 26]} />
        <meshStandardMaterial color="#A0102A" emissive="#600010" emissiveIntensity={0.22} roughness={0.6} />
      </mesh>

      {/* Bone shaft */}
      <group rotation={[0.5, 0, 0.4]}>
        <mesh>
          <cylinderGeometry args={[0.028, 0.028, 0.68, 12]} />
          <meshStandardMaterial color="#F0EDE4" roughness={0.35} />
        </mesh>
        <BoneKnob position={[0,  0.37, 0]} />
        <BoneKnob position={[0, -0.37, 0]} rotation={[Math.PI, 0, 0]} />
      </group>
    </group>
  )
}
