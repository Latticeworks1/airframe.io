#!/usr/bin/env python3
import math
import os
import re
import sys

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REGISTRY_PATH = os.path.join(
    ROOT_DIR, "src/game/content/aircraft/cockpitRegistry.ts"
)
MESH_PATH = os.path.join(ROOT_DIR, "src/game/cockpitMesh.ts")
WORLD_RENDERER_PATH = os.path.join(ROOT_DIR, "src/game/worldRenderer.ts")
FALCON_RENDER_PATH = os.path.join(
    ROOT_DIR, "src/game/content/aircraft/falcon-mk2/render.ts"
)


def read(path):
    with open(path, "r") as source_file:
        return source_file.read()


def number(source, name):
    match = re.search(rf"const\s+{name}\s*=\s*([\d.-]+)", source)
    if not match:
        raise ValueError(f"Could not parse {name}")
    return float(match.group(1))


def parse_cockpit():
    source = read(REGISTRY_PATH)
    entry = re.search(r'"falcon-mk2",\s*\{([^}]+)\}', source)
    if not entry:
        raise ValueError("Could not find falcon-mk2 cockpit definition")

    body = entry.group(1)
    eye = re.search(
        r"eye:\s*\[\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)\s*\]",
        body,
    )
    values = {
        name: re.search(rf"{name}:\s*([\d.-]+)", body)
        for name in ("panelZ", "panelY", "panelW", "panelH")
    }
    if not eye or not all(values.values()):
        raise ValueError("Incomplete cockpit definition")

    return {
        "eye": tuple(float(value) for value in eye.groups()),
        **{name: float(match.group(1)) for name, match in values.items()},
    }


def project_ndc(point, eye, vertical_fov=74.0, aspect=16 / 9):
    dx = point[0] - eye[0]
    dy = point[1] - eye[1]
    dz = point[2] - eye[2]
    if dz <= 0:
        return None
    tan_half_fov = math.tan(math.radians(vertical_fov) / 2)
    return (
        dx / (dz * tan_half_fov * aspect),
        dy / (dz * tan_half_fov),
    )


def lerp(a, b, amount):
    return tuple(a[index] + (b[index] - a[index]) * amount for index in range(3))


def run_validation():
    cockpit = parse_cockpit()
    mesh_source = read(MESH_PATH)
    renderer_source = read(WORLD_RENDERER_PATH)
    falcon_render_source = read(FALCON_RENDER_PATH)

    eye = cockpit["eye"]
    panel_z = cockpit["panelZ"]
    panel_y = cockpit["panelY"]
    panel_w = cockpit["panelW"]
    panel_h = cockpit["panelH"]
    panel_top = panel_y + panel_h / 2
    panel_bottom = panel_y - panel_h / 2
    panel_depth = number(mesh_source, "panelDepth")
    pillar_thickness = number(mesh_source, "pillarThickness")
    panel_junction_overlap = number(mesh_source, "panelJunctionOverlap")
    panel_side_post_width = number(mesh_source, "panelSidePostWidth")
    floor_offset = number(mesh_source, "floorOffset")
    rear_extension = number(mesh_source, "rearExtension")
    pillar_rear_extension = number(mesh_source, "pillarRearExtension")
    pillar_rear_inset = number(mesh_source, "pillarRearInset")
    pillar_rear_rise = number(mesh_source, "pillarRearRise")
    rear_top_drop = number(mesh_source, "rearTopDrop")
    sight_glass_width = number(mesh_source, "sightGlassWidth")
    sight_glass_height = number(mesh_source, "sightGlassHeight")
    failures = 0

    print(
        "[*] Cockpit shell: "
        f"eye={eye}, panel={panel_w:.2f}x{panel_h:.2f}, depth={panel_depth:.3f}"
    )

    if panel_depth > 0.08:
        print("[FAIL] Instrument-panel shell is unnecessarily deep.")
        failures += 1
    if pillar_thickness > 0.03:
        print("[FAIL] Windshield pillars are too thick.")
        failures += 1
    if panel_w < 1.3:
        print("[FAIL] Instrument panel is narrower than the requested view.")
        failures += 1
    if panel_junction_overlap < 0.02:
        print("[FAIL] Panel-to-sidewall overlap is too small to seal the seam.")
        failures += 1
    if panel_side_post_width <= panel_junction_overlap:
        print("[FAIL] Panel side post cannot bridge the panel-to-hull junction.")
        failures += 1

    camera_eye = re.search(
        r"cockpitEye:\s*\[\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)\s*\]",
        falcon_render_source,
    )
    if (
        not camera_eye
        or tuple(float(value) for value in camera_eye.groups()) != eye
    ):
        print("[FAIL] Cockpit mesh eye and first-person camera eye disagree.")
        failures += 1

    # The exact panel face must contain every canvas instrument center/radius.
    gauge_circles = [
        (-0.36 * panel_w, panel_bottom + 0.74 * panel_h, 0.122 * panel_w * 0.5625),
        (-0.36 * panel_w, panel_bottom + 0.44 * panel_h, 0.122 * panel_w * 0.5625),
        (-0.36 * panel_w, panel_bottom + 0.16 * panel_h, 0.122 * panel_w * 0.5625 * 0.78),
        (0, panel_bottom + 0.60 * panel_h, 0.178 * panel_w * 0.5625),
        (0, panel_bottom + 0.20 * panel_h, 0.122 * panel_w * 0.5625),
        (0.36 * panel_w, panel_bottom + 0.72 * panel_h, 0.112 * panel_w * 0.5625),
        (0.36 * panel_w, panel_bottom + 0.44 * panel_h, 0.112 * panel_w * 0.5625 * 0.88),
        (0.36 * panel_w, panel_bottom + 0.18 * panel_h, 0.112 * panel_w * 0.5625 * 0.80),
    ]
    for index, (x, y, radius) in enumerate(gauge_circles, start=1):
        if abs(x) + radius > panel_w / 2 or not (
            panel_bottom <= y - radius and y + radius <= panel_top
        ):
            print(f"[FAIL] Gauge {index} falls outside the rectangular panel.")
            failures += 1

    sight_center = (0, panel_top + 0.150, panel_z - 0.165)
    sight_ndc = project_ndc(sight_center, eye)
    tan_half_fov = math.tan(math.radians(74.0) / 2)
    sight_screen_width = sight_glass_width / (
        (sight_center[2] - eye[2]) * tan_half_fov * (16 / 9)
    ) / 2
    sight_screen_height = sight_glass_height / (
        (sight_center[2] - eye[2]) * tan_half_fov
    ) / 2
    if not sight_ndc or abs(sight_ndc[0]) > 0.01:
        print("[FAIL] Holographic sight is not centered on the forward axis.")
        failures += 1
    if not 0.06 <= sight_screen_width <= 0.12:
        print("[FAIL] Holographic sight width misses the sketched screen area.")
        failures += 1
    if not 0.10 <= sight_screen_height <= 0.22:
        print("[FAIL] Holographic sight height misses the sketched screen area.")
        failures += 1

    # Reproduce the right-side frame paths from cockpitMesh.ts.
    pillar_base = (
        panel_w / 2 - panel_junction_overlap,
        panel_top + 0.025,
        panel_z - 0.010,
    )
    pillar_rear = (
        panel_w / 2 - pillar_rear_inset,
        eye[1] + pillar_rear_rise,
        eye[2] - pillar_rear_extension,
    )
    side_front = (
        panel_w / 2 - panel_junction_overlap,
        panel_top + 0.032,
        panel_z - 0.014,
    )
    side_rear = (
        panel_w / 2 + 0.19,
        eye[1] - rear_top_drop + 0.012,
        eye[2] - rear_extension,
    )

    print("[*] Checking continuous side rails and windshield pillars...")
    pillar_base_ndc = project_ndc(pillar_base, eye)
    if (
        not pillar_base_ndc
        or not 0.55 <= pillar_base_ndc[0] <= 0.70
        or not -0.08 <= pillar_base_ndc[1] <= 0.08
    ):
        print("[FAIL] Pillar base misses the reference cockpit proportions.")
        failures += 1

    if pillar_rear[2] >= eye[2] - 0.10:
        print("[FAIL] Windshield pillar still terminates in front of the camera.")
        failures += 1
    if side_rear[2] >= eye[2] - 0.20:
        print("[FAIL] Cockpit side wall does not extend behind the camera.")
        failures += 1

    top_crossing = None
    for step in range(81):
        point = lerp(pillar_base, pillar_rear, step / 80)
        if point[2] <= eye[2] + 0.03:
            continue
        ndc = project_ndc(point, eye)
        if ndc and ndc[1] >= 1.0 and top_crossing is None:
            top_crossing = ndc
        if ndc and abs(ndc[0]) < 0.30:
            print("[FAIL] Windshield pillar enters the central sight picture.")
            failures += 1
            break
    if not top_crossing or not 0.85 <= top_crossing[0] <= 1.15:
        print("[FAIL] Windshield pillar misses the upper screen corner.")
        failures += 1

    side_edge_crossing = None
    for step in range(81):
        point = lerp(side_front, side_rear, step / 80)
        if point[2] <= eye[2] + 0.03:
            continue
        ndc = project_ndc(point, eye)
        if ndc and ndc[0] >= 1.0 and side_edge_crossing is None:
            side_edge_crossing = ndc
        if ndc and abs(ndc[0]) <= 1.0 and ndc[1] > 0.15:
            print("[FAIL] Side rail rises into the forward sight picture.")
            failures += 1
            break
    if (
        not side_edge_crossing
        or not -0.28 <= side_edge_crossing[1] <= 0.02
    ):
        print("[FAIL] Side rail misses the reference edge perspective.")
        failures += 1

    if floor_offset < 0.60:
        print("[FAIL] Cockpit floor is high enough to hide the restored controls.")
        failures += 1

    required_geometry = (
        "coloredClosedHullGeo",
        "wallVertices",
        "firewallTop",
        "panelSidePostWidth",
        "stickHeight",
        "throttleAmount",
        "rearExtension",
    )
    for identifier in required_geometry:
        if identifier not in mesh_source:
            print(f"[FAIL] Required cockpit component missing: {identifier}")
            failures += 1

    banned_geometry = (
        "coloredTriangleGeo",
        "sillRear",
        "sillFront",
        "corner block",
        "Glare Shield Lip",
    )
    for identifier in banned_geometry:
        if identifier in mesh_source:
            print(f"[FAIL] Obsolete open/layered component still present: {identifier}")
            failures += 1

    if "voxState.spinMesh.visible = !inFPV" not in renderer_source:
        print("[FAIL] Voxel spin geometry is not hidden during FPV updates.")
        failures += 1
    if "voxState.spinMesh.visible = !willBeFirstPerson" not in renderer_source:
        print("[FAIL] Voxel spin geometry is not hidden during FPV transitions.")
        failures += 1
    if 'if (this.cameraMode === "first-person")' not in renderer_source:
        print("[FAIL] First-person turbulence branch is missing.")
        failures += 1
    if "this.reticleTurbulenceX = shakeX * sightBuffet" not in renderer_source:
        print("[FAIL] Turbulence is not transferred to the reflector reticle.")
        failures += 1
    if "cockpit.sightAnchorLocal" not in renderer_source:
        print("[FAIL] First-person reticle is not anchored to the sight glass.")
        failures += 1
    if "ckEntry?.eyeLocal.clone()" not in renderer_source:
        print("[FAIL] First-person camera does not use the cockpit eye anchor.")
        failures += 1
    first_person_turbulence = re.search(
        r"const shakeX\s*=.*?"
        r'if \(this\.cameraMode === "first-person"\) \{'
        r'(?P<body>.*?)'
        r'\} else \{',
        renderer_source,
        re.DOTALL,
    )
    if (
        not first_person_turbulence
        or "this.camera.position.add" in first_person_turbulence.group("body")
    ):
        print("[FAIL] First-person turbulence independently moves the cockpit camera.")
        failures += 1

    if failures:
        print(f"[FAIL] Found {failures} cockpit layout issues.")
        return False

    print(
        "[SUCCESS] Panel, closed tub, behind-eye rails, sight, and flight "
        "controls satisfy the cockpit constraints."
    )
    return True


if __name__ == "__main__":
    try:
        valid = run_validation()
    except ValueError as error:
        print(f"[ERROR] {error}")
        valid = False
    sys.exit(0 if valid else 1)
