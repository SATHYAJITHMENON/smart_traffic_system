"""
YOLO Vehicle Detection Service (UPGRADED)
----------------------------------------
✔ yolov8m (better accuracy)
✔ confidence filtering improved
✔ tracking support added
✔ polygon lane mapping
✔ original structure preserved
"""

import logging
import os
from pathlib import Path
from typing import Dict

import cv2
import numpy as np
from shapely.geometry import Point, Polygon  # 🔥 NEW

logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

VEHICLE_CLASS_IDS: Dict[int, str] = {
    2: "cars",
    3: "bikes",
    5: "buses",
    7: "trucks",
}

MODEL_DIR  = Path(__file__).resolve().parents[3] / "model"

# 🔥 UPGRADE MODEL
MODEL_NAME = "yolov8m.pt"
MODEL_PATH = MODEL_DIR / MODEL_NAME

CONFIDENCE_THRESHOLD = 0.40
IOU_THRESHOLD        = 0.45

# ── 🔥 TRACKING MEMORY ────────────────────────────────────────────────────────

tracker_memory = {}
next_id = 1

# ── 🔥 LANE POLYGONS ─────────────────────────────────────────────────────────

LANE_POLYGONS = {
    "north": Polygon([(200, 0), (440, 0), (380, 260), (260, 260)]),
    "south": Polygon([(200, 560), (440, 560), (380, 300), (260, 300)]),
    "east":  Polygon([(440, 200), (640, 200), (640, 360), (440, 360)]),
    "west":  Polygon([(0, 200), (200, 200), (200, 360), (0, 360)])
}

# ── Model Loader ─────────────────────────────────────────────────────────────

_model = None


def _get_model():
    global _model
    if _model is not None:
        return _model

    try:
        from ultralytics import YOLO
    except ImportError:
        raise RuntimeError("Run: pip install ultralytics")

    MODEL_DIR.mkdir(parents=True, exist_ok=True)

    _model = YOLO(str(MODEL_PATH) if MODEL_PATH.exists() else MODEL_NAME)

    logger.info("YOLOv8 model ready (%s)", MODEL_NAME)
    return _model
# ── Utility ──────────────────────────────────────────────────────────────────

def _empty_counts() -> Dict[str, int]:
    return {"cars": 0, "bikes": 0, "trucks": 0, "buses": 0}


# ── 🔥 SIMPLE TRACKER (NO DUPLICATE COUNTING) ────────────────────────────────

def track_objects(detections):
    global tracker_memory, next_id

    updated = []

    for det in detections:
        x1, y1, x2, y2 = det["bbox"]
        cx = (x1 + x2) / 2
        cy = (y1 + y2) / 2

        assigned_id = None

        # match with previous objects
        for tid, (tx, ty) in tracker_memory.items():
            dist = ((cx - tx) ** 2 + (cy - ty) ** 2) ** 0.5

            if dist < 50:   # 🔥 distance threshold
                assigned_id = tid
                break

        # new object
        if assigned_id is None:
            assigned_id = next_id
            next_id += 1

        tracker_memory[assigned_id] = (cx, cy)

        det["track_id"] = assigned_id
        updated.append(det)

    return updated


# ── 🔥 POLYGON LANE MAPPING (ACCURATE) ───────────────────────────────────────

def map_to_lanes(detections):
    counts = {
        "north": _empty_counts(),
        "south": _empty_counts(),
        "east": _empty_counts(),
        "west": _empty_counts(),
    }

    seen_ids = set()

    for det in detections:
        x1, y1, x2, y2 = det["bbox"]
        cx = (x1 + x2) / 2
        cy = (y1 + y2) / 2

        point = Point(cx, cy)
        vehicle_type = det["type"]

        for lane, poly in LANE_POLYGONS.items():
            if poly.contains(point):
                tid = det["track_id"]

                # 🔥 avoid duplicate counting
                if tid not in seen_ids:
                    counts[lane][vehicle_type] += 1
                    seen_ids.add(tid)

    return counts
def detect_vehicles_in_image(image_bytes: bytes) -> Dict[str, Dict[str, int]]:
    """
    Upgraded pipeline:
    YOLO → Confidence filter → Tracking → Polygon lane mapping
    """

    # ── Decode image ─────────────────────────────────────────
    nparr = np.frombuffer(image_bytes, np.uint8)
    image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if image is None:
        raise ValueError("Invalid image")

    if image.ndim != 3 or image.shape[2] != 3:
        raise ValueError("Image must be 3-channel")

    h, w = image.shape[:2]
    if h < 32 or w < 32:
        raise ValueError("Image too small")

    model = _get_model()

    # ── YOLO INFERENCE (UPGRADED) ─────────────────────────────
    results = model.predict(
        source=image,
        conf=CONFIDENCE_THRESHOLD,
        iou=IOU_THRESHOLD,
        verbose=False,
        classes=list(VEHICLE_CLASS_IDS.keys()),
    )

    # ── EMPTY RESULT ──────────────────────────────────────────
    if not results or results[0].boxes is None:
        return {
            "north": _empty_counts(),
            "south": _empty_counts(),
            "east":  _empty_counts(),
            "west":  _empty_counts(),
        }

    # ── EXTRACT DETECTIONS ────────────────────────────────────
    detections = []

    for box in results[0].boxes:
        cls_id = int(box.cls[0].item())
        conf = float(box.conf[0].item())

        if cls_id not in VEHICLE_CLASS_IDS:
            continue

        # 🔥 CONFIDENCE FILTER
        if conf < CONFIDENCE_THRESHOLD:
            continue

        x1, y1, x2, y2 = box.xyxy[0].tolist()

        detections.append({
            "bbox": [x1, y1, x2, y2],
            "type": VEHICLE_CLASS_IDS[cls_id],
        })

    # ── 🔥 TRACKING ───────────────────────────────────────────
    tracked = track_objects(detections)

    # ── 🔥 LANE MAPPING ───────────────────────────────────────
    counts = map_to_lanes(tracked)

    logger.info("Detection complete: %s", counts)

    return counts