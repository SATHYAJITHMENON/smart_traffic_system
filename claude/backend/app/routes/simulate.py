"""
Simulate routes — Phase 1 upgrade
-----------------------------------
Changes from original:
  1. POST /simulate          — unchanged (legacy, count-based).
  2. POST /simulate/adaptive — NEW. Accepts queue_length, avg_wait_time,
                               and optional weight overrides per lane.
                               Uses calculate_adaptive_cycle().
  3. POST /simulate/emergency — now delegates freeze logic to
                               manager.trigger_emergency() instead of
                               doing a plain broadcast.
  4. POST /simulate/emergency/clear — NEW. Lets the frontend cancel an
                               active emergency before the 30-s timer expires.
  5. Normal cycle broadcasts go through broadcast_if_unlocked() so they
     are suppressed while an emergency is active.
"""

from fastapi import APIRouter
from pydantic import BaseModel, Field
from typing import Optional

from app.models.schemas import SimulateRequest, SimulateResponse, PhaseData
from app.services.traffic_logic import traffic_logic, LaneState
from app.websocket import manager
import logging

router = APIRouter()
logger = logging.getLogger(__name__)


# ── Request schemas for the new adaptive endpoint ────────────────────────────

class LaneInput(BaseModel):
    vehicle_count: int = Field(0, ge=0, le=200)
    queue_length:  int = Field(0, ge=0, le=200)
    avg_wait_time: float = Field(0.0, ge=0.0, le=600.0)


class AdaptiveSimulateRequest(BaseModel):
    north: LaneInput = LaneInput()
    south: LaneInput = LaneInput()
    east:  LaneInput = LaneInput()
    west:  LaneInput = LaneInput()

    # Optional per-request weight overrides (matches the frontend sliders)
    queue_weight: Optional[float] = Field(None, ge=0.0, le=10.0)
    wait_weight:  Optional[float] = Field(None, ge=0.0, le=5.0)


# ── 1. Legacy normal simulation (UNCHANGED behaviour) ─────────────────────────

@router.post("/simulate", response_model=SimulateResponse)
async def simulate_traffic(data: SimulateRequest):

    vehicle_counts: dict[str, int] = {}
    for lane in ("north", "south", "east", "west"):
        counts_obj = data.counts_for(lane)
        vehicle_counts[lane] = counts_obj.total

    logger.info("Incoming vehicle counts: %s", vehicle_counts)

    cycle_raw = traffic_logic.calculate_cycle(vehicle_counts)

    logger.info("Generated cycle: %s", cycle_raw)

    # Suppressed automatically if an emergency is active
    await manager.broadcast_if_unlocked({
        "type": "CYCLE_UPDATE",
        "mode": "legacy",
        "data": cycle_raw,
    })

    cycle = [
        PhaseData(
            lane=phase["lane"],
            green_time=phase["green_time"],
            vehicle_count=vehicle_counts.get(phase["lane"], 0),
        )
        for phase in cycle_raw
    ]

    return SimulateResponse(cycle=cycle)


# ── 2. NEW: Adaptive simulation ───────────────────────────────────────────────

@router.post("/simulate/adaptive", response_model=SimulateResponse)
async def simulate_adaptive(data: AdaptiveSimulateRequest):
    """
    Adaptive signal timing endpoint.

    The frontend sends per-lane:
      - vehicle_count : total vehicles in lane
      - queue_length  : vehicles waiting at stop line
      - avg_wait_time : average seconds waiting this cycle

    And optionally two weight sliders:
      - queue_weight (default 2.5 s/vehicle)
      - wait_weight  (default 0.4 s/s-of-wait)
    """

    lane_states = {
        "north": LaneState(**data.north.dict()),
        "south": LaneState(**data.south.dict()),
        "east":  LaneState(**data.east.dict()),
        "west":  LaneState(**data.west.dict()),
    }

    logger.info("Adaptive request — lane states: %s", lane_states)

    cycle_raw = traffic_logic.calculate_adaptive_cycle(
        lane_states,
        queue_weight=data.queue_weight,
        wait_weight=data.wait_weight,
    )

    logger.info("Adaptive cycle: %s", cycle_raw)

    suppressed = not await manager.broadcast_if_unlocked({
        "type": "CYCLE_UPDATE",
        "mode": "adaptive",
        "data": cycle_raw,
    })

    if suppressed:
        logger.info("Adaptive broadcast suppressed — emergency in progress.")

    cycle = [
        PhaseData(
            lane=phase["lane"],
            green_time=phase["green_time"],
            vehicle_count=phase["vehicle_count"],
        )
        for phase in cycle_raw
    ]

    return SimulateResponse(cycle=cycle)


# ── 3. Emergency override (upgraded) ─────────────────────────────────────────

@router.post("/simulate/emergency", response_model=SimulateResponse)
async def simulate_emergency(payload: dict):

    lane = payload.get("lane")

    if lane not in ("north", "south", "east", "west"):
        logger.warning("Invalid emergency lane: %s", lane)
        return SimulateResponse(cycle=[])

    logger.warning("🚑 EMERGENCY TRIGGERED: %s", lane)

    cycle_raw = traffic_logic.calculate_emergency_cycle(lane)

    # Freeze normal cycles + broadcast via manager
    await manager.trigger_emergency(lane, cycle_raw)

    cycle = [
        PhaseData(
            lane=phase["lane"],
            green_time=phase["green_time"],
            vehicle_count=phase.get("vehicle_count", 0),
        )
        for phase in cycle_raw
    ]

    return SimulateResponse(cycle=cycle)


# ── 4. NEW: Cancel emergency before timer expires ─────────────────────────────

@router.post("/simulate/emergency/clear")
async def clear_emergency():
    """Manually cancel an active emergency override."""
    if not manager.emergency_active:
        return {"message": "No active emergency to clear.", "cleared": False}

    lane = manager.emergency_lane
    await manager.clear_emergency()

    return {
        "message": f"Emergency on {lane} cleared. Normal cycle resuming.",
        "cleared": True,
        "lane": lane,
    }