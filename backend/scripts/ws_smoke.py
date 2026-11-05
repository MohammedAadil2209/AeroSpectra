"""Smoke test of the real-time event bus: listen on /ws/inspection while running a short session.

usage: python scripts/ws_smoke.py [base_url] [seconds] [source] [aircraft] [upload_id]
"""
import asyncio
import collections
import json
import sys
import time
import urllib.request

import websockets  # installed with uvicorn[standard]

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8001"
SECS = float(sys.argv[2]) if len(sys.argv) > 2 else 12
SOURCE = sys.argv[3] if len(sys.argv) > 3 else "simulation"
AIRCRAFT = sys.argv[4] if len(sys.argv) > 4 else "DEMO-101"
UPLOAD = sys.argv[5] if len(sys.argv) > 5 else None


def post(path, body):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return {"error": e.code, "detail": e.read().decode()}


async def main():
    counts = collections.Counter()
    sample = {}
    async with websockets.connect(BASE.replace("http", "ws") + "/ws/inspection") as ws:
        first = json.loads(await ws.recv())
        print("connected:", first["type"], "ai:", (first["data"].get("ai") or {}).get("status"))
        body = {"aircraft_id": AIRCRAFT, "source": SOURCE, "record": True}
        if UPLOAD:
            body["upload_id"] = UPLOAD
        print("start:", post("/api/inspections/start", body).get("id"))
        t0 = time.time()
        stopped = False
        while time.time() - t0 < SECS + 15:
            if not stopped and time.time() - t0 > SECS and SOURCE != "upload":
                print("stop:", post("/api/inspections/stop", {}))
                stopped = True
            try:
                msg = json.loads(await asyncio.wait_for(ws.recv(), 1.0))
            except asyncio.TimeoutError:
                continue
            counts[msg["type"]] += 1
            sample.setdefault(msg["type"], msg["data"])
            if msg["type"] == "inspection.ended":
                break
    print("events:", dict(counts))
    det = (sample.get("detection.created") or {}).get("detection") or {}
    print("detection sample:", {k: det.get(k) for k in ("id", "category", "confidence", "section", "risk_score", "risk_level", "cost_min", "cost_max", "thumb_url")})
    print("risk breakdown:", json.dumps(det.get("risk_breakdown"))[:300])
    print("ended:", {k: v for k, v in (sample.get("inspection.ended") or {}).items() if k != "inspection"})
    print("kpi:", {k: (sample.get("kpi.updated") or {}).get("analytics", {}).get(k) for k in ("open_defects", "cleared_defects", "by_risk")})


asyncio.run(main())
