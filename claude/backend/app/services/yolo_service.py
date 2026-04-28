"""
YOLO Vehicle Detection Service
--------------------------------
Loads YOLOv8n (auto-downloads weights on first run), runs inference on an
image, splits the frame into four equal quadrants (North / South / East / West)
and counts cars, motorcycles, trucks and buses per quadrant.

COCO class IDs used:
  2  → car
  3  → motorcycle  (reported as 'bikes')
  5  → bus
  7  → truck
"""

import logging
import os
from pathlib import Path
from typing import Dict

import cv2
import numpy as np

logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

# COCO class IDs we care about
VEHICLE_CLASS_IDS: Dict[int, str] = {
    2: "cars",
    3: "bikes",       # motorcycle → bikes
    5: "buses",
    7: "trucks",
}

MODEL_DIR  = Path(__file__).resolve().parents[3] / "model"
MODEL_NAME = "yolov8n.pt"
MODEL_PATH = MODEL_DIR / MODEL_NAME

CONFIDENCE_THRESHOLD = 0.30   # detections below this are discarded
IOU_THRESHOLD        = 0.45   # NMS IoU threshold


# ── Model Loader (singleton) ──────────────────────────────────────────────────

_model = None  # module-level cache; loaded once per worker process


def _get_model():
    """Return the cached YOLO model, loading it if necessary."""
    global _model
    if _model is not None:
        return _model

    try:
        from ultralytics import YOLO  # deferred import – keeps startup fast
    except ImportError as exc:
        raise RuntimeError(
            "ultralytics is not installed. Run: pip install ultralytics"
        ) from exc

    MODEL_DIR.mkdir(parents=True, exist_ok=True)

    if not MODEL_PATH.exists():
        logger.info(
            "YOLOv8 weights not found at %s – downloading automatically …",
            MODEL_PATH,
        )
    else:
        logger.info("Loading YOLOv8 weights from %s", MODEL_PATH)

    # YOLO() auto-downloads weights when given a model name; passing the full
    # path re-uses the already-downloaded file on subsequent calls.
    _model = YOLO(str(MODEL_PATH) if MODEL_PATH.exists() else MODEL_NAME)

    # Persist weights to our model/ directory so next call is instant.
    if not MODEL_PATH.exists():
        src = Path(_model.ckpt_path)
        if src.exists() and src != MODEL_PATH:
            import shutil
            shutil.copy(src, MODEL_PATH)
            logger.info("Weights cached to %s", MODEL_PATH)

    logger.info("YOLOv8 model ready.")
    return _model


# ── Region Splitting ──────────────────────────────────────────────────────────

def _split_into_quadrants(image: np.ndarray) -> Dict[str, np.ndarray]:
    """
    Divide image into four equal quadrants mapped to compass directions:

        ┌──────────┬──────────┐
        │  North   │  North   │
        │  (NW)    │  (NE)    │
        ├──────────┼──────────┤
        │  South   │  South   │
        │  (SW)    │  (SE)    │
        └──────────┴──────────┘

    Top half  → North
    Bottom half → South
    Left half  → West
    Right half → East

    Each direction gets exactly one quadrant so every pixel belongs to exactly
    one direction (no overlap).
    """
    h, w = image.shape[:2]
    mid_h, mid_w = h // 2, w // 2

    return {
        "north": image[0:mid_h,    0:w],       # top strip  (full width)
        "south": image[mid_h:h,    0:w],       # bottom strip
        "east":  image[0:h,        mid_w:w],   # right strip (full height)
        "west":  image[0:h,        0:mid_w],   # left strip
    }


def _empty_counts() -> Dict[str, int]:
    return {"cars": 0, "bikes": 0, "trucks": 0, "buses": 0}


# ── Core Detection ────────────────────────────────────────────────────────────

def detect_vehicles_in_image(image_bytes: bytes) -> Dict[str, Dict[str, int]]:
    """
    Run YOLOv8 inference on raw image bytes.

    Returns
    -------
    dict with keys north / south / east / west, each containing:
        { "cars": int, "bikes": int, "trucks": int, "buses": int }
    """
    # ── Decode image ──────────────────────────────────────────────────────────
    nparr = np.frombuffer(image_bytes, np.uint8)
    image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if image is None:
        raise ValueError(
            "Could not decode image. Make sure the upload is a valid "
            "JPEG, PNG, or BMP file."
        )

    if image.ndim != 3 or image.shape[2] != 3:
        raise ValueError("Image must be a 3-channel colour image (RGB/BGR).")

    h, w = image.shape[:2]
    if h < 32 or w < 32:
        raise ValueError(
            f"Image too small ({w}×{h}). Minimum size is 32×32 pixels."
        )

    model = _get_model()

    # ── Run inference on the full frame ───────────────────────────────────────
    results = model.predict(
        source=image,
        conf=CONFIDENCE_THRESHOLD,
        iou=IOU_THRESHOLD,
        verbose=False,
        classes=list(VEHICLE_CLASS_IDS.keys()),
    )

    # ── Initialise per-direction counters ─────────────────────────────────────
    counts: Dict[str, Dict[str, int]] = {
        "north": _empty_counts(),
        "south": _empty_counts(),
        "east":  _empty_counts(),
        "west":  _empty_counts(),
    }

    mid_h = h // 2
    mid_w = w // 2

    if not results or results[0].boxes is None:
        logger.info("No vehicles detected in image.")
        return counts

    boxes = results[0].boxes  # ultralytics Boxes object

    for box in boxes:
        cls_id = int(box.cls[0].item())
        if cls_id not in VEHICLE_CLASS_IDS:
            continue

        vehicle_type = VEHICLE_CLASS_IDS[cls_id]

        # Centre-point of bounding box
        x1, y1, x2, y2 = box.xyxy[0].tolist()
        cx = (x1 + x2) / 2
        cy = (y1 + y2) / 2

        # Assign to directions based on centre-point position.
        # A detection can contribute to two directions (e.g. north AND west).
        if cy < mid_h:
            counts["north"][vehicle_type] += 1
        else:
            counts["south"][vehicle_type] += 1

        if cx >= mid_w:
            counts["east"][vehicle_type] += 1
        else:
            counts["west"][vehicle_type] += 1

    logger.info(
        "Detection complete. Totals – N:%s S:%s E:%s W:%s",
        counts["north"], counts["south"], counts["east"], counts["west"],
    )
    return counts


def get_model_name() -> str:
    """Return the model variant string for use in API responses."""
    return MODEL_NAME
