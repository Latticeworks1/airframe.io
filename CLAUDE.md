# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Working methodology

When a task or design question is unclear, do not guess and implement — ask. Before asking the actual question, first derive the meta-questions that lead to its answer: the smaller, more concrete questions whose answers collectively resolve the larger one. Stating those meta-questions out loud narrows the design space and often makes the answer obvious without needing to ask the user at all. If it does not, ask only the residual questions that the meta-questions could not resolve. This process applies to architecture decisions, visual/UX intent, scope boundaries, and any situation where a wrong assumption would require rework.

## Commands

```
npm install          # install dependencies
npm run dev          # start combined Express + Vite dev server on port 3000
npm run build        # vite build (client) + esbuild (server.ts -> dist/server.cjs)
npm start            # run production build (requires npm run build first)
npm run lint         # TypeScript type-check only (tsc --noEmit, no eslint configured)
npm run clean        # remove dist/
```

Environment: copy `.env.example` to `.env.local` and set `GEMINI_API_KEY` to a Gemini API key. No tests are configured.

## Architecture

The system is a browser-based multiplayer air combat game. The Express server in `server.ts` hosts a server-authoritative Colyseus game server while acting as Vite dev middleware (in development) and static file server (in production).

The "game engine" is the runtime collective of all ECS systems (Input, Aerodynamics, Physics, Collision, Voxel deformation, AI, Objective) operating concurrently. `src/App.tsx` is the client orchestrator, maintaining a React Animation Frame loop. Each tick, it drives input sampling, client-side prediction, and `WorldRenderer.updateWorld()` for rendering.

The game layer stack is:

`InputManager` captures raw control states into an `InputFrame` struct. `AircraftController` translates the `InputFrame` into a `FlightCommand`. `FlightPhysicsEngine` (in `flightModel.ts`) integrates forces computed by `AerodynamicsEngine` (in `aeroSurfaceModel.ts`) and writes coordinates directly onto the mutable `Pilot` object. `WorldRenderer` maps these states to the Three.js scene.

The global axis contract used throughout all physics and rendering code is: aircraft local `+Z` = nose/forward/gun direction, `+Y` = up, `+X` = right wing. Euler rotation order is always `YXZ`.

`MatchSimulation` (in `matchSimulation.ts`) acts as the state container for the active local match, hosting arrays of pilots, projectiles, ground targets, and sky zones. In multiplayer, the server runs the simulation authoritatively inside `MultiplayerRoom.ts` at 60Hz. The client runs Client-Side Prediction (CSP) for the local player, and smooth entity slerp interpolation for remote pilots, bots, and objectives synchronized via Colyseus state and snapshots.

## Content Structure

Aircraft definitions live under `src/game/content/aircraft/{id}/` with six files per aircraft: `specs.ts` (AircraftSpecs), `aero.ts` (AeroSurface array), `damage.ts` (hit zone config), `hardpoints.ts` (weapon mount points), `render.ts` (Three.js mesh geometry), and `index.ts` (barrel export). The five aircraft currently defined are `falcon-mk2`, `grizzly-a1`, `kite-9`, `vulcan-51`, and `twinwolf`.

`src/game/aircraftData.ts` is a backward-compatible facade that re-exports everything from the content subdirectories. Always import from this facade or from `src/game/content/` directly; never add data to `aircraftData.ts` itself.

Maps, weapons, and modifications follow the same pattern under `src/game/content/maps/`, `src/game/content/weapons/`, and `src/game/content/modifications/`.

## Key Type Boundaries

`src/types.ts` defines every shared interface. `Pilot` is the central mutable entity carrying position, velocity, orientation, damage model, ammo, and AI state. `DamageModel` uses values from `1.0` (intact) to `0.0` (destroyed) per zone, not hit points. `FlightCommand` is the normalized control output from `AircraftController` and is the only interface between input handling and physics.
