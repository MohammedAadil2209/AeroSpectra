"""
AeroSpectra — Blender export + inspection-path helper.

Run inside Blender (Scripting workspace → Open → Run Script), with AeroSpectra.blend open.

What it does
1. (optional) Builds the elongated oval inspection animation:
   - Converts/uses the Bezier Circle as the path, scales it to an oval around the aircraft
   - Adds a Follow Path constraint on the drone controller Empty (forward axis +X)
   - Animates the path offset 0 → 100 % over FRAMES (one full loop)
   Route: start beside LEFT wing → around NOSE → RIGHT side → around TAIL → back up LEFT side.
2. Exports the aircraft and the drone as SEPARATE GLB files into frontend/public/models/:
   - aircraft.glb  (every object NOT in the drone hierarchy, cameras/curves/lights excluded)
   - drone.glb     (the Empty controller and its 17 children, exported at the origin)

The web simulator recreates the flight route itself in Three.js, so exporting the
Blender animation is optional — only the meshes are required.

Edit the CONFIG block to match your object names.
"""
import math
import os

import bpy

# ------------------------------------------------------------------ CONFIG
DRONE_CONTROLLER = "Empty"            # the Empty that parents Quadcopter_Drone_Part01..17
DRONE_PART_PREFIX = "Quadcopter_Drone_Part"
PATH_CURVE = "BezierCircle"           # Blender's default name for "Bezier Circle"
AIRCRAFT_LENGTH_AXIS = "Y"            # axis the fuselage runs along in your scene ("X" or "Y")
CLEARANCE = 5.0                       # metres of standoff beyond the aircraft bounds
INSPECTION_HEIGHT = 4.5               # metres above ground
FRAMES = 600                          # one full loop (25 fps → 24 s)
BUILD_ANIMATION = True
OUT_DIR = os.path.join(os.path.dirname(bpy.data.filepath) or os.getcwd(), "..", "frontend", "public", "models")
# Set this if the .blend file is not stored inside the AeroSpectra project folder:
# OUT_DIR = "/Users/you/Documents/BuildX/AeroSpectra/frontend/public/models"
# ------------------------------------------------------------------


def drone_objects():
    root = bpy.data.objects.get(DRONE_CONTROLLER)
    if root is None:
        raise RuntimeError(f"Drone controller '{DRONE_CONTROLLER}' not found — edit CONFIG.")
    objs = [root] + list(root.children_recursive)
    missing = [o.name for o in bpy.data.objects if o.name.startswith(DRONE_PART_PREFIX) and o not in objs]
    if missing:
        print("WARNING: drone parts not parented to the controller:", missing)
    return root, objs


def aircraft_objects(exclude):
    skip_types = {"CAMERA", "LIGHT", "CURVE", "EMPTY"}
    return [o for o in bpy.data.objects if o not in exclude and o.type not in skip_types and o.visible_get()]


def world_bounds(objs):
    xs, ys, zs = [], [], []
    for o in objs:
        if o.type != "MESH":
            continue
        for c in o.bound_box:
            w = o.matrix_world @ __import__("mathutils").Vector(c)
            xs.append(w.x), ys.append(w.y), zs.append(w.z)
    return (min(xs), max(xs)), (min(ys), max(ys)), (min(zs), max(zs))


def build_inspection_animation(root, aircraft):
    (x0, x1), (y0, y1), _ = world_bounds(aircraft)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    half_len = ((y1 - y0) if AIRCRAFT_LENGTH_AXIS == "Y" else (x1 - x0)) / 2 + CLEARANCE
    half_span = ((x1 - x0) if AIRCRAFT_LENGTH_AXIS == "Y" else (y1 - y0)) / 2 + CLEARANCE

    curve = bpy.data.objects.get(PATH_CURVE)
    if curve is None:
        bpy.ops.curve.primitive_bezier_circle_add(radius=1.0)
        curve = bpy.context.active_object
        curve.name = PATH_CURVE
    curve.location = (cx, cy, INSPECTION_HEIGHT)
    curve.rotation_euler = (0, 0, 0)
    # elongated oval: long axis along the fuselage
    if AIRCRAFT_LENGTH_AXIS == "Y":
        curve.scale = (half_span, half_len, 1)
    else:
        curve.scale = (half_len, half_span, 1)
    curve.data.path_duration = FRAMES
    curve.data.use_path = True

    root.constraints.clear()
    root.location = (0, 0, 0)
    con = root.constraints.new("FOLLOW_PATH")
    con.target = curve
    con.use_curve_follow = True
    con.forward_axis = "FORWARD_X"
    con.up_axis = "UP_Z"
    con.use_fixed_location = True
    con.offset_factor = 0.0
    con.keyframe_insert("offset_factor", frame=1)
    con.offset_factor = 1.0
    con.keyframe_insert("offset_factor", frame=FRAMES)
    # linear interpolation → constant speed
    if root.animation_data and root.animation_data.action:
        for fc in root.animation_data.action.fcurves:
            for kp in fc.keyframe_points:
                kp.interpolation = "LINEAR"
    bpy.context.scene.frame_start = 1
    bpy.context.scene.frame_end = FRAMES
    print(f"Oval path: {2 * half_len:.1f} m × {2 * half_span:.1f} m at {INSPECTION_HEIGHT} m, {FRAMES} frames.")
    print("If the drone starts at the wrong place or flies the wrong way, rotate the curve 90°/180° about Z")
    print("or toggle Curve > Segments > Switch Direction so it starts beside the LEFT wing heading to the NOSE.")


def export_selection(objs, path, at_origin=None):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    saved = None
    if at_origin is not None:
        saved = (at_origin.location.copy(), [c.mute for c in at_origin.constraints])
        for c in at_origin.constraints:
            c.mute = True
        at_origin.location = (0, 0, 0)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_animations=False,
    )
    if saved:
        at_origin.location = saved[0]
        for c, m in zip(at_origin.constraints, saved[1]):
            c.mute = m
    print("Exported", path)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    root, drone = drone_objects()
    aircraft = aircraft_objects(set(drone))
    print(f"Drone: {len(drone)} objects · Aircraft: {len(aircraft)} objects")
    if BUILD_ANIMATION:
        build_inspection_animation(root, aircraft)
    export_selection(aircraft, os.path.join(OUT_DIR, "aircraft.glb"))
    export_selection(drone, os.path.join(OUT_DIR, "drone.glb"), at_origin=root)
    print("Done. Reload the AeroSpectra simulator — the badge will read 'Aircraft model: Blender GLB'.")
    print("Tip: list propeller part names in frontend/src/components/simulation/simulationConfig.ts → MODELS.propellerNodes")


main()
