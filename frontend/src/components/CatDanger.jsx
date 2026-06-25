import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

const CAT_BODY = '#1a1a22'
const CAT_EYE = '#ffaa00'
const EDGE_COLOR = '#ffffff'

// A tiny low-poly "gem" cat (same faceted/edge-outline style as DogModel),
// marking trap cells - מיני enough to read as a small creature sitting on
// the tile rather than a second dog-sized character.
function Part({ geometry, color, position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1], emissive }) {
  const edgesGeo = useMemo(() => new THREE.EdgesGeometry(geometry), [geometry])
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <mesh geometry={geometry}>
        <meshStandardMaterial
          color={color}
          roughness={0.6}
          metalness={0.05}
          flatShading
          emissive={emissive || '#000000'}
          emissiveIntensity={emissive ? 0.8 : 0}
        />
      </mesh>
      <lineSegments geometry={edgesGeo}>
        <lineBasicMaterial color={EDGE_COLOR} />
      </lineSegments>
    </group>
  )
}

export default function CatDanger({ position = [0, 0, 0] }) {
  const groupRef = useRef()
  const tailRef = useRef()

  const geo = useMemo(
    () => ({
      body: new THREE.IcosahedronGeometry(0.16, 0),
      head: new THREE.IcosahedronGeometry(0.12, 0),
      earL: new THREE.ConeGeometry(0.05, 0.1, 4),
      earR: new THREE.ConeGeometry(0.05, 0.1, 4),
      tail: new THREE.ConeGeometry(0.025, 0.22, 5),
      eye: new THREE.IcosahedronGeometry(0.018, 0),
    }),
    []
  )

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    if (groupRef.current) {
      groupRef.current.position.y = position[1] + Math.sin(t * 1.8) * 0.015
    }
    if (tailRef.current) {
      tailRef.current.rotation.z = Math.sin(t * 2.2) * 0.25
    }
  })

  return (
    <group ref={groupRef} position={position}>
      <Part geometry={geo.body} color={CAT_BODY} scale={[1, 0.8, 1.2]} />
      <Part geometry={geo.head} color={CAT_BODY} position={[0, 0.13, 0.12]} />
      <Part geometry={geo.earL} color={CAT_BODY} position={[-0.07, 0.23, 0.1]} rotation={[0, 0, -0.3]} />
      <Part geometry={geo.earR} color={CAT_BODY} position={[0.07, 0.23, 0.1]} rotation={[0, 0, 0.3]} />
      <Part geometry={geo.eye} color={CAT_EYE} position={[-0.045, 0.14, 0.21]} emissive={CAT_EYE} />
      <Part geometry={geo.eye} color={CAT_EYE} position={[0.045, 0.14, 0.21]} emissive={CAT_EYE} />
      <group ref={tailRef} position={[0, 0.08, -0.18]}>
        <Part geometry={geo.tail} color={CAT_BODY} rotation={[Math.PI / 2.3, 0, 0]} />
      </group>
    </group>
  )
}
