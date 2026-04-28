import cv2
import numpy as np
from app.config import settings
from app.services.lane_mapper import map_to_lanes
import logging

logger = logging.getLogger(__name__)


class AIDetector:
    def __init__(self):
        # Defer YOLO load to first use so a missing model file does not
        # crash the entire application on startup.
        self._model = None

    def _get_model(self):
        """Lazy-load YOLO model. Raises RuntimeError if model is unavailable."""
        if self._model is not None:
            return self._model
        try:
            from ultralytics import YOLO
            self._model = YOLO(settings.YOLO_MODEL)
            logger.info("YOLO model loaded from %s", settings.YOLO_MODEL)
        except Exception as exc:
            logger.error("Failed to load YOLO model: %s", exc)
            raise RuntimeError(
                f"YOLO model could not be loaded from '{settings.YOLO_MODEL}'. "
                "Ensure the model file exists and ultralytics is installed."
            ) from exc
        return self._model

    async def analyze_image(self, image_bytes: bytes):
        model = self._get_model()  # raises RuntimeError if absent

        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if img is None:
            raise ValueError("Invalid image content")

        height, width, _ = img.shape

        # Run YOLO inference
        results = model(img)

        boxes_data = []
        for r in results:
            boxes = r.boxes
            for box in boxes:
                x1, y1, x2, y2 = box.xyxy[0]
                cls_id = int(box.cls[0])
                cls_name = model.names[cls_id]

                cx = (x1 + x2) / 2
                cy = (y1 + y2) / 2
                w = x2 - x1
                h = y2 - y1

                boxes_data.append((cx.item(), cy.item(), w.item(), h.item(), cls_name))

        lanes_data = map_to_lanes(boxes_data, width, height)
        return lanes_data


detector = AIDetector()