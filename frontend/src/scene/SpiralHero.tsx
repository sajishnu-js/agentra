import { Environment, Sparkles } from '@react-three/drei'
import { EffectComposer, Bloom, GodRays, Vignette, ChromaticAberration } from '@react-three/postprocessing'
import { BlendFunction } from 'postprocessing'
import { useMemo, useState } from 'react'

import { scenePalettes } from '@/theme/accentPalettes'
import { useTheme } from '@/theme/ThemeProvider'
import {
  CameraRig,
  SceneShell,
  THREE,
  usePageBackground,
  useThree,
  type Pointer,
} from './cinematic'
import { SpiralKnot, type SpinBoost } from './SpiralKnot'

/**
 * The landing hero: a chrome spiral standing in front of a single light
 * source, in fog.
 *
 * In dark mode a real god-rays pass traces the light the coil blocks, so the
 * shafts radiating past it *are* its own occlusion and they move as it
 * turns. Light mode drops that pass entirely — god rays need the source to
 * out-shine its surroundings, and on a pale page there is nothing for them
 * to stand out against; what's left is a clean product-render chrome, which
 * is the right register for a light page anyway.
 */

/** How far the camera itself travels with the pointer. */
const DRIFT = 0.45

/**
 * How far the spiral *appears* to move as a result of that drift.
 *
 * Much less than DRIFT, because `CameraRig` re-aims at a fixed look target
 * every frame — so the camera swings rather than slides, and a subject near
 * that target barely translates on screen. Measured, not derived: sweeping
 * the pointer corner to corner moves the coil 90px at 1600 wide, which is
 * 0.40 world units peak-to-peak, so ±0.20.
 *
 * Reserving the full DRIFT instead left a ~17% dead strip down the right of
 * the frame that nothing ever occupied.
 */
const APPARENT_DRIFT = 0.2

/**
 * Bounding radius of torusKnot(1, 0.34).
 *
 * Not a guess: THREE's curve for p=2,q=3 is `(2 + cos(3u/2)) * 0.5` scaled by
 * the radius, which peaks at 1.5, plus the 0.34 tube. Getting this wrong is
 * exactly how the coil ends up clipped at one edge — an earlier value of 1.42
 * under-reported it by a third and the clamp let it run off the right.
 */
const KNOT_EXTENT = 1.84

/**
 * The box the spiral is allowed to occupy on desktop, as fractions of the
 * viewport, at its furthest drift in every direction.
 *
 * Stated as the answer rather than derived from a pile of margins: the
 * previous "centre it in the leftover band, minus a few subtractions"
 * version made it very hard to see where the coil would actually land, and
 * it quietly under-filled the frame. These four numbers are the frame.
 *
 * `left` clears the copy column (whose longest line ends near 40%); `top`
 * clears the theme controls in the header; `bottom` leaves the smoke bank
 * room to read.
 */
const BOX = { left: 0.455, right: 0.98, top: 0.11, bottom: 0.97 }

function useLayout(stackedBreakpoint = 1024) {
  const { size, viewport } = useThree()
  return useMemo(() => {
    const stacked = size.width < stackedBreakpoint
    const halfW = viewport.width / 2
    const halfH = viewport.height / 2

    if (stacked) {
      // Pinned into a fixed band across the top of the viewport — between 4%
      // and 34% down — and sized to fit it. Solving for the band rather than
      // just capping the scale is what keeps the copy clear at *every* narrow
      // ratio: a phone runs out of width first and a tablet runs out of
      // nothing, so a height-fraction cap alone let the coil grow down over
      // the headline on the wider of the two. The copy's matching top padding
      // is set in Landing.tsx.
      const yTop = halfH - 0.04 * viewport.height
      const yBottom = halfH - 0.34 * viewport.height
      const scale = Math.min(
        0.8,
        (halfW - 0.14) / KNOT_EXTENT,
        (yTop - yBottom) / 2 / KNOT_EXTENT,
      )
      return { stacked, scale, x: 0, y: (yTop + yBottom) / 2 }
    }

    // Desktop: fit the spiral to BOX, in both axes, at full drift. Solved
    // against the live viewport rather than fixed coordinates — the same
    // position that clears the edge at 16:9 clips badly at 4:3, and this page
    // has to survive both.
    const left = viewport.width * (BOX.left - 0.5)
    const right = viewport.width * (BOX.right - 0.5)
    // Screen y runs down, world y runs up, so top maps to the larger value.
    const top = halfH - BOX.top * viewport.height
    const bottom = halfH - BOX.bottom * viewport.height

    // Vertical drift is 0.6x horizontal — see CameraRig.
    const fitX = (right - left) / 2 - APPARENT_DRIFT
    const fitY = (top - bottom) / 2 - APPARENT_DRIFT * 0.6
    const scale = Math.max(0.4, Math.min(1.05, fitX / KNOT_EXTENT, fitY / KNOT_EXTENT))

    return { stacked, scale, x: (left + right) / 2, y: (top + bottom) / 2 }
  }, [size.width, viewport.width, viewport.height, stackedBreakpoint])
}

function Grade({ sun }: { sun: THREE.Mesh | null }) {
  const { theme } = useTheme()
  const light = theme === 'light'

  return (
    // Bespoke rather than the shared CinemaGrade: god rays have to run before
    // bloom, or bloom blows the source out and there is no clean edge left
    // for the rays to radiate from.
    //
    // `autoClear={false}` is required by GodRays — it renders an internal
    // extra pass, and with auto-clear on that pass wipes the buffer, so
    // occlusion by the spiral comes out wrong.
    <EffectComposer multisampling={0} autoClear={false}>
      {sun && !light ? (
        <GodRays
          sun={sun}
          density={0.96}
          decay={0.94}
          weight={0.52}
          exposure={0.26}
          samples={60}
          clampMax={0.9}
          blur
        />
      ) : (
        <></>
      )}
      <Bloom
        intensity={light ? 0.42 : 1.05}
        radius={0.8}
        luminanceThreshold={light ? 0.68 : 0.22}
        luminanceSmoothing={0.5}
        mipmapBlur
      />
      <ChromaticAberration
        offset={new THREE.Vector2(0.0006, 0.0006)}
        blendFunction={BlendFunction.NORMAL}
        radialModulation
        modulationOffset={0.4}
      />
      <Vignette eskil={false} offset={0.25} darkness={light ? 0.22 : 0.78} />
    </EffectComposer>
  )
}

function Scene({ pointer, boost }: { pointer: Pointer; boost: SpinBoost }) {
  const { accent, theme } = useTheme()
  const p = scenePalettes[accent]
  const light = theme === 'light'
  const bg = usePageBackground()
  const { stacked, scale, x, y } = useLayout()

  // GodRays needs the mesh instance, not a ref object — a callback ref held
  // in state is the standard way to hand it over once mounted.
  const [sun, setSun] = useState<THREE.Mesh | null>(null)

  return (
    <>
      {/* Painted with the page's *own* resolved background rather than left
          transparent. The hero still follows the theme — `bg` is read off the
          live computed style — but the god-rays pass needs an opaque scene to
          sample; over an alpha canvas it drops the WebGL context outright.
          Fog uses the same colour, so depth fades into the page. */}
      <color attach="background" args={[bg]} />
      <fog attach="fog" args={[bg, light ? 9 : 8, light ? 30 : 26]} />

      <ambientLight intensity={light ? 0.55 : 0.18} />
      <spotLight
        position={[6, 6, 5]}
        angle={0.55}
        penumbra={1}
        intensity={light ? 140 : 90}
        color={p.primary}
      />
      <spotLight
        position={[-7, -2, 4]}
        angle={0.6}
        penumbra={1}
        intensity={light ? 100 : 70}
        color={p.secondary}
      />
      <Environment preset="city" environmentIntensity={light ? 0.85 : 0.45} />

      {/* The source, tucked behind the spiral so the coil eclipses it. Small
          and set well back: god rays radiate *from* the source, so a large
          near one just fills the middle of the frame with white and leaves no
          room to read the shafts it is meant to be throwing. */}
      <mesh ref={setSun} position={[x, y + 0.1, -6.5]} scale={stacked ? 0.7 : 1}>
        <sphereGeometry args={[0.26, 32, 32]} />
        <meshBasicMaterial
          color={light ? p.primary : p.tintLighter}
          toneMapped={false}
          transparent
          opacity={light ? 0.55 : 1}
        />
      </mesh>

      <SpiralKnot pointer={pointer} boost={boost} position={[x, y, 0]} scale={scale}>
        {/* Polished metal. `color` tints the reflected environment — on a
            fully metallic surface there is no diffuse term, so this is the
            only thing making the chrome brown or green rather than grey.
            Darkened in light mode: a bright mirror on a bright page has no
            silhouette left. */}
        <meshStandardMaterial
          color={light ? p.primaryDark : p.tintLight}
          metalness={1}
          roughness={light ? 0.14 : 0.09}
          envMapIntensity={light ? 1.15 : 1.8}
        />
      </SpiralKnot>

      {/* Dust in the beams. Without something suspended in it, volumetric
          light has nothing to land on and reads as a flat gradient. */}
      <Sparkles
        count={90}
        scale={[7, 6, 5]}
        position={[x, y, -1]}
        size={2}
        speed={0.16}
        opacity={light ? 0.25 : 0.45}
        color={light ? p.primary : p.tintLighter}
      />

      {/* Aimed straight down the axis, not at the subject.
          `look` was previously a fraction of the spiral's own position, which
          rotated the camera — and a rotated camera means world x no longer
          maps linearly to screen x. The BOX maths above then placed the coil
          ~8% left of where it claimed to, which is exactly what left a dead
          strip down the right of the frame. Looking at the origin keeps the
          mapping honest; the parallax is unaffected, since it comes from the
          camera translating and re-aiming, not from where it aims. */}
      <CameraRig pointer={pointer} depth={DRIFT} />
      <Grade sun={sun} />
    </>
  )
}

export function SpiralHero({ pointer, boost }: { pointer: Pointer; boost: SpinBoost }) {
  return (
    <SceneShell camera={{ position: [0, 0, 6.2], fov: 40 }}>
      <Scene pointer={pointer} boost={boost} />
    </SceneShell>
  )
}
