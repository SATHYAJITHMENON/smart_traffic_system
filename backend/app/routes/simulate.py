"""
simulate.py — Phase 1 + Phase 3 upgrade
-----------------------------------------
Changes from original:
  1. POST /simulate          — unchanged (legacy, count-based).
  2. POST /simulate/adaptive — NOW uses PhaseSequencer so North/South and
                               East/West are scheduled as conflict-free
                               paired phases instead of ranked independently.
                               The sequencer advances its ring on every call
                               and picks green times via the adaptive formula.
  3. POST /simulate/phase    — NEW. Explicit "advance ring by one phase"
                               endpoint for callers that want direct control
                               over the phase ring (e.g. timed tick loops).
  4. Normal cycle broadcasts go through broadcast_if_unlocked() so they
     are suppressed while an emergency is active.

NOTE: Emergency routes (/emergency, /emergency/clear, /emergency/status)
are owned exclusively by emergency.py. They MUST NOT be duplicated here.
"""

from fastapi import APIRouter
from pydantic import BaseModel, Field
from typing import Optional

from app.models.schemas import SimulateRequest, SimulateResponse, PhaseData
from app.services.traffic_logic import traffic_logic, phase_sequencer, LaneState
from app.websocket import manager
import logging

router = APIRouter()
logger = logging.getLogger(__name__)


# ── Request schemas ──────────────────────────────────────────────────────────

class LaneInput(BaseModel):
    vehicle_count: int   = Field(0,   ge=0,   le=200)
    queue_length:  int   = Field(0,   ge=0,   le=200)
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


# ── 2. Adaptive simulation — now uses PhaseSequencer ─────────────────────────

@router.post("/simulate/adaptive", response_model=SimulateResponse)
async def simulate_adaptive(data: AdaptiveSimulateRequest):
    """
    Conflict-free adaptive signal timing via PhaseSequencer.

    Each call advances the phase ring by one step:
        NS_straight -> EW_straight -> left_turns -> pedestrian -> (repeat)

    Green times for the active lanes are derived from the adaptive formula:
        score = BASE_GREEN + queue * queue_weight + wait * wait_weight
        green_time = clamp(score, MIN_GREEN, MAX_GREEN)

    The PhaseResult's lane_data contains all four directions with:
      - green_time > 0   for lanes active in this phase
      - green_time = 0   for lanes that are red this phase
      - is_active flag   so the frontend knows which lanes are green

    This replaces the old approach of ranking all four lanes independently,
    which could produce conflicting greens (e.g. North green AND East green).
    """

    lane_states = {
        "north": LaneState(**data.north.dict()),
        "south": LaneState(**data.south.dict()),
        "east":  LaneState(**data.east.dict()),
        "west":  LaneState(**data.west.dict()),
    }

    logger.info("Adaptive request — lane states: %s", lane_states)

    # Advance the ring and get the next conflict-free phase
    phase_result = phase_sequencer.next_phase(
        lane_states=lane_states,
        queue_weight=data.queue_weight,
        wait_weight=data.wait_weight,
    )

    logger.info(
        "Phase sequencer -> %s | active: %s | green_time: %ds",
        phase_result.phase_name,
        phase_result.active_lanes,
        phase_result.green_time,
    )

    # Broadcast the rich PhaseResult (includes ped_signals, phase_name, etc.)
    suppressed = not await manager.broadcast_phase_if_unlocked(phase_result)
    if suppressed:
        logger.info("Adaptive broadcast suppressed — emergency in progress.")

    # Also broadcast a flat CYCLE_UPDATE so existing frontend consumers
    # that only listen for CYCLE_UPDATE continue to work without changes.
    await manager.broadcast_if_unlocked({
        "type": "CYCLE_UPDATE",
        "mode": "adaptive",
        "phase": phase_result.phase_name,
        "active_lanes": phase_result.active_lanes,
        "ped_signals": phase_result.ped_signals,
        "data": phase_result.lane_data,
    })

    # Build SimulateResponse with all four lanes.
    # Lanes not active in this phase get green_time=0 (red).
    cycle = [
        PhaseData(
            lane=ld["lane"],
            green_time=ld["green_time"],
            vehicle_count=ld["vehicle_count"],
        )
        for ld in phase_result.lane_data
    ]

    return SimulateResponse(cycle=cycle)


# ── 3. NEW: Explicit phase-ring advance endpoint ───────────────────────────────

@router.post("/simulate/phase", response_model=SimulateResponse)
async def advance_phase(data: Optional[AdaptiveSimulateRequest] = None):
    """
    Advance the PhaseSequencer ring by one step using whatever lane data
    is provided (or defaults if none). Useful for timed tick loops that
    want explicit control over ring advancement rather than tying it to
    the adaptive simulate call.
    """
    lane_states = None
    queue_weight = None
    wait_weight  = None

    if data:
        lane_states = {
            "north": LaneState(**data.north.dict()),
            "south": LaneState(**data.south.dict()),
            "east":  LaneState(**data.east.dict()),
            "west":  LaneState(**data.west.dict()),
        }
        queue_weight = data.queue_weight
        wait_weight  = data.wait_weight

    phase_result = phase_sequencer.next_phase(
        lane_states=lane_states,
        queue_weight=queue_weight,
        wait_weight=wait_weight,
    )

    logger.info(
        "Phase advance -> %s | active: %s | green_time: %ds",
        phase_result.phase_name,
        phase_result.active_lanes,
        phase_result.green_time,
    )

    suppressed = not await manager.broadcast_phase_if_unlocked(phase_result)
    if suppressed:
        logger.info("Phase advance broadcast suppressed — emergency in progress.")

    await manager.broadcast_if_unlocked({
        "type": "CYCLE_UPDATE",
        "mode": "adaptive",
        "phase": phase_result.phase_name,
        "active_lanes": phase_result.active_lanes,
        "ped_signals": phase_result.ped_signals,
        "data": phase_result.lane_data,
    })

    cycle = [
        PhaseData(
            lane=ld["lane"],
            green_time=ld["green_time"],
            vehicle_count=ld["vehicle_count"],
        )
        for ld in phase_result.lane_data
    ]

    return SimulateResponse(cycle=cycle)