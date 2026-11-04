# AeroScan: drone exterior defect inspection

One-page dashboard for spotting aircraft exterior surface defects with a trained YOLO model.
The live annotated drone feed appears in a cut-away window on the aircraft. Each physical defect is
tracked with ByteTrack and counted once, then tagged to the section the operator selected.

## Setup (Windows, RTX GPU)

Copy `server.py` and `static/` into the project folder that already contains `live_detect.py` and
`runs/detect/aircraft/weights/best.pt`. In the same environment that has ultralytics and CUDA torch:

```bash
pip install -r requirements.txt
python server.py            # → http://localhost:8000
```

On CUDA it runs `half=True` automatically. It falls back to MPS or CPU elsewhere. Class names are read from
`model.names`. Optional environment variables: `AEROSCAN_WEIGHTS`, `AEROSCAN_PORT`, `AEROSCAN_IMGSZ` (default 640),
and `AEROSCAN_MIN_HITS` (frames a track must be seen before it counts, default 2).

## Demo flow

1. **Aircraft** tab: enter the registration, aircraft type and inspector, and set the confidence threshold.
2. **Exterior** tab: connect a source.
   - **Drone feed**: `rtsp://192.168.1.1:7070/webcam` (join the drone's Wi-Fi first)
   - **Screen mirror**: run `scrcpy`, then enter the window region as `left,top,width,height`
   - **Webcam** (by device index) or **Upload** an image or video. Videos play at real-time speed.
3. Select the section the drone is looking at: click the aircraft, use the Sections pill, or press keys `1`–`5`
   (`N` for next). New defects are tagged to that section.
4. Click a chip in the Defect Map to see its best-frame snapshot. **Defects** lists them all; **Summary** has the
   health score, a section × class table, **Download CSV** and **Print report**.

The health score is 100 minus severity weights per unique defect (crack 15, corrosion 10, missing fastener 8,
dent 6, paint 3, scratch 2, other 5), with a floor of 0.
80 and above is *Serviceable*, 50 and above is *Inspection required*, and anything lower is *Engineering review*.
**This score is advisory only.** It is not a maintenance release.

## Notes

- `LatestFrame` from `live_detect.py` is used for RTSP, webcam and screen sources when it can be imported.
  If it fails to construct or sends no frame within 6 s, the server uses a built-in threaded reader instead.
  The state endpoint reports which reader is in use under `source.via`.
- Connecting never blocks a request. The status moves from `connecting` to `live`, `finished` or `error`.
- The tracker resets whenever the source changes, and on **Reset**.
- API docs: `http://localhost:8000/api/docs`.
