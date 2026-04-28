# app/services/tracker_service.py

import numpy as np

class SimpleTracker:
    def __init__(self):
        self.next_id = 1
        self.tracks = {}

    def update(self, detections):
        updated_tracks = []

        for det in detections:
            x1, y1, x2, y2 = det["bbox"]
            cx = (x1 + x2) / 2
            cy = (y1 + y2) / 2

            assigned_id = None

            # 🔥 SIMPLE DISTANCE MATCHING
            for tid, track in self.tracks.items():
                tx, ty = track["center"]

                dist = ((cx - tx) ** 2 + (cy - ty) ** 2) ** 0.5

                if dist < 50:
                    assigned_id = tid
                    break

            if assigned_id is None:
                assigned_id = self.next_id
                self.next_id += 1

            self.tracks[assigned_id] = {
                "center": (cx, cy)
            }

            det["track_id"] = assigned_id
            updated_tracks.append(det)

        return updated_tracks