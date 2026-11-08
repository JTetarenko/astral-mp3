import { useFrame, useLoader } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  CircleGeometry,
  Color,
  DoubleSide,
  PlaneGeometry,
  ShaderMaterial,
  TextureLoader,
  type Group,
  type Mesh,
  type MeshBasicMaterial,
  type Sprite,
  type SpriteMaterial,
} from 'three'
import { audioFrame } from '../audio/reactiveBus'
import { snapController } from './snapController'
import { T, visuals } from './visualTuning'
import type { Palette } from '../theme/palettes'

/** Fixed world azimuth (-Z, the spawn facing) at ~30 deg elevation. */
const DIST = 380
const ELEV = Math.PI / 6
const BASE_Y = Math.sin(ELEV) * DIST
const BASE_Z = -Math.cos(ELEV) * DIST
/** Occluder slide span: fully offset at track start, centered at track end. */
const SLIDE = 130

/**
 * The environmental timer: a massive luminary in the murk that a dark occluder
 * disc slowly crosses over the length of the track (visuals.eclipseProgress).
 * Totality — a thin blazing annulus + corona — lands exactly as the run ends.
 * Corona flares ride eclipseGlow (drop charge / impacts / sky flash arrive
 * pre-mixed in visualTuning). The group chases the player's XZ like the sky
 * shells (infinite horizon) but does NOT inherit any sky spin; upward rays
 * through the height fog thin naturally, so it reads through the murk.
 */
export function Eclipse({ palette }: { palette: Palette }) {
  const root = useRef<Group>(null)
  const coronaMat = useRef<SpriteMaterial>(null)
  const corona = useRef<Sprite>(null)
  const luminary = useRef<Mesh>(null)
  const luminaryMat = useRef<MeshBasicMaterial>(null)
  const occluder = useRef<Mesh>(null)
  const occluderMat = useRef<MeshBasicMaterial>(null)

  const rays = useRef<Mesh>(null)
  const [softTex, streakTex] = useLoader(TextureLoader, [
    '/assets/particle_soft.png',
    '/assets/corona_streaks.png',
  ])
  const luminaryGeo = useMemo(() => new CircleGeometry(55, 48), [])
  const occluderGeo = useMemo(() => new CircleGeometry(53.5, 48), [])
  const raysGeo = useMemo(() => new PlaneGeometry(210, 210), [])
  // living corona: two counter-rotated taps of the baked ray sheet, radial
  // breathing on the bar pulse + bass. ClampToEdge zeroes rotated corners.
  const raysMat = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uTex: { value: streakTex },
          uAngle: { value: 0 },
          uColor: { value: new Color('#ffffff') },
          uBreath: { value: 0 },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform sampler2D uTex;
          uniform float uAngle;
          uniform vec3 uColor;
          uniform float uBreath;
          varying vec2 vUv;
          vec2 rot(vec2 p, float a) {
            float c = cos(a);
            float s = sin(a);
            return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
          }
          void main() {
            vec2 p = (vUv - 0.5) / (1.0 + 0.07 * uBreath);
            float t1 = texture2D(uTex, rot(p, uAngle) + 0.5).a;
            float t2 = texture2D(uTex, rot(p, -0.62 * uAngle + 1.7) + 0.5).a;
            gl_FragColor = vec4(uColor * (t1 * 0.75 + t2 * 0.55), 1.0);
          }
        `,
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
      }),
    [streakTex],
  )
  useEffect(() => {
    return () => {
      raysGeo.dispose()
      raysMat.dispose()
    }
  }, [raysGeo, raysMat])

  // 1.7 (was 2.4): recalibrated for the end-of-chain tone transform — the
  // old per-material ACES clamped this to <=1 before bloom ever saw it
  const luminaryTint = useMemo(
    () => new Color(palette.secondary).lerp(new Color('#ffffff'), 0.7).multiplyScalar(1.7),
    [palette],
  )
  const coronaTintA = useMemo(() => new Color(palette.primary), [palette])
  const coronaTintB = useMemo(() => new Color('#ffffff'), [])
  const voidTint = useMemo(
    () => new Color(palette.voidBottom).multiplyScalar(0.55),
    [palette],
  )
  const tmp = useMemo(() => new Color(), [])

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1)
    const g = root.current
    if (!g) return
    const p = snapController.pos
    g.position.set(p.x, 0, p.z)

    const lum = luminary.current
    const occ = occluder.current
    const cor = corona.current
    if (!lum || !occ || !cor) return

    // billboard the discs toward the player so the alignment always reads
    lum.position.set(0, BASE_Y, BASE_Z)
    lum.lookAt(p)
    cor.position.set(0, BASE_Y, BASE_Z)
    const ray = rays.current
    if (ray) {
      ray.position.set(0, BASE_Y, BASE_Z)
      ray.lookAt(p)
    }

    // the occluder slides across the luminary as the track plays out; it sits
    // 4u nearer the player along the view line (in the group's local frame,
    // the player is at (0, p.y, 0)) so depth sorting keeps it on top
    const dy = p.y - BASE_Y
    const dz = -BASE_Z
    const inv = 4 / Math.max(1, Math.hypot(dy, dz))
    const slide = (1 - visuals.eclipseProgress) * SLIDE
    occ.position.set(slide, BASE_Y + dy * inv, BASE_Z + dz * inv)
    occ.lookAt(p)

    if (luminaryMat.current) {
      luminaryMat.current.color.copy(tmp.copy(luminaryTint).multiplyScalar(T(0.8, 0.9, 1.05, 1.15)))
    }
    if (occluderMat.current) occluderMat.current.color.copy(voidTint)
    if (coronaMat.current) {
      // corona whitens with tier and blazes with eclipseGlow; near totality it
      // swells so the final alignment reads as an event, not a fade
      const totality = 0.6 + 0.4 * visuals.eclipseProgress
      coronaMat.current.color
        .copy(tmp.copy(coronaTintA).lerp(coronaTintB, T(0.15, 0.3, 0.5, 0.65)))
        .multiplyScalar(visuals.eclipseGlow * totality)
      cor.scale.setScalar(160 * (1 + 0.25 * (visuals.eclipseGlow - 0.5)))
      // the ray sheet spins (counter-taps in the shader), breathes on the
      // bar + bass, and shares the corona's tint at HDR gain
      const u = raysMat.uniforms
      u.uAngle.value += dt * (0.1 + 0.35 * visuals.eclipseGlow) * (visuals.rm ? 0.35 : 1)
      u.uBreath.value = 0.5 * visuals.breath + 0.5 * audioFrame.bass
      ;(u.uColor.value as Color)
        .copy(tmp.copy(coronaTintA).lerp(coronaTintB, T(0.15, 0.3, 0.5, 0.65)))
        .multiplyScalar(visuals.eclipseGlow * totality * 1.6)
    }
  })

  return (
    <group ref={root}>
      <mesh ref={rays} position={[0, BASE_Y, BASE_Z]} geometry={raysGeo} material={raysMat} renderOrder={1} />
      <sprite ref={corona} position={[0, BASE_Y, BASE_Z]} scale={[160, 160, 1]} renderOrder={1}>
        <spriteMaterial
          ref={coronaMat}
          map={softTex}
          blending={AdditiveBlending}
          transparent
          depthWrite={false}
          fog={false}
          toneMapped={false}
        />
      </sprite>
      <mesh ref={luminary} geometry={luminaryGeo} renderOrder={2}>
        <meshBasicMaterial
          ref={luminaryMat}
          color={luminaryTint}
          transparent
          depthWrite={false}
          fog={false}
          toneMapped={false}
        />
      </mesh>
      <mesh ref={occluder} geometry={occluderGeo} renderOrder={3}>
        <meshBasicMaterial
          ref={occluderMat}
          color={voidTint}
          transparent
          depthWrite={false}
          fog={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  )
}
