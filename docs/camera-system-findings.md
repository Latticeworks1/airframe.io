# Camera System Findings

Status: implementation complete. Automated checks pass; interactive browser verification remains pending.

The diagnosis below is retained as a record of the original defects. Code snippets and line references in the root-cause sections describe the pre-fix implementation.

## Implementation result

- Camera mode is now changed through one application setter backed by a current-value ref.
- The RAF loop no longer writes captured camera state back into the renderer.
- Each frame samples one `InputFrame`, shares it between simulation and rendering, and clears transient input afterward.
- Pausing stops simulation but no longer stops camera or scene rendering.
- Mode changes reset free-look state and initialize valid first-person or chase-camera transforms.
- All five aircraft define cockpit eye positions, first-person FOV values, and geometry hidden from the cockpit.
- First-person keeps useful aircraft geometry visible instead of hiding the complete player model.
- First-person FOV is limited to 68–80 degrees with a maximum four-degree speed increase.
- First-person near clipping is reduced to `0.25`.
- Horizontal free-look direction now matches horizontal mouse movement.

## Reported symptoms

- First-person mode does not reliably activate.
- The HUD can show the first-person cockpit overlay while the Three.js camera remains in third-person.
- Camera mode can appear stuck and repeated toggles may have no visible effect.
- Toggling while paused can leave the rendered camera and HUD in different modes.
- First-person free-look can appear unresponsive.
- When first-person does activate, the view feels distorted and is not positioned from an aircraft-specific cockpit.

## Original ownership problem

Camera mode originally had two mutable owners:

1. React state: `cameraMode` in `src/App.tsx`.
2. Renderer state: `WorldRenderer.cameraMode` in `src/game/worldRenderer.ts`.

The HUD read the React value, while the Three.js camera read the renderer value. These values could diverge.

## Confirmed root causes

### 1. The animation loop overwrites camera toggles with stale state

`initThreeAndGame()` creates a long-lived `requestAnimationFrame` callback. That callback captures the value of `cameraMode` from the React render that started the match.

Every frame, `src/App.tsx` assigns the captured value back to the renderer:

```ts
renderer3D.cameraMode = cameraMode;
```

The keyboard and HUD toggle handlers correctly assign the new mode to `renderer3D.cameraMode`, but the animation loop overwrites it on the next frame.

Practical effect:

- A match started in third-person tends to remain rendered in third-person.
- A match started in first-person tends to remain rendered in first-person.
- React can still display the opposite mode, producing a first-person overlay over a third-person camera.
- Because `cameraMode` is not reset between matches, the mode that becomes "stuck" can vary by match.

Relevant locations:

- `src/App.tsx:59`
- `src/App.tsx:206`
- `src/App.tsx:256-261`
- `src/App.tsx:626-627`
- `src/App.tsx:790-795`

### 2. Pausing skips the entire renderer update

While paused, `App.tsx` calls `updateWorld()` with `dt = 0`.

`WorldRenderer.updateWorld()` immediately returns when `dt <= 0`, before it:

- updates aircraft transforms,
- applies camera mode,
- updates aircraft visibility,
- updates the camera transform,
- renders the scene.

Therefore, toggling the camera while paused updates React state but cannot update the Three.js view. This makes the camera appear frozen or stuck until rendering resumes. The stale animation-loop assignment can then overwrite the requested mode after unpausing.

Relevant locations:

- `src/App.tsx:639`
- `src/game/worldRenderer.ts:524`

### 3. Mouse movement is cleared before the renderer consumes it

`InputManager.mouseDelta` accumulates mouse movement for free-look. The frame loop calls:

```ts
inputManager.clearPressedEdges();
```

before it obtains the `InputFrame` passed to `WorldRenderer.updateWorld()`. `clearPressedEdges()` also resets `mouseDelta` to zero.

As a result, `WorldRenderer.updateCamera()` normally sees:

```ts
mouseDelta: { x: 0, y: 0 }
```

even while the right mouse button is held. The free-look code is active but receives no movement, which feels like a stuck first-person camera.

Relevant locations:

- `src/App.tsx:559-560`
- `src/App.tsx:638`
- `src/game/inputManager.ts:280-285`
- `src/game/worldRenderer.ts:728-735`

### 4. There is no explicit camera transition state

Changing `cameraMode` only changes a string. It does not reset or initialize:

- `freeLookYaw`,
- `freeLookPitch`,
- `cameraLookAtTarget`,
- camera position smoothing,
- camera up-vector state,
- player aircraft visibility.

This can preserve stale orientation from the previous mode. Third-person also interpolates from the first-person camera position, while first-person snaps directly to its new position. The result can be a sharp jump, temporary bad look direction, or an unexpected free-look angle after switching.

Relevant locations:

- `src/game/worldRenderer.ts:53-56`
- `src/game/worldRenderer.ts:728-788`

## First-person quality problems

These do not cause the mode lock, but they explain why the active first-person view still feels wrong.

### Hard-coded cockpit position

The eye position is always:

```ts
aircraft position + forward * 1.6 + up * 1.15
```

It does not use an aircraft-defined camera anchor. Aircraft already have cockpit geometry and damage volumes, but neither is used to position the camera.

Relevant location:

- `src/game/worldRenderer.ts:744-747`

### Entire player aircraft is hidden

First-person sets:

```ts
pGroup.visible = false;
```

This removes the nose, canopy, wings, propeller, and cockpit geometry. The result is a floating camera with a 2D cockpit mask rather than a view from inside the aircraft.

Relevant location:

- `src/game/worldRenderer.ts:743`

### Excessive first-person field of view

The first-person FOV is speed-dependent and can reach 95 degrees:

```ts
clamp(74 + speedKmph / 24, 70, 95)
```

At ordinary combat speeds the FOV is already around 88–95 degrees. This exaggerates motion and peripheral distortion, especially behind the static cockpit overlay.

Relevant locations:

- `src/game/worldRenderer.ts:723-726`
- `src/components/GameHUD.tsx:66-124`

### Camera and HUD have independent ideas of mode

`GameHUD` renders its cockpit overlay from React `cameraMode`, not from the mode actually applied by `WorldRenderer`. This is why the visible overlay cannot be treated as proof that the camera switched.

Relevant locations:

- `src/App.tsx:789`
- `src/components/GameHUD.tsx:317`

## Required fix boundaries

A robust fix should address the system as one camera-state change:

1. Establish one authoritative camera mode.
2. Stop the RAF closure from writing stale React state.
3. Sample one `InputFrame` per animation frame.
4. Pass that same frame to simulation and rendering.
5. Clear transient input only after all frame consumers finish.
6. Continue camera and render updates while paused, using a zero simulation delta but a nonzero visual-frame delta.
7. Add a renderer camera-mode setter that resets transition/free-look state intentionally.
8. Add aircraft-specific cockpit eye anchors to aircraft content.
9. Hide only geometry that clips the camera instead of hiding the complete aircraft.
10. Use a narrower first-person FOV or a small controlled speed effect.

## Implementation plan

### Phase 1: Fix state ownership and mode locking

Goal: make camera switching deterministic before changing camera appearance.

1. Add a `cameraModeRef` beside React `cameraMode`.
2. Route keyboard and HUD toggles through one `setActiveCameraMode()` function.
3. Update React state, the ref, and the active renderer in that function.
4. Remove the stale per-frame assignment from the RAF closure.
5. Add `WorldRenderer.setCameraMode(mode)` so transition behavior is owned by the renderer rather than scattered across `App.tsx`.
6. Reset camera mode intentionally when starting or ending a match.

Expected result: the HUD and Three.js renderer cannot disagree about the active mode, and neither mode can become locked to its match-start value.

### Phase 2: Correct per-frame input consumption

Goal: ensure simulation and camera receive the same complete input snapshot.

1. Call `inputManager.getInputFrame()` once at the beginning of each RAF iteration.
2. Pass that single frame to:
   - `GameEngine.update()`
   - `WorldRenderer.updateWorld()`
   - any HUD/debug consumer that requires it
3. Move `inputManager.clearPressedEdges()` to the end of the frame.
4. Keep held-button state persistent while clearing only transient edges and mouse delta.

Expected result: first-person and third-person free-look receive real mouse movement and no subsystem sees a different input state during the same frame.

### Phase 3: Separate simulation pause from visual pause

Goal: allow camera switching and scene rendering while gameplay is paused.

1. Continue passing `0` to simulation while paused.
2. Pass the real clamped frame delta to the renderer.
3. Remove or replace the early `dt <= 0` return in `WorldRenderer.updateWorld()`.
4. If selected visual effects must freeze, give them an explicit simulation/effects delta instead of preventing the entire render.

Expected result: camera mode, camera orientation, aircraft visibility, HUD projection, and the scene continue updating while paused without advancing aircraft physics.

### Phase 4: Make mode transitions explicit

Goal: prevent stale free-look and bad interpolation when switching views.

Implement transition handling inside `WorldRenderer.setCameraMode()`:

1. Reset or intentionally preserve `freeLookYaw` and `freeLookPitch`.
2. Initialize `cameraLookAtTarget` from the aircraft's current forward direction.
3. Snap first-person position to the cockpit eye anchor.
4. Initialize third-person position from a valid chase offset before resuming interpolation.
5. Restore player-model visibility immediately when leaving first-person.
6. Clamp interpolation factors with `Math.min(1, rate * dt)`.

Expected result: repeated switching is stable and does not produce a temporary sideways view, long camera sweep, or hidden aircraft.

### Phase 5: Add aircraft-specific cockpit camera data

Goal: place the camera correctly for every aircraft.

1. Extend `AircraftRenderDef` with camera metadata, for example:

```ts
camera: {
  cockpitEye: [number, number, number];
  firstPersonFov?: number;
  hiddenBlockIds?: string[];
}
```

2. Add a cockpit eye position to each aircraft definition.
3. Transform the local eye position through the aircraft group quaternion.
4. Use `hiddenBlockIds` to hide only geometry that intersects the near plane.
5. Keep useful nose, wing, and engine references visible where possible.

Expected result: first-person feels attached to the aircraft rather than floating above its center, including for aircraft of different lengths and layouts.

### Phase 6: Tune first-person optics

Goal: remove visual distortion after the functional bugs are fixed.

1. Start with a fixed first-person vertical FOV around 70–76 degrees.
2. If speed-dependent FOV is retained, limit the increase to a few degrees.
3. Verify the static cockpit overlay at common aspect ratios.
4. Confirm that the center reticle corresponds to the actual forward/gun direction.
5. Review near-plane distance if retained aircraft geometry clips.

Expected result: the view remains readable at combat speed and does not feel detached or excessively wide.

### Phase 7: Verification

Run:

```sh
npm run lint
npm run build
```

Manual test matrix:

| Scenario | Required behavior |
| --- | --- |
| Keyboard `C` during flight | Switches once and remains in the selected mode |
| HUD camera button | Matches keyboard behavior |
| Toggle while paused | Camera and overlay switch immediately |
| Right-mouse free-look | Rotates while held and returns smoothly |
| Repeated rapid toggles | No lock, stale angle, or hidden model |
| Death and respawn | Camera remains functional and correctly attached |
| Exit and start new match | Camera starts in the intended default mode |
| Every aircraft | Eye position is inside the correct cockpit |
| High-speed flight | FOV stays controlled and readable |
| Multiplayer | Remote synchronization does not affect local camera state |

## Recommended implementation order

Implement Phases 1–4 together as the functional repair. Verify those changes before adding aircraft camera metadata. Then complete Phases 5–6 as visual quality work. This keeps camera-state bugs separate from cockpit-position tuning and makes regressions easier to isolate.

## Acceptance checks

- `C` switches the actual Three.js camera exactly once per key press.
- The HUD camera button behaves identically to `C`.
- HUD overlay and rendered camera always show the same mode.
- Switching works while flying, paused, dead, and immediately after respawn.
- Switching modes repeatedly does not lock either mode.
- Starting a new match does not inherit an unintended camera lock.
- Right-mouse free-look receives nonzero mouse deltas and returns smoothly to center.
- Pausing during free-look does not corrupt orientation.
- Each aircraft places the eye inside its own cockpit.
- First-person does not show clipping geometry, but useful nose/wing references remain visible.
- TypeScript still passes with `npm run lint`.

## Verification results

Completed:

- `npm run lint` passes.
- `npm run build` passes.
- Production client and server bundles are generated successfully.
- Static regression checks confirm:
  - no direct RAF assignment to `renderer3D.cameraMode`,
  - no paused-render `dt = 0` path,
  - no complete `pGroup.visible = false` first-person path,
  - one game-loop `InputFrame` snapshot,
  - transient input clearing occurs after renderer consumption,
  - every registered aircraft has camera metadata.

Build note:

- Vite reports an existing bundle-size warning because the main JavaScript chunk exceeds 500 kB. This is unrelated to the camera repair.

Still requires interactive verification:

- Visual cockpit-eye tuning for each aircraft.
- Rapid keyboard and HUD-button switching.
- Switching while paused, dead, and after respawn.
- Free-look direction, sensitivity, and return-to-center feel.
- Near-plane clipping at extreme pitch, roll, and free-look angles.
- Cockpit overlay appearance at multiple viewport aspect ratios.
