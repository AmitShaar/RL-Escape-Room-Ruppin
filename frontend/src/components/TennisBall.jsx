import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { CatmullRomCurve3, Vector3 } from 'three'

const R = 0.28  // ball radius

// Tennis ball seam = two S-curves, each a great circle tilted ~35° from equatorial.
// We trace points along a parametric path on the sphere surface.
function seamPoints(phaseOffset = 0, n = 60) {
  const pts = []
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2
    // tilt creates the characteristic S-curve
    const tilt = 0.62   // ~35 degrees — controls S-depth
    const x = R * Math.cos(t)
    const y = R * Math.sin(t) * Math.sin(tilt + phaseOffset)
    const z = R * Math.sin(t) * Math.cos(tilt + phaseOffset)
    pts.push(new Vector3(x, y, z))
  }
  return pts
}

export default function TennisBall({ position = [0, 0, 0] }) {
  const ref = useRef()

  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.rotation.y = clock.elapsedTime * 1.8
      ref.current.rotation.x = clock.elapsedTime * 0.7
    }
  })

  // Build seam tube geometry from the parametric path
  const seam1 = useMemo(() => {
    const curve = new CatmullRomCurve3(seamPoints(0), true)
    return curve
  }, [])

  const seam2 = useMemo(() => {
    const curve = new CatmullRomCurve3(seamPoints(Math.PI), true)
    return curve
  }, [])

  return (
    <group ref={ref} position={position}>
      {/* Main ball — vivid lime-yellow, fuzzy feel */}
      <mesh>
        <sphereGeometry args={[R, 36, 28]} />
        <meshStandardMaterial
          color="#b8f000"
          emissive="#6a8800"
          emissiveIntensity={0.18}
          roughness={0.82}
          metalness={0.0}
        />
      </mesh>

      {/* Seam 1 */}
      <mesh>
        <tubeGeometry args={[seam1, 80, 0.016, 8, true]} />
        <meshStandardMaterial color="#f2f2f2" emissive="#ffffff" emissiveIntensity={0.25} roughness={0.4} />
      </mesh>

      {/* Seam 2 — mirror seam, offset by π → creates the figure-8 pattern */}
      <mesh>
        <tubeGeometry args={[seam2, 80, 0.016, 8, true]} />
        <meshStandardMaterial color="#f2f2f2" emissive="#ffffff" emissiveIntensity={0.25} roughness={0.4} />
      </mesh>
    </group>
  )
}
