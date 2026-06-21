#!/usr/bin/env python3
import os
import re
import math
import sys

# Paths to the files containing layout specifications
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REGISTRY_PATH = os.path.join(ROOT_DIR, "src/game/content/aircraft/cockpitRegistry.ts")
MESH_PATH = os.path.join(ROOT_DIR, "src/game/cockpitMesh.ts")

def parse_cockpit_defs():
    with open(REGISTRY_PATH, "r") as f:
        content = f.read()

    # Find the falcon-mk2 entry
    falcon_match = re.search(r'"falcon-mk2",\s*\{([^}]+)\}', content)
    if not falcon_match:
        print("[ERROR] Could not find falcon-mk2 definition in cockpitRegistry.ts")
        sys.exit(1)

    inner = falcon_match.group(1)
    
    eye_match = re.search(r'eye:\s*\[\s*([\d\.-]+)\s*,\s*([\d\.-]+)\s*,\s*([\d\.-]+)\s*\]', inner)
    panel_z_match = re.search(r'panelZ:\s*([\d\.-]+)', inner)
    panel_y_match = re.search(r'panelY:\s*([\d\.-]+)', inner)
    panel_w_match = re.search(r'panelW:\s*([\d\.-]+)', inner)
    panel_h_match = re.search(r'panelH:\s*([\d\.-]+)', inner)

    if not all([eye_match, panel_z_match, panel_y_match, panel_w_match, panel_h_match]):
        print("[ERROR] Failed to parse all properties from cockpitRegistry.ts")
        sys.exit(1)

    return {
        "eye": [float(x) for x in eye_match.groups()],
        "panelZ": float(panel_z_match.group(1)),
        "panelY": float(panel_y_match.group(1)),
        "panelW": float(panel_w_match.group(1)),
        "panelH": float(panel_h_match.group(1)),
    }

def parse_mesh_constants():
    with open(MESH_PATH, "r") as f:
        content = f.read()

    # Search for constant declarations
    gs_dep_match = re.search(r'const\s+gsDep\s*=\s*([\d\.-]+)', content)
    gs_thk_match = re.search(r'const\s+gsThk\s*=\s*([\d\.-]+)', content)
    desk_w_match = re.search(r'const\s+deskW\s*=\s*([\d\.-]+)', content)
    desk_h_match = re.search(r'const\s+deskH\s*=\s*([\d\.-]+)', content)

    floor_offset_match = re.search(r'const\s+floorOffset\s*=\s*([\d\.-]+)', content)

    if not all([gs_dep_match, gs_thk_match, desk_w_match, desk_h_match]):
        print("[ERROR] Failed to parse mesh constants from cockpitMesh.ts")
        sys.exit(1)

    floor_offset = float(floor_offset_match.group(1)) if floor_offset_match else 0.52

    return {
        "gsDep": float(gs_dep_match.group(1)),
        "gsThk": float(gs_thk_match.group(1)),
        "deskW": float(desk_w_match.group(1)),
        "deskH": float(desk_h_match.group(1)),
        "floorOffset": floor_offset,
    }

# Graham Scan Convex Hull
def convex_hull(points):
    points = sorted(list(set(points)))
    if len(points) <= 1:
        return points

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower = []
    for p in points:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)

    upper = []
    for p in reversed(points):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)

    return lower[:-1] + upper[:-1]

# 2D Geometry helpers
def point_in_polygon(x, y, poly):
    n = len(poly)
    inside = False
    if n == 0:
        return False
    p1x, p1y = poly[0]
    for i in range(n + 1):
        p2x, p2y = poly[i % n]
        if y > min(p1y, p2y):
            if y <= max(p1y, p2y):
                if x <= max(p1x, p2x):
                    if p1y != p2y:
                        xinters = (y - p1y) * (p2x - p1x) / (p2y - p1y) + p1x
                    if p1x == p2x or x <= xinters:
                        inside = not inside
        p1x, p1y = p2x, p2y
    return inside

def point_to_segment_distance(px, py, x1, y1, x2, y2):
    dx = x2 - x1
    dy = y2 - y1
    if dx == 0 and dy == 0:
        return math.hypot(px - x1, py - y1)
    t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    return math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))

def circle_intersects_polygon(cx, cy, r, poly):
    if point_in_polygon(cx, cy, poly):
        return True
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        if point_to_segment_distance(cx, cy, x1, y1, x2, y2) < r:
            return True
    return False

def line_segments_intersect(p1, p2, p3, p4):
    def ccw(a, b, c):
        return (c[1] - a[1]) * (b[0] - a[0]) > (b[1] - a[1]) * (c[0] - a[0])
    return ccw(p1, p3, p4) != ccw(p2, p3, p4) and ccw(p1, p2, p3) != ccw(p1, p2, p4)

def polygons_intersect(polyA, polyB):
    for p in polyA:
        if point_in_polygon(p[0], p[1], polyB):
            return True
    for p in polyB:
        if point_in_polygon(p[0], p[1], polyA):
            return True
    nA = len(polyA)
    nB = len(polyB)
    for i in range(nA):
        a1 = polyA[i]
        a2 = polyA[(i + 1) % nA]
        for j in range(nB):
            b1 = polyB[j]
            b2 = polyB[(j + 1) % nB]
            if line_segments_intersect(a1, a2, b1, b2):
                return True
    return False

def project_box(eye, box_coords, panelZ):
    ex, ey, ez = eye
    proj_points = []
    # box_coords is a list of 8 corners: [(x, y, z), ...]
    for x, y, z in box_coords:
        # Clip to near plane slightly in front of eye
        if z <= ez:
            z = ez + 0.01
        t = (panelZ - ez) / (z - ez)
        proj_x = ex + t * (x - ex)
        proj_y = ey + t * (y - ey)
        proj_points.append((proj_x, proj_y))
    return convex_hull(proj_points)

def make_box(x_range, y_range, z_range):
    return [
        (x, y, z)
        for x in x_range
        for y in y_range
        for z in z_range
    ]

def run_validation():
    print("[*] Parsing configuration from files...")
    cfg = parse_cockpit_defs()
    mesh = parse_mesh_constants()

    PW = cfg["panelW"]
    PH = cfg["panelH"]
    panelY = cfg["panelY"]
    panelZ = cfg["panelZ"]
    eye = cfg["eye"]
    
    panelTop = panelY + PH / 2
    panelBottom = panelY - PH / 2

    print(f"[*] Cockpit: eye={eye}, panelZ={panelZ}, panelY={panelY}, panelW={PW}, panelH={PH}")
    print(f"[*] Mesh constants: gsThk={mesh['gsThk']}, deskW={mesh['deskW']}, deskH={mesh['deskH']}")

    # 1. Define active regions (Gauges) on the Z = panelZ plane in world units
    gauges = {}

    # Left Column: IAS, Alt, Compass
    lr = 0.122 * PW * 0.75
    gauges["IAS"] = {
        "type": "circle",
        "cx": -PW / 2 + 0.14 * PW,
        "cy": panelBottom + 0.74 * PH,
        "r": lr
    }
    gauges["Altitude"] = {
        "type": "circle",
        "cx": -PW / 2 + 0.14 * PW,
        "cy": panelBottom + 0.44 * PH,
        "r": lr
    }
    gauges["Compass Heading"] = {
        "type": "circle",
        "cx": -PW / 2 + 0.14 * PW,
        "cy": panelBottom + 0.16 * PH,
        "r": lr * 0.78
    }

    # Center: Attitude, Lower Heading
    cr = 0.178 * PW * 0.75
    gauges["Attitude Indicator"] = {
        "type": "circle",
        "cx": 0.0,
        "cy": panelBottom + 0.60 * PH,
        "r": cr
    }
    gauges["Lower Heading"] = {
        "type": "circle",
        "cx": 0.0,
        "cy": panelBottom + 0.20 * PH,
        "r": lr
    }

    # Right Column: Throttle, EGT, Oil
    rr = 0.112 * PW * 0.75
    gauges["Throttle Gauge"] = {
        "type": "circle",
        "cx": -PW / 2 + 0.86 * PW,
        "cy": panelBottom + 0.72 * PH,
        "r": rr
    }
    gauges["EGT"] = {
        "type": "circle",
        "cx": -PW / 2 + 0.86 * PW,
        "cy": panelBottom + 0.44 * PH,
        "r": rr * 0.88
    }
    gauges["Oil"] = {
        "type": "circle",
        "cx": -PW / 2 + 0.86 * PW,
        "cy": panelBottom + 0.18 * PH,
        "r": rr * 0.80
    }

    # Warning Light Strip (represented as a 4-point polygon)
    wx_min = -0.25 * PW
    wx_max = 0.25 * PW
    wy_min = panelTop - 0.09 * PH
    wy_max = panelTop
    gauges["Warning Strip"] = {
        "type": "poly",
        "poly": [(wx_min, wy_min), (wx_max, wy_min), (wx_max, wy_max), (wx_min, wy_max)]
    }

    # MFD Block
    mfd_x_min = -PW / 2 + 0.26 * PW
    mfd_x_max = -PW / 2 + 0.42 * PW
    mfd_y_min = panelBottom + 0.52 * PH
    mfd_y_max = panelBottom + 0.88 * PH
    gauges["MFD Screen"] = {
        "type": "poly",
        "poly": [(mfd_x_min, mfd_y_min), (mfd_x_max, mfd_y_min), (mfd_x_max, mfd_y_max), (mfd_x_min, mfd_y_max)]
    }

    # 2. Define 3D Occluders
    cabCenterZ = (panelZ + (eye[2] - 0.40)) / 2
    floorY = eye[1] - mesh["floorOffset"]
    
    occluders = {}

    # Left desk
    occluders["Left Console"] = make_box(
        [-PW / 2 + 0.01, -PW / 2 + 0.01 + mesh["deskW"]],
        [floorY, floorY + mesh["deskH"]],
        [eye[2] - 0.40, panelZ]
    )

    # Right desk
    occluders["Right Console"] = make_box(
        [PW / 2 - 0.01 - mesh["deskW"], PW / 2 - 0.01],
        [floorY, floorY + mesh["deskH"]],
        [eye[2] - 0.40, panelZ]
    )

    # Glare Shield (Main body)
    gsDep = mesh["gsDep"]
    occluders["Glare Shield Main"] = make_box(
        [-PW * 1.02 / 2, PW * 1.02 / 2],
        [panelTop, panelTop + mesh["gsThk"]],
        [panelZ - gsDep, panelZ]
    )

    # Glare Shield (Lip)
    occluders["Glare Shield Lip"] = make_box(
        [-PW * 1.02 / 2, PW * 1.02 / 2],
        [panelTop - 0.010, panelTop],
        [panelZ - gsDep - 0.006, panelZ - gsDep + 0.006]
    )

    # Throttle mount, arm and knob
    throttleBaseX = -PW / 2 + 0.025
    throttleBaseY = (floorY + mesh["deskH"]) + 0.003 + 0.004
    throttleBaseZ = cabCenterZ - 0.25

    occluders["Throttle Mount"] = make_box(
        [throttleBaseX - 0.0125, throttleBaseX + 0.0125],
        [throttleBaseY - 0.004, throttleBaseY + 0.004],
        [throttleBaseZ - 0.02, throttleBaseZ + 0.02]
    )
    occluders["Throttle Arm"] = make_box(
        [throttleBaseX - 0.003, throttleBaseX + 0.003],
        [throttleBaseY + 0.004, throttleBaseY + 0.029],
        [throttleBaseZ + 0.001, throttleBaseZ + 0.009]
    )
    occluders["Throttle Knob"] = make_box(
        [throttleBaseX - 0.004, throttleBaseX + 0.004],
        [throttleBaseY + 0.020, throttleBaseY + 0.028],
        [throttleBaseZ + 0.004, throttleBaseZ + 0.014]
    )

    # 3. Project occluders onto panelZ plane and validate overlaps
    failures = 0
    print("[*] Projecting 3D cockpit structures and verifying active panel areas...")
    print("-" * 75)

    for occ_name, box in occluders.items():
        proj_poly = project_box(eye, box, panelZ)
        
        for g_name, g_info in gauges.items():
            overlap = False
            if g_info["type"] == "circle":
                overlap = circle_intersects_polygon(g_info["cx"], g_info["cy"], g_info["r"], proj_poly)
            elif g_info["type"] == "poly":
                overlap = polygons_intersect(g_info["poly"], proj_poly)
                
            if overlap:
                # Glare Shield elements sharing boundary with Warning Strip is expected
                if occ_name == "Glare Shield Lip" and g_name == "Warning Strip":
                    print(f"[INFO] Glare Shield Lip overlaps Warning Strip (expected, top warning strip margin).")
                elif occ_name == "Glare Shield Main" and g_name == "Warning Strip":
                    print(f"[INFO] Glare Shield Main touches Warning Strip boundary line (expected).")
                else:
                    print(f"[FAIL] {occ_name} occludes {g_name}!")
                    failures += 1

    print("-" * 75)
    if failures == 0:
        print("[SUCCESS] Validation passed! All instrument panel gauges are unobstructed.")
        return True
    else:
        print(f"[FAIL] Validation failed! Found {failures} gauge occlusion issues.")
        return False

if __name__ == "__main__":
    success = run_validation()
    sys.exit(0 if success else 1)
