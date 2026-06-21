// Run with: node --import tsx/esm src/game/voxelMesh.test.ts
// tsx is already a devDependency; Node 22+ required.

import assert from "node:assert/strict";
import * as THREE from "three";
import {
  buildVoxelMesh,
  findVoxelImpact,
  deformAtImpact,
  animateSpinCells,
  setCockpitVisible,
  resetVoxelMesh,
} from "./voxelMesh.js";
import type { VoxelAircraftDef } from "./voxelTypes.js";

// ---- minimal fixture -------------------------------------------------------
// 3 x 3 x 3 hollow shell (surface only) at voxelSize 1.0 m.
// Corner cells: 8 corners, 12 edges, 6 face-centres = 26 surface cells.
// One cockpit cell and two spinZ propeller cells added separately.

const S = 1.0; // voxelSize

function makeFixtureDef(): VoxelAircraftDef {
  const cells: VoxelAircraftDef["cells"] = [];

  // 3×3×3 shell (all cells; interior [-1,1]^3 not added since we only add shell)
  for (let x = -1; x <= 1; x++)
    for (let y = -1; y <= 1; y++)
      for (let z = -1; z <= 1; z++)
        if (x === -1 || x === 1 || y === -1 || y === 1 || z === -1 || z === 1)
          cells.push({ gx: x, gy: y, gz: z, color: 0xaaaaaa, zone: "fuselage" });

  // Canopy cell (cockpit zone) sitting above shell
  cells.push({ gx: 0, gy: 2, gz: 0, color: 0x00aaff, zone: "cockpit" });

  // Two spinZ propeller cells at (±2, 0, 2) — in front of and outside the shell
  cells.push({ gx: 2, gy: 0, gz: 2, color: 0x888888, zone: "engine", tags: ["spinZ"] });
  cells.push({ gx: -2, gy: 0, gz: 2, color: 0x888888, zone: "engine", tags: ["spinZ"] });

  return { id: "test", voxelSize: S, cells };
}

// ---- build -----------------------------------------------------------------

{
  const def = makeFixtureDef();
  const state = buildVoxelMesh(def);

  // 26 shell cells + 1 cockpit + 2 spinZ = 29 total surface voxels.
  // spinZ cells go into spinMesh; the rest go into mesh.
  assert.equal(state.cells.size, 29, "cell map should contain all surface cells");
  assert.equal(state.mesh.count, 27, "main mesh holds non-spinZ cells");
  assert.ok(state.spinMesh !== null, "spinMesh should exist");
  assert.equal(state.spinMesh!.count, 2, "spinMesh holds spinZ cells");

  // spinCells
  assert.equal(state.spinCells.length, 2, "two spinZ cells expected");
  assert.equal(state.spinAngle, 0, "initial spinAngle is 0");

  // Tags preserved
  const sc = state.cells.get("2,0,2")!;
  assert.ok(sc, "spinZ cell at (2,0,2) should exist");
  assert.ok(sc.tags?.includes("spinZ"), "spinZ tag should be preserved");

  // Zone stored
  const cockpit = state.cells.get("0,2,0")!;
  assert.ok(cockpit, "cockpit cell should exist");
  assert.equal(cockpit.zone, "cockpit");

  console.log("PASS buildVoxelMesh");
}

// ---- findVoxelImpact -------------------------------------------------------

{
  const state = buildVoxelMesh(makeFixtureDef());

  // Ray that enters through z=1 face, heading -z direction → should hit (0,0,1)
  const hitA = findVoxelImpact(
    state,
    new THREE.Vector3(0, 0, 5),
    new THREE.Vector3(0, 0, -5)
  );
  assert.ok(hitA !== null, "ray through shell should hit");
  assert.equal(hitA!.z, 1 * S, "first struck cell z should be +1");

  // Ray that passes entirely outside the shell
  const miss = findVoxelImpact(
    state,
    new THREE.Vector3(10, 10, 10),
    new THREE.Vector3(10, 10, 11)
  );
  assert.equal(miss, null, "ray missing the shell should return null");

  // Ray starting inside the shell gap (no cell at 0,0,0) heading +x → hits (1,0,0)
  const hitInside = findVoxelImpact(
    state,
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(5, 0, 0)
  );
  assert.ok(hitInside !== null, "ray from interior gap should find shell");
  assert.equal(hitInside!.x, 1 * S, "should hit (1,0,0)");

  console.log("PASS findVoxelImpact");
}

// ---- deformAtImpact --------------------------------------------------------

{
  const state = buildVoxelMesh(makeFixtureDef());

  // Strike at (1,0,0) — that cell is alive
  const changed = deformAtImpact(state, new THREE.Vector3(1, 0, 0), 0);
  assert.ok(changed, "strike on alive cell should return changed=true");
  assert.equal(state.cells.get("1,0,0")!.alive, false, "struck cell should be dead");

  // Strike the same spot again — cell is already dead, nothing changes
  const changed2 = deformAtImpact(state, new THREE.Vector3(1, 0, 0), 0);
  assert.ok(!changed2, "second strike on dead cell returns false");

  // AOE: strike at origin (no cell there) with blast=1.5 — should remove all
  // cells within 1.5 m of origin. Shell cells at ±1 are at distance 1 < 1.5.
  const state2 = buildVoxelMesh(makeFixtureDef());
  const before = Array.from(state2.cells.values()).filter(c => c.alive).length;
  deformAtImpact(state2, new THREE.Vector3(0, 0, 0), 1.5);
  const after = Array.from(state2.cells.values()).filter(c => c.alive).length;
  assert.ok(after < before, "AOE blast should remove cells within radius");

  // PropZ cells at (±2, 0, 2) are at distance sqrt(4+4)≈2.83 > 1.5, so alive
  assert.ok(state2.cells.get("2,0,2")!.alive, "spinZ cell outside blast should survive");

  console.log("PASS deformAtImpact");
}

// ---- animateSpinCells ------------------------------------------------------

{
  const state = buildVoxelMesh(makeFixtureDef());
  assert.equal(state.spinAngle, 0);

  // Advance spin at throttle 0 (15 rad/s) for 1 second
  animateSpinCells(state, 1, 0);
  assert.ok(Math.abs(state.spinAngle - 15) < 1e-9, "spinAngle should advance 15 rad/s at throttle 0");

  // Kill one spinZ cell — animation of dead cells must not throw
  state.cells.get("2,0,2")!.alive = false;
  assert.doesNotThrow(() => animateSpinCells(state, 0.016, 1), "animate with dead spinZ cell should not throw");

  console.log("PASS animateSpinCells");
}

// ---- setCockpitVisible -----------------------------------------------------

{
  const state = buildVoxelMesh(makeFixtureDef());
  const cockpitCell = state.cells.get("0,2,0")!;

  // Hide cockpit (first-person mode)
  setCockpitVisible(state, false);
  // Read back the matrix — should be the zero-scale hidden matrix
  const hiddenMat = new THREE.Matrix4();
  state.mesh.getMatrixAt(cockpitCell.idx, hiddenMat);
  assert.ok(hiddenMat.elements[0] === 0, "hidden cockpit cell should have scale 0");

  // Restore
  setCockpitVisible(state, true);
  const restoredMat = new THREE.Matrix4();
  state.mesh.getMatrixAt(cockpitCell.idx, restoredMat);
  assert.ok(restoredMat.elements[0] !== 0, "restored cockpit cell should have non-zero scale");

  // Destroyed cells must not be restored by setCockpitVisible
  cockpitCell.alive = false;
  state.mesh.setMatrixAt(cockpitCell.idx, new THREE.Matrix4().makeScale(0, 0, 0));
  setCockpitVisible(state, true);
  const deadMat = new THREE.Matrix4();
  state.mesh.getMatrixAt(cockpitCell.idx, deadMat);
  assert.equal(deadMat.elements[0], 0, "destroyed cockpit cell must not be restored by setCockpitVisible");

  console.log("PASS setCockpitVisible");
}

// ---- resetVoxelMesh --------------------------------------------------------

{
  const state = buildVoxelMesh(makeFixtureDef());

  // Kill everything
  for (const cell of state.cells.values()) {
    state.mesh.setMatrixAt(cell.idx, new THREE.Matrix4().makeScale(0, 0, 0));
    cell.alive = false;
  }
  state.spinAngle = Math.PI;

  resetVoxelMesh(state);

  const allAlive = Array.from(state.cells.values()).every(c => c.alive);
  assert.ok(allAlive, "after reset all cells should be alive");
  assert.equal(state.spinAngle, 0, "spinAngle should reset to 0");

  // Verify instance matrix of one cell is non-zero after reset
  const cell = state.cells.get("1,0,0")!;
  const m = new THREE.Matrix4();
  state.mesh.getMatrixAt(cell.idx, m);
  assert.ok(m.elements[0] !== 0, "reset cell should have non-zero matrix");

  console.log("PASS resetVoxelMesh");
}

console.log("\nAll voxel tests passed.");
