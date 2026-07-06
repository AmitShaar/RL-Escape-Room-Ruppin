// Procedural 3D burger — no external assets needed.

function Seed({ position, rotY = 0 }) {
  return (
    <mesh position={position} rotation={[0.4, rotY, 0]} scale={[1, 0.45, 0.6]}>
      <sphereGeometry args={[0.036, 7, 5]} />
      <meshStandardMaterial color="#F0EAD2" roughness={0.75} />
    </mesh>
  )
}

// Wavy lettuce made from overlapping flat arcs
function Lettuce() {
  const color = '#2E8B2E'
  const mat = <meshStandardMaterial color={color} emissive="#164a16" emissiveIntensity={0.2} roughness={0.85} />
  const leaves = [0, 45, 90, 135, 180, 225, 270, 315].map((deg, i) => {
    const r = deg * Math.PI / 180
    const waveY = Math.sin(i * 1.3) * 0.012
    return (
      <mesh key={i} position={[Math.cos(r) * 0.22, waveY, Math.sin(r) * 0.22]}
        rotation={[Math.PI / 2 + Math.sin(i) * 0.3, r, 0]}
        scale={[1, 1, 0.7]}>
        <sphereGeometry args={[0.065, 7, 5]} />
        {mat}
      </mesh>
    )
  })
  return <group position={[0, 0.06, 0]}>{leaves}</group>
}

export default function Steak3D({ position = [0, 0, 0] }) {
  return (
    <group position={position}>

      {/* ── Top bun — golden dome ── */}
      <mesh position={[0, 0.22, 0]} scale={[1, 0.68, 1]}>
        <sphereGeometry args={[0.27, 28, 18]} />
        <meshStandardMaterial color="#D4701A" emissive="#6a3000" emissiveIntensity={0.22} roughness={0.55} metalness={0.02} />
      </mesh>
      {/* Bottom rim of top bun */}
      <mesh position={[0, 0.09, 0]}>
        <cylinderGeometry args={[0.27, 0.27, 0.045, 24]} />
        <meshStandardMaterial color="#C06010" emissive="#5a2800" emissiveIntensity={0.2} roughness={0.6} />
      </mesh>

      {/* ── Sesame seeds ── */}
      <Seed position={[ 0.00, 0.36, 0.18]} rotY={0.1} />
      <Seed position={[ 0.16, 0.38, 0.09]} rotY={1.2} />
      <Seed position={[ 0.18, 0.38,-0.08]} rotY={2.2} />
      <Seed position={[ 0.06, 0.39,-0.17]} rotY={3.0} />
      <Seed position={[-0.12, 0.38,-0.12]} rotY={3.8} />
      <Seed position={[-0.18, 0.37, 0.04]} rotY={4.5} />
      <Seed position={[-0.08, 0.37, 0.16]} rotY={5.2} />
      <Seed position={[ 0.09, 0.40, 0.04]} rotY={0.6} />

      {/* ── Lettuce ── */}
      <Lettuce />

      {/* ── Tomato ── */}
      <mesh position={[0, 0.02, 0]}>
        <cylinderGeometry args={[0.21, 0.21, 0.045, 22]} />
        <meshStandardMaterial color="#CC2828" emissive="#7a0808" emissiveIntensity={0.18} roughness={0.6} />
      </mesh>

      {/* ── Cheese — yellow square peeking out ── */}
      <mesh position={[0, -0.018, 0]} rotation={[0, Math.PI / 8, 0]}>
        <boxGeometry args={[0.46, 0.022, 0.46]} />
        <meshStandardMaterial color="#F0C020" emissive="#7a5800" emissiveIntensity={0.18} roughness={0.5} />
      </mesh>

      {/* ── Patty ── */}
      <mesh position={[0, -0.065, 0]}>
        <cylinderGeometry args={[0.215, 0.235, 0.085, 22]} />
        <meshStandardMaterial color="#3A1A08" emissive="#1a0800" emissiveIntensity={0.1} roughness={0.95} />
      </mesh>
      {/* Seared top ring for realism */}
      <mesh position={[0, -0.022, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.19, 0.025, 6, 20]} />
        <meshStandardMaterial color="#5A2A08" roughness={0.98} />
      </mesh>

      {/* ── Bottom bun ── */}
      <mesh position={[0, -0.135, 0]} scale={[1, 0.42, 1]}>
        <sphereGeometry args={[0.26, 24, 16]} />
        <meshStandardMaterial color="#C86010" emissive="#5a2800" emissiveIntensity={0.18} roughness={0.58} />
      </mesh>

    </group>
  )
}
