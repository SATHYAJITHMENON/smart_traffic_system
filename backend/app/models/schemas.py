"""
schemas.py  –  Pydantic models for TrafficAI API  (v2)
-------------------------------------------------------
Changes vs v1:
  ✅ VehicleCounts.rickshaws field added (Indian traffic)
  ✅ AnalyzeImageResponse.image_width / image_height added
  ✅ DetectionBox.track_id field added (from tracker_service)
  ✅ Helper: VehicleCounts.weighted_load() for PCU-based green time
  ✅ All existing fields/defaults preserved — fully backward-compatible
"""

from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


# ── Vehicle counts ─────────────────────────────────────────────────────────────

# PCU weights for green-time calculation
_PCU: dict = {
    "cars": 1.0,
    "bikes": 0.5,
    "buses": 2.5,
    "trucks": 2.0,
    "rickshaws": 0.75,
}


class VehicleCounts(BaseModel):
    """Per-vehicle-type breakdown for one lane."""
    cars:      int = 0
    bikes:     int = 0
    buses:     int = 0
    trucks:    int = 0
    rickshaws: int = 0   # ✅ NEW: auto-rickshaws (common in Indian traffic)

    @property
    def total(self) -> int:
        return self.cars + self.bikes + self.buses + self.trucks + self.rickshaws

    def weighted_load(self) -> float:
        """PCU-weighted load — use this for green-time proportioning."""
        return (
            self.cars      * _PCU["cars"]      +
            self.bikes     * _PCU["bikes"]     +
            self.buses     * _PCU["buses"]     +
            self.trucks    * _PCU["trucks"]    +
            self.rickshaws * _PCU["rickshaws"]
        )


# ── Request / Response models ──────────────────────────────────────────────────

class SimulateRequest(BaseModel):
    """
    Simulation request.

    Simple mode  – provide plain integer counts per lane.
    Rich mode    – provide `*_counts` breakdown for weighted timing.
    Both modes can be mixed per lane.
    """
    # Simple mode (backward-compatible)
    north: int = 0
    south: int = 0
    east:  int = 0
    west:  int = 0

    # Rich mode – per-vehicle-type counts per lane
    north_counts: Optional[VehicleCounts] = None
    south_counts: Optional[VehicleCounts] = None
    east_counts:  Optional[VehicleCounts] = None
    west_counts:  Optional[VehicleCounts] = None

    def counts_for(self, lane: str) -> VehicleCounts:
        """
        Return VehicleCounts for a lane.
        Uses rich counts if supplied; wraps the plain int as cars otherwise.
        """
        rich = getattr(self, f"{lane}_counts", None)
        if rich is not None:
            return rich
        simple = getattr(self, lane, 0)
        return VehicleCounts(cars=simple)

    def weighted_load_for(self, lane: str) -> float:
        """PCU-weighted load for a lane — shortcut for the simulation router."""
        return self.counts_for(lane).weighted_load()


class PhaseData(BaseModel):
    """One phase in a traffic signal cycle."""
    lane:          str
    green_time:    int
    vehicle_count: int   = 0
    weighted_load: float = 0.0


class SimulateResponse(BaseModel):
    cycle: List[PhaseData]


class EmergencyRequest(BaseModel):
    lane: str


class EmergencyResponse(BaseModel):
    message:     str
    active_lane: str


# ── AI analysis schemas ────────────────────────────────────────────────────────

class TrafficDensity(BaseModel):
    north: VehicleCounts
    south: VehicleCounts
    east:  VehicleCounts
    west:  VehicleCounts


class DetectionBox(BaseModel):
    """Single YOLO bounding box detection."""
    label:      str
    confidence: float
    x1: float
    y1: float
    x2: float
    y2: float
    track_id: Optional[int] = None   # ✅ NEW: assigned by tracker_service


class AnalyzeImageResponse(BaseModel):
    """Full response from /analyze-image."""
    north: VehicleCounts
    south: VehicleCounts
    east:  VehicleCounts
    west:  VehicleCounts
    # Base64-encoded JPEG with bounding boxes drawn
    annotated_image: Optional[str] = None
    # Raw per-detection list
    detections: List[DetectionBox] = []
    # Image dimensions (useful for frontend canvas scaling)
    image_width:  int = 0   # ✅ NEW
    image_height: int = 0   # ✅ NEW
    # Summary stats
    total_vehicles:  int   = 0
    dead_zone_count: int   = 0
    model_used:      str   = ""