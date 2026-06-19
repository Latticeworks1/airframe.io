# HUD and Sky Architecture

Status: cockpit overlay redesign, HUD frame-path cleanup, atmospheric sky, instanced near clouds, post-processing effects, FPS instrumentation, and HSI implemented.

## Practical assessment of the HUD review

The review identified real problems, but not every proposed technology is required.

Confirmed problems:

- `App.tsx` previously performed multiple React state updates every animation frame.
- Lead-marker movement used React props and `left`/`top`.
- Hitmarker and damage animations injected `<style>` elements conditionally.
- `GameHUD` duplicated target-selection vector math already performed by `WorldRenderer`.
- Ammo status used text glyphs instead of a scalable visual bar.
- Animated CSS blur overlays remain unsuitable for a final high-performance damage system.

Not currently justified:

- `SharedArrayBuffer` and WASM do not help by themselves while the simulation and renderer already run on the browser main thread.
- WebGPU is not required for simple HUD markers. Direct compositor transforms are sufficient.
- Moving the current small target scan to a compute shader would add more complexity than useful work. The correct architectural fix was to remove the duplicate scan from React and use the renderer's existing target result.

## Current HUD update model

React now owns low-frequency readable state:

- pilot telemetry,
- scores,
- timer,
- zones,
- kill feed,
- static HUD layout.

`App.tsx` publishes one consolidated `HudSnapshot` every 80 ms, or 12.5 Hz. This replaces seven independent state updates that previously ran every animation frame.

Animation-rate targeting data bypasses React:

1. `WorldRenderer` projects target and lead positions.
2. `App.tsx` reads `renderer3D.leadIndicator2D` after rendering state is updated.
3. Persistent HUD elements are moved with `translate3d(...)`.
4. Marker visibility and distance text are updated directly.

This keeps target motion on the compositor path without requiring another canvas library.

Relevant files:

- `src/App.tsx`
- `src/components/GameHUD.tsx`
- `src/index.css`

## HUD changes

### Cockpit overlay

The original nearly opaque full-screen mask was replaced with:

- a low-profile lower glare shield,
- short lower canopy rails,
- an open upper and peripheral view,
- a compact centered telemetry strip.

### Lead projector

The lead and target markers are always mounted. Their transforms and visibility are updated directly at frame rate.

Dynamic `left` and `top` positioning is no longer used for target motion.

### Target selection

The `GameHUD` target-scanning `useEffect` was removed. `WorldRenderer` remains the single producer of projected target information.

### CSS animations

Hitmarker and damage-flash keyframes now live in `src/index.css`. No `<style>` element is injected during combat.

### Ammo display

ASCII block characters were replaced with a transform-scaled visual bar.

## Renderer post-processing

The oil and damage overlays no longer use blurred HTML elements.

`src/game/screenEffects.ts` now:

1. renders the world into a `WebGLRenderTarget`,
2. composites the world through one full-screen shader,
3. triggers damage tint, vignette, and chromatic separation from actual component-health deltas,
4. derives oil distortion from `Pilot.damage.hasOilLeak`,
5. adds cloud-entry haze from the near-cloud volume field,
6. resizes with the renderer,
7. disposes its target, geometry, and material during cleanup.

PixiJS or a second canvas should only be introduced if the HUD grows into hundreds of animated sprites. The current marker workload does not justify another rendering runtime.

## Atmospheric sky integration

The atmospheric sky is implemented in:

- `src/game/skyDome.ts`
- `src/game/worldRenderer.ts`

The insertion point is `WorldRenderer.init()`, after camera/lights are initialized and before terrain and cloud construction:

```text
scene + camera
    -> renderer
    -> lights
    -> shader sky dome
    -> terrain
    -> volumetric block clouds
    -> map tiles
```

The existing `scene.background` color remains as a fallback. Existing scene fog remains separate and continues to blend distant world geometry toward the map fog color.

## Sky dome behavior

The sky:

- uses the official Three.js `Sky` WebGL addon,
- uses Preetham atmospheric scattering,
- follows the camera position so the aircraft can never reach its edge,
- does not write depth,
- renders before world geometry,
- configures turbidity, Rayleigh scattering, Mie scattering, sun elevation, and sun azimuth per map,
- uses the addon's cloud-plane projection for distant cloud coverage,
- hides the sun disc and increases atmospheric density for `Storm Front`,
- disposes its geometry and material during renderer cleanup.

## Near-cloud field

The old near-cloud implementation created many groups of large opaque boxes. That path was removed.

`src/game/cloudField.ts` now creates:

- deterministic cloud placement per map,
- one `InstancedMesh`,
- soft camera-facing procedural puffs,
- map-specific bright and shadow colors,
- distance/fog fading,
- one nearby cloud-volume list for fly-through density checks,
- one draw call for all near-cloud puffs.

The screen-effects pass samples the same volume field. Entering a cloud produces a gradual full-screen haze instead of exposing billboard intersections.

This hybrid is the selected quality/performance tradeoff:

- official atmospheric scattering and distant cloud plane,
- instanced impostors for nearby parallax,
- post-process haze for cloud interiors.

Full volumetric raymarching was not selected as the default because it requires many density samples per pixel and would stack on top of the existing full-resolution post-process pass. It remains a possible high-quality graphics option for stronger GPUs.

## Performance instrumentation

The in-game counter is a static HUD node updated directly every 500 ms. It reports:

- frames per second,
- average frame time,
- renderer draw calls.

It does not update through React.

Relevant files:

- `src/App.tsx`
- `src/components/GameHUD.tsx`
- `src/game/worldRenderer.ts`

## Horizontal situation indicator

The HSI uses the game's existing world-axis contract:

- local/world `+Z` is north,
- `+X` is east,
- aircraft yaw supplies heading.

It displays:

- rotating compass card,
- heading lubber line,
- bearing pointer to the nearest zone not owned by the player's team,
- objective identifier,
- bearing,
- horizontal range,
- capture progress.

Because the HSI is driven by the 12.5 Hz HUD snapshot, it does not add animation-rate React work.

## Verification

Completed:

- `npm run lint`
- `npm run build`
- static check for removed per-frame React setters
- static check for removed dynamic `<style>` injection
- static check for removed ASCII ammo rendering
- static check for shader dome creation, update, and cleanup
- static check that the old box-cloud builder is removed
- static check that near clouds use one `InstancedMesh`
- static check for cloud-volume sampling into post-processing
- static check for direct-update FPS instrumentation
- static check for HSI heading/bearing calculations

Build note:

- Vite still reports the existing main-bundle size warning above 500 kB.

Manual checks still required:

- cockpit overlay composition at 16:9, ultrawide, and narrow windows,
- lead-marker alignment after resizing,
- shader compilation and appearance on target GPUs,
- horizon/fog matching on all four maps,
- storm sky darkness and sun suppression,
- near-cloud alpha ordering from multiple view angles,
- cloud-entry haze strength,
- FPS and draw-call readings on target devices,
- HSI bearing correctness against known zone positions,
- first-person visibility against bright sky values.
