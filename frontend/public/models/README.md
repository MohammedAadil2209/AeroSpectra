# 3D models (optional)

Drop Blender exports here and the simulator will use them automatically:

- `aircraft.glb` – the stationary aircraft (any scale; auto-fitted to ~40 m length, nose toward +X)
- `drone.glb`    – the quadcopter assembly exported from the Empty controller (auto-fitted to ~1.4 m)

If a file is missing, the simulator falls back to the built-in procedural model.
Propeller node names are matched by `src/components/simulation/simulationConfig.ts`.
See `../../../blender/README.md` for the export script.
