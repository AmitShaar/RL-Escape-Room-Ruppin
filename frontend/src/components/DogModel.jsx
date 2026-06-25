import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

const FUR = '#1C9C94'
const BELLY = '#5FCFC4'
const DARK = '#0B2E2C'
const EYE_COLOR = '#0B2E2C'
const EYE_SHINE = '#FFFFFF'
const ACCENT = '#107D78' // ears, paws — darker than the main coat
const EDGE_COLOR = '#FFFFFF' // low-poly facet outline, like the puzzle reference
const HELMET_GLASS = '#88CCFF'
const HELMET_RIM = '#4499DD'

const TRAIL_LENGTH = 8

// Low-poly "gem" look: flat-shaded faceted geometry plus a white edge
// outline traced from the geometry itself (rather than a full wireframe,
// which would also draw distracting internal diagonals at higher detail).
function Part({ geometry, color, position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1], edges = true }) {
  const edgesGeo = useMemo(() => (edges ? new THREE.EdgesGeometry(geometry) : null), [geometry, edges])
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <mesh geometry={geometry}>
        <meshStandardMaterial color={color} roughness={0.6} metalness={0.05} flatShading />
      </mesh>
      {edgesGeo && (
        <lineSegments geometry={edgesGeo}>
          <lineBasicMaterial color={EDGE_COLOR} />
        </lineSegments>
      )}
    </group>
  )
}

const LEG_X = 0.18
const LEG_FRONT_Z = 0.2
const LEG_BACK_Z = -0.2
const LEG_FRONT_LEN = 0.3
const LEG_BACK_LEN = 0.28

// [x, frontOrBack, leftOrRight] driving both the leg cylinder and its paw.
const LEGS = [
  { key: 'FL', x: -LEG_X, z: LEG_FRONT_Z, len: LEG_FRONT_LEN },
  { key: 'FR', x: LEG_X, z: LEG_FRONT_Z, len: LEG_FRONT_LEN },
  { key: 'BL', x: -LEG_X, z: LEG_BACK_Z, len: LEG_BACK_LEN },
  { key: 'BR', x: LEG_X, z: LEG_BACK_Z, len: LEG_BACK_LEN },
]

export default function DogModel({ position = [0, 0.4, 0], isMoving = null }) {
  const bodyGroupRef = useRef()
  const helmetGroupRef = useRef()
  const tailRef = useRef()
  const legRefs = [useRef(), useRef(), useRef(), useRef()]
  const trailRef = useRef([])
  const prevPos = useRef(position)
  const autoMovingRef = useRef(false)

  const geo = useMemo(
    () => ({
      body: new THREE.IcosahedronGeometry(0.42, 1),
      head: new THREE.IcosahedronGeometry(0.3, 1),
      snout: new THREE.IcosahedronGeometry(0.14, 0),
      nose: new THREE.IcosahedronGeometry(0.055, 0),
      eye: new THREE.IcosahedronGeometry(0.055, 0),
      eyeShine: new THREE.IcosahedronGeometry(0.02, 0),
      earBase: new THREE.IcosahedronGeometry(0.1, 0),
      earTip: new THREE.IcosahedronGeometry(0.07, 0),
      tailSeg: [
        new THREE.IcosahedronGeometry(0.09, 0),
        new THREE.IcosahedronGeometry(0.07, 0),
        new THREE.IcosahedronGeometry(0.05, 0),
      ],
      leg: { FL: null, FR: null, BL: null, BR: null }, // built below per-length
      paw: new THREE.IcosahedronGeometry(0.1, 0),
      helmetGlass: new THREE.SphereGeometry(0.38, 24, 20),
      helmetRim: new THREE.TorusGeometry(0.32, 0.03, 6, 16),
    }),
    []
  )

  const legGeo = useMemo(
    () => ({
      FL: new THREE.CylinderGeometry(0.08, 0.07, LEG_FRONT_LEN, 6),
      FR: new THREE.CylinderGeometry(0.08, 0.07, LEG_FRONT_LEN, 6),
      BL: new THREE.CylinderGeometry(0.08, 0.07, LEG_BACK_LEN, 6),
      BR: new THREE.CylinderGeometry(0.08, 0.07, LEG_BACK_LEN, 6),
    }),
    []
  )

  const legEdgesGeo = useMemo(
    () => Object.fromEntries(Object.entries(legGeo).map(([key, g]) => [key, new THREE.EdgesGeometry(g)])),
    [legGeo]
  )

  useEffect(() => {
    const prev = prevPos.current
    const dx = position[0] - prev[0]
    const dz = position[2] - prev[2]
    const moved = Math.abs(dx) > 1e-5 || Math.abs(dz) > 1e-5
    autoMovingRef.current = moved
    if (moved && bodyGroupRef.current) {
      bodyGroupRef.current.userData.targetYaw = Math.atan2(dx, dz)
    }
    trailRef.current = [...trailRef.current, prev].slice(-TRAIL_LENGTH)
    prevPos.current = position
  }, [position])

  useFrame(({ clock }, delta) => {
    const t = clock.elapsedTime
    const moving = isMoving != null ? isMoving : autoMovingRef.current

    if (bodyGroupRef.current) {
      bodyGroupRef.current.position.set(position[0], position[1] + Math.sin(t * 1.5) * 0.04, position[2])
      const targetYaw = bodyGroupRef.current.userData.targetYaw
      if (targetYaw != null) {
        const current = bodyGroupRef.current.rotation.y
        let diff = targetYaw - current
        diff = Math.atan2(Math.sin(diff), Math.cos(diff))
        bodyGroupRef.current.rotation.y = current + diff * Math.min(1, delta * 8)
      }
    }

    // Helmet floats with the body but its rotation lags slightly behind,
    // giving it a bit of weighty inertia instead of snapping to face the
    // same way as the body every frame.
    if (helmetGroupRef.current && bodyGroupRef.current) {
      helmetGroupRef.current.position.copy(bodyGroupRef.current.position)
      const targetRotY = bodyGroupRef.current.rotation.y
      const current = helmetGroupRef.current.rotation.y
      let diff = targetRotY - current
      diff = Math.atan2(Math.sin(diff), Math.cos(diff))
      helmetGroupRef.current.rotation.y = current + diff * Math.min(1, delta * 3)
    }

    if (tailRef.current) {
      tailRef.current.rotation.z = Math.sin(t * 4) * 0.5
    }

    legRefs.forEach((ref, i) => {
      if (!ref.current) return
      if (moving) {
        const diagonal = i === 0 || i === 3 ? 1 : -1 // FL+BR vs FR+BL swing opposite
        ref.current.rotation.x = Math.sin(t * 8) * 0.35 * diagonal
      } else {
        ref.current.rotation.x = 0
      }
    })
  })

  const headPos = [0, 0.28, 0.35]
  const helmetCenter = [0, 0.3, 0.18]

  return (
    <>
      <group ref={bodyGroupRef} position={position}>
        <Part geometry={geo.body} color={FUR} scale={[1, 0.75, 1]} />
        <Part geometry={geo.head} color={FUR} position={headPos} />
        <Part geometry={geo.snout} color={BELLY} position={[0, headPos[1] - 0.04, headPos[2] + 0.23]} scale={[1, 1, 0.75]} />
        <Part geometry={geo.nose} color={DARK} position={[0, headPos[1] - 0.04, headPos[2] + 0.35]} edges={false} />
        <Part geometry={geo.eye} color={EYE_COLOR} position={[-0.12, headPos[1] + 0.08, headPos[2] + 0.17]} edges={false} />
        <Part geometry={geo.eye} color={EYE_COLOR} position={[0.12, headPos[1] + 0.08, headPos[2] + 0.17]} edges={false} />
        <Part geometry={geo.eyeShine} color={EYE_SHINE} position={[-0.1, headPos[1] + 0.1, headPos[2] + 0.205]} edges={false} />
        <Part geometry={geo.eyeShine} color={EYE_SHINE} position={[0.1, headPos[1] + 0.1, headPos[2] + 0.205]} edges={false} />

        <Part geometry={geo.earBase} color={ACCENT} position={[-0.2, headPos[1] + 0.2, headPos[2] - 0.05]} />
        <Part geometry={geo.earTip} color={ACCENT} position={[-0.25, headPos[1] + 0.3, headPos[2] - 0.01]} />
        <Part geometry={geo.earBase} color={ACCENT} position={[0.2, headPos[1] + 0.2, headPos[2] - 0.05]} />
        <Part geometry={geo.earTip} color={ACCENT} position={[0.25, headPos[1] + 0.3, headPos[2] - 0.01]} />

        <group ref={tailRef} position={[0, 0.18, -0.4]}>
          <Part geometry={geo.tailSeg[0]} color={FUR} position={[0, 0, 0]} />
          <Part geometry={geo.tailSeg[1]} color={FUR} position={[0, 0.08, -0.05]} />
          <Part geometry={geo.tailSeg[2]} color={FUR} position={[0, 0.15, -0.07]} />
        </group>

        {LEGS.map((leg, i) => (
          <group key={leg.key} ref={legRefs[i]} position={[leg.x, -leg.len, leg.z]}>
            <mesh geometry={legGeo[leg.key]}>
              <meshStandardMaterial color={FUR} roughness={0.6} metalness={0.05} flatShading />
            </mesh>
            <lineSegments geometry={legEdgesGeo[leg.key]}>
              <lineBasicMaterial color={EDGE_COLOR} />
            </lineSegments>
          </group>
        ))}
        {LEGS.map((leg) => (
          <Part
            key={`paw-${leg.key}`}
            geometry={geo.paw}
            color={ACCENT}
            position={[leg.x, -leg.len * 2 + 0.02, leg.z]}
            scale={[1, 0.6, 1]}
          />
        ))}
      </group>

      <group ref={helmetGroupRef} position={position}>
        <mesh geometry={geo.helmetGlass} position={helmetCenter}>
          <meshPhysicalMaterial
            color={HELMET_GLASS}
            transparent
            opacity={0.18}
            roughness={0}
            metalness={0.1}
            transmission={0.9}
          />
        </mesh>
        <mesh geometry={geo.helmetRim} position={helmetCenter} rotation={[Math.PI / 2, 0, 0]}>
          <meshStandardMaterial color={HELMET_RIM} metalness={0.8} roughness={0.2} flatShading />
        </mesh>
      </group>

      {trailRef.current.map((p, i) => (
        <mesh key={i} position={p}>
          <sphereGeometry args={[Math.max(0.03, 0.09 - i * 0.01), 8, 8]} />
          <meshStandardMaterial color={HELMET_GLASS} transparent opacity={0.12 + i * 0.04} />
        </mesh>
      ))}
    </>
  )
}
