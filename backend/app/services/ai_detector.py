import base64
import cv2
import numpy as np
from app.config import settings
from app.services.lane_mapper import map_to_lanes
import logging

logger = logging.getLogger(__name__)

# COCO vehicle classes we care about
VEHICLE_CLASSES = {"car", "motorcycle", "bus", "truck"}
LABEL_MAP = {"motorcycle": "bike"}  # normalize naming

# BGR colors per label
BOX_COLORS = {
    "car":   (255, 200,  50),
    "bike":  (180,  80, 255),
    "bus":   ( 50, 200, 255),
    "truck": ( 50, 255, 130),
}


def _draw_boxes(image: np.ndarray, detections: list) -> np.ndarray:
    """Draw bounding boxes with labels."""
    out = image.copy()
    h, w = out.shape[:2]

    font_scale = max(0.4, min(w, h) / 1000)
    thickness = max(1, int(min(w, h) / 300))

    for det in detections:
        label = det["label"]
        conf = det["confidence"]
        color = BOX_COLORS.get(label, (200, 200, 200))

        x1, y1, x2, y2 = map(int, [det["x1"], det["y1"], det["x2"], det["y2"]])

        # Draw rectangle
        cv2.rectangle(out, (x1, y1), (x2, y2), color, thickness)

        # Label text
        text = f"{label} {conf:.0%}"

        (tw, th), baseline = cv2.getTextSize(
            text, cv2.FONT_HERSHEY_SIMPLEX, font_scale, thickness
        )

        by1 = max(y1 - th - baseline - 4, 0)

        # Background box
        cv2.rectangle(out, (x1, by1), (x1 + tw + 4, y1), color, -1)

        # Text
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


class AIDetector:
    def __init__(self):
        self._model = None

    def _get_model(self):
        if self._model:
            return self._model

        try:
            from ultralytics import YOLO
            self._model = YOLO(settings.YOLO_MODEL)
            logger.info(f"YOLO model loaded: {settings.YOLO_MODEL}")
        except Exception as e:
            logger.error("YOLO load failed: %s", e)
            raise RuntimeError("YOLO model loading failed") from e

        return self._model

    async def analyze_image(self, image_bytes: bytes):
        model = self._get_model()

        # Decode image
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if img is None:
            raise ValueError("Invalid image")

        height, width = img.shape[:2]

        # YOLO inference
        results = model(img)

        boxes_data = []
        detections = []

        for r in results:
            for box in r.boxes:
                cls_id = int(box.cls[0])
                cls_name = model.names[cls_id]

                if cls_name not in VEHICLE_CLASSES:
                    continue

                label = LABEL_MAP.get(cls_name, cls_name)
                conf = float(box.conf[0])

                x1, y1, x2, y2 = box.xyxy[0].tolist()

                # For lane mapping
                cx = (x1 + x2) / 2
                cy = (y1 + y2) / 2
                bw = x2 - x1
                bh = y2 - y1

                boxes_data.append((cx, cy, bw, bh, cls_name))

                # For drawing
                detections.append({
                    "label": label,
                    "confidence": conf,
                    "x1": x1,
                    "y1": y1,
                    "x2": x2,
                    "y2": y2
                })

        # Lane mapping
        lanes_data = map_to_lanes(boxes_data, width, height)

        # Draw bounding boxes
        annotated = _draw_boxes(img, detections)

        # Convert to base64
        success, buf = cv2.imencode(".jpg", annotated)
        if not success:
            raise RuntimeError("Image encoding failed")

        annotated_b64 = base64.b64encode(buf.tobytes()).decode("utf-8")

        # Final response
        lanes_data.update({
            "annotated_image": annotated_b64,
            "detections": detections,
            "image_width": width,
            "image_height": height
        })

        return lanes_data


detector = AIDetector()