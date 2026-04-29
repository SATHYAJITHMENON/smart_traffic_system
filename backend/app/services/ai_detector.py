import base64
import cv2
import numpy as np
from app.config import settings
from app.services.lane_mapper import map_to_lanes
import logging

logger = logging.getLogger(__name__)

# ── After fine-tuning, point this to your best.pt ────────────────────────────
# Before training: keep "yolov8l.pt"
# After training:  set to full path e.g. "visdrone_finetune/runs/finetune/weights/best.pt"
FINETUNED_WEIGHTS = "yolov8m.pt"

# Image size
IMG_SIZE = 640

# ── Confidence ────────────────────────────────────────────────────────────────
CONF_THRESHOLD = 0.45

# ── Box geometry filters ──────────────────────────────────────────────────────
MIN_BOX_AREA          = 800
MAX_BOX_AREA_FRACTION = 0.18

ASPECT_LIMITS = {
    "car":      (0.5, 4.0),
    "bike":     (0.4, 3.5),
    "bus":      (0.8, 6.0),
    "truck":    (0.6, 6.0),
    "rickshaw": (0.4, 3.0),
}

# ── Flip to True once you have run finetune_visdrone.py ──────────────────────
# False = base COCO model (yolov8l.pt), True = your fine-tuned weights
USING_FINETUNED = False

# COCO base model
COCO_VEHICLE_CLASSES = {"car", "motorcycle", "bus", "truck"}
COCO_LABEL_MAP       = {"motorcycle": "bike"}

# Fine-tuned model outputs these directly
FINETUNED_CLASSES = {"car", "bike", "bus", "truck", "rickshaw"}

# ── Tracker ───────────────────────────────────────────────────────────────────
tracker_memory = {}
next_id = 1

BOX_COLORS = {
    "car":      (255, 200,  50),
    "bike":     (180,  80, 255),
    "bus":      ( 50, 200, 255),
    "truck":    ( 50, 255, 130),
    "rickshaw": (255, 120,  80),
}


# ── Geometry filter ───────────────────────────────────────────────────────────

def _is_valid_box(x1, y1, x2, y2, label, img_w, img_h) -> bool:
    bw   = x2 - x1
    bh   = y2 - y1
    area = bw * bh

    if area < MIN_BOX_AREA:
        return False
    if area > img_w * img_h * MAX_BOX_AREA_FRACTION:
        return False
    if bh == 0:
        return False

    ratio  = bw / bh
    lo, hi = ASPECT_LIMITS.get(label, (0.3, 7.0))
    if not (lo <= ratio <= hi):
        return False

    return True


# ── Drawing ───────────────────────────────────────────────────────────────────

def _draw_boxes(image: np.ndarray, detections: list) -> np.ndarray:
    out = image.copy()
    h, w = out.shape[:2]

    font_scale = max(0.4, min(w, h) / 1000)
    thickness  = max(1, int(min(w, h) / 300))

    for det in detections:
        label = det["label"]
        conf  = det["confidence"]
        color = BOX_COLORS.get(label, (200, 200, 200))

        x1, y1, x2, y2 = map(int, [det["x1"], det["y1"], det["x2"], det["y2"]])
        cv2.rectangle(out, (x1, y1), (x2, y2), color, thickness)

        text = f"{label} {conf:.0%}"
        (tw, th), baseline = cv2.getTextSize(
            text, cv2.FONT_HERSHEY_SIMPLEX, font_scale, thickness
        )
        by1 = max(y1 - th - baseline - 4, 0)
        cv2.rectangle(out, (x1, by1), (x1 + tw + 4, y1), color, -1)
        cv2.putText(
            out, text,
            (x1 + 2, y1 - baseline - 2),
            cv2.FONT_HERSHEY_SIMPLEX,
            font_scale, (0, 0, 0), thickness,
        )

    return out


# ── Tracker ───────────────────────────────────────────────────────────────────

def _track_objects(detections):
    global tracker_memory, next_id

    updated    = []
    new_memory = {}

    for det in detections:
        cx = (det["x1"] + det["x2"]) / 2
        cy = (det["y1"] + det["y2"]) / 2

        assigned_id = None
        min_dist    = float("inf")

        for tid, (tx, ty) in tracker_memory.items():
            dist = ((cx - tx) ** 2 + (cy - ty) ** 2) ** 0.5
            if dist < 60 and dist < min_dist:
                assigned_id = tid
                min_dist    = dist

        if assigned_id is None:
            assigned_id = next_id
            next_id += 1

        new_memory[assigned_id] = (cx, cy)
        det["track_id"] = assigned_id
        updated.append(det)

    tracker_memory.clear()
    tracker_memory.update(new_memory)
    return updated


# ── Detector ──────────────────────────────────────────────────────────────────

class AIDetector:
    def __init__(self):
        self._model = None

    def _get_model(self):
        if self._model:
            return self._model
        from ultralytics import YOLO
        self._model = YOLO(FINETUNED_WEIGHTS)
        logger.info(f"YOLO model loaded: {FINETUNED_WEIGHTS}")
        return self._model

    def _parse_detection(self, box, model):
        cls_id   = int(box.cls[0])
        cls_name = model.names[cls_id]
        conf     = float(box.conf[0])

        if conf < CONF_THRESHOLD:
            return None

        if USING_FINETUNED:
            if cls_name not in FINETUNED_CLASSES:
                return None
            label = cls_name
        else:
            if cls_name not in COCO_VEHICLE_CLASSES:
                return None
            label = COCO_LABEL_MAP.get(cls_name, cls_name)

        x1, y1, x2, y2 = box.xyxy[0].tolist()
        return {
            "label":      label,
            "confidence": conf,
            "x1": x1, "y1": y1,
            "x2": x2, "y2": y2,
        }

    async def analyze_image(self, image_bytes: bytes):
        model = self._get_model()

        nparr = np.frombuffer(image_bytes, np.uint8)
        img   = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if img is None:
            raise ValueError("Invalid image")

        height, width = img.shape[:2]

        results = model.predict(
            source  = img,
            conf    = CONF_THRESHOLD,
            iou     = 0.45,
            imgsz   = IMG_SIZE,
            device  = 0,
            verbose = False,
        )

        detections = []

        for r in results:
            for box in r.boxes:
                det = self._parse_detection(box, model)
                if det is None:
                    continue
                if not _is_valid_box(
                    det["x1"], det["y1"], det["x2"], det["y2"],
                    det["label"], width, height
                ):
                    continue
                detections.append(det)

        tracked    = _track_objects(detections)
        boxes_data = []

        for det in tracked:
            cx = (det["x1"] + det["x2"]) / 2
            cy = (det["y1"] + det["y2"]) / 2
            bw = det["x2"] - det["x1"]
            bh = det["y2"] - det["y1"]
            boxes_data.append((cx, cy, bw, bh, det["label"]))

        lanes_data    = map_to_lanes(boxes_data, width, height)
        annotated     = _draw_boxes(img, tracked)
        success, buf  = cv2.imencode(".jpg", annotated)

        if not success:
            raise RuntimeError("Image encoding failed")

        annotated_b64 = base64.b64encode(buf.tobytes()).decode("utf-8")

        lanes_data.update({
            "annotated_image": annotated_b64,
            "detections":      tracked,
            "image_width":     width,
            "image_height":    height,
        })

        return lanes_data


detector = AIDetector()