import cv2
import numpy as np
from ultralytics import YOLO
from app.config import settings
from app.services.lane_mapper import map_to_lanes

class AIDetector:
    def __init__(self):
        self.model = YOLO(settings.YOLO_MODEL)
        
    async def analyze_image(self, image_bytes: bytes):
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if img is None:
            raise ValueError("Invalid image content")
            
        height, width, _ = img.shape
        
        # Run YOLO inference
        results = self.model(img)
        
        boxes_data = []
        for r in results:
            boxes = r.boxes
            for box in boxes:
                x1, y1, x2, y2 = box.xyxy[0]
                cls_id = int(box.cls[0])
                cls_name = self.model.names[cls_id]
                
                cx = (x1 + x2) / 2
                cy = (y1 + y2) / 2
                w = x2 - x1
                h = y2 - y1
                
                boxes_data.append((cx.item(), cy.item(), w.item(), h.item(), cls_name))
                
        lanes_data = map_to_lanes(boxes_data, width, height)
        return lanes_data

detector = AIDetector()
