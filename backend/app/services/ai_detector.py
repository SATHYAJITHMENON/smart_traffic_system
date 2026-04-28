import base64
import cv2
import numpy as np
from app.config import settings
from app.services.lane_mapper import map_to_lanes
import logging

logger = logging.getLogger(__name__)

# 🔥 CONFIDENCE FILTER
CONF_THRESHOLD = 0.4

# 🔥 TRACKER MEMORY
tracker_memory = {}
next_id = 1

# COCO vehicle classes
VEHICLE_CLASSES = {"car", "motorcycle", "bus", "truck"}

# normalize labels
LABEL_MAP = {"motorcycle": "bike"}

# colors
BOX_COLORS = {
    "car":   (255, 200,  50),
    "bike":  (180,  80, 255),
    "bus":   ( 50, 200, 255),
    "truck": ( 50, 255, 130),
}
def _draw_boxes(image: np.ndarray, detections: list) -> np.ndarray:
    out = image.copy()
    h, w = out.shape[:2]

    font_scale = max(0.4, min(w, h) / 1000)
    thickness = max(1, int(min(w, h) / 300))

    for det in detections:
        label = det["label"]
        conf = det["confidence"]
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
            out,
            text,
            (x1 + 2, y1 - baseline - 2),
            cv2.FONT_HERSHEY_SIMPLEX,
            font_scale,
            (0, 0, 0),
            thickness,
        )

    return out


# ── 🔥 TRACKING (NO DUPLICATES) ─────────────────────────────

def _track_objects(detections):
    global tracker_memory, next_id

    updated = []

    for det in detections:
        x1, y1, x2, y2 = det["x1"], det["y1"], det["x2"], det["y2"]

        cx = (x1 + x2) / 2
        cy = (y1 + y2) / 2

        assigned_id = None

        for tid, (tx, ty) in tracker_memory.items():
            dist = ((cx - tx) ** 2 + (cy - ty) ** 2) ** 0.5

            if dist < 50:
                assigned_id = tid
                break

        if assigned_id is None:
            assigned_id = next_id
            next_id += 1

        tracker_memory[assigned_id] = (cx, cy)

        det["track_id"] = assigned_id
        updated.append(det)

    return updated
class AIDetector:
    def __init__(self):
        self._model = None

    def _get_model(self):
        if self._model:
            return self._model

        try:
            from ultralytics import YOLO

            # 🔥 Use upgraded model (fallback safe)
            model_name = getattr(settings, "YOLO_MODEL", "yolov8m.pt")

            self._model = YOLO(model_name)

            logger.info(f"YOLO model loaded: {model_name}")

        except Exception as e:
            logger.error("YOLO load failed: %s", e)
            raise RuntimeError("YOLO model loading failed") from e

        return self._model

    async def analyze_image(self, image_bytes: bytes):
        model = self._get_model()

        # ── Decode image ─────────────────────────
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if img is None:
            raise ValueError("Invalid image")

        height, width = img.shape[:2]

        # ── YOLO INFERENCE ───────────────────────
        results = model(img, conf=CONF_THRESHOLD)

        detections = []

        for r in results:
            for box in r.boxes:
                cls_id = int(box.cls[0])
                cls_name = model.names[cls_id]

                if cls_name not in VEHICLE_CLASSES:
                    continue

                conf = float(box.conf[0])

                # 🔥 Confidence filter
                if conf < CONF_THRESHOLD:
                    continue

                label = LABEL_MAP.get(cls_name, cls_name)

                x1, y1, x2, y2 = box.xyxy[0].tolist()

                detections.append({
                    "label": label,
                    "confidence": conf,
                    "x1": x1,
                    "y1": y1,
                    "x2": x2,
                    "y2": y2
                })

        # ── 🔥 TRACKING ─────────────────────────
        tracked = _track_objects(detections)

        # ── PREPARE FOR LANE MAPPING ────────────
        boxes_data = []

        for det in tracked:
            cx = (det["x1"] + det["x2"]) / 2
            cy = (det["y1"] + det["y2"]) / 2
            bw = det["x2"] - det["x1"]
            bh = det["y2"] - det["y1"]

            boxes_data.append((cx, cy, bw, bh, det["label"]))

        # ── LANE MAPPING ────────────────────────
        lanes_data = map_to_lanes(boxes_data, width, height)

        # ── DRAW BOXES ──────────────────────────
        annotated = _draw_boxes(img, tracked)

        # ── ENCODE IMAGE ────────────────────────
        success, buf = cv2.imencode(".jpg", annotated)
        if not success:
            raise RuntimeError("Image encoding failed")

        annotated_b64 = base64.b64encode(buf.tobytes()).decode("utf-8")

        # ── FINAL RESPONSE ──────────────────────
        lanes_data.update({
            "annotated_image": annotated_b64,
            "detections": tracked,
            "image_width": width,
            "image_height": height
        })

        return lanes_data


# 🔥 CRITICAL FIX (this was missing → caused your error)
detector = AIDetector()