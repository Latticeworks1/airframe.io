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

The system is a browser-based multiplayer air combat game. The Express server in `server.ts` acts as both a Vite dev middleware (in development) and a static file server (in production), while simultaneously running a WebSocket server at `/multiplayer` for real-time match synchronization.

`src/App.tsx` is the central orchestrator. It owns a React Animation Frame loop that calls three independent subsystems each tick: `GameEngine.update()` for simulation, `WorldRenderer.updateWorld()` for scene rendering, and `InputManager.getInputFrame()` for control sampling. React state is used only for the HUD layer and UI screens; the game loop itself operates entirely through mutable class instances held in refs to avoid React's render cycle overhead.

The game layer stack is:

`InputManager` captures raw keyboard and mouse events into a flat `InputFrame` struct each tick. `AircraftController` translates the `InputFrame` and a 3D mouse target point into a normalized `FlightCommand`. `FlightPhysicsEngine` (in `flightModel.ts`) applies Newtonian integration using per-surface aerodynamic forces computed by `AerodynamicsEngine` (in `aeroSurfaceModel.ts`), which models each control surface individually with lift slope, aspect ratio, and Oswald efficiency. The resulting pilot position/velocity/orientation is written directly onto the mutable `Pilot` object. `WorldRenderer` reads those same `Pilot` objects and drives a Three.js scene.

The global axis contract used throughout all physics and rendering code is: aircraft local `+Z` = nose/forward/gun direction, `+Y` = up, `+X` = right wing. Euler rotation order is always `YXZ` (yaw applied first, then pitch, then roll).

`GameEngine` owns the authoritative simulation state: the `pilots` array (players and bots), `projectiles`, `groundTargets`, `skyZones`, and match score/timer. In multiplayer, the first connected client is designated host and is solely responsible for simulating and broadcasting bot states (`bots_sync`) and team scores (`score_sync`). Non-host clients receive bot positions via `bots_updated` messages and apply them directly to their local pilot objects without re-simulating.

## Content Structure

Aircraft definitions live under `src/game/content/aircraft/{id}/` with six files per aircraft: `specs.ts` (AircraftSpecs), `aero.ts` (AeroSurface array), `damage.ts` (hit zone config), `hardpoints.ts` (weapon mount points), `render.ts` (Three.js mesh geometry), and `index.ts` (barrel export). The five aircraft currently defined are `falcon-mk2`, `grizzly-a1`, `kite-9`, `vulcan-51`, and `twinwolf`.

`src/game/aircraftData.ts` is a backward-compatible facade that re-exports everything from the content subdirectories. Always import from this facade or from `src/game/content/` directly; never add data to `aircraftData.ts` itself.

Maps, weapons, and modifications follow the same pattern under `src/game/content/maps/`, `src/game/content/weapons/`, and `src/game/content/modifications/`.

## Key Type Boundaries

`src/types.ts` defines every shared interface. `Pilot` is the central mutable entity carrying position, velocity, orientation, damage model, ammo, and AI state. `DamageModel` uses values from `1.0` (intact) to `0.0` (destroyed) per zone, not hit points. `FlightCommand` is the normalized control output from `AircraftController` and is the only interface between input handling and physics.
