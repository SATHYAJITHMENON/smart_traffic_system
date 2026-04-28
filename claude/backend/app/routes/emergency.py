"""
Emergency route — Phase 1 upgrade
-----------------------------------
Changes from original:
  - POST /emergency now calls manager.trigger_emergency() which:
      a) sets the freeze flag in ConnectionManager
      b) broadcasts EMERGENCY_OVERRIDE with duration info
      c) schedules auto-clear after EMERGENCY_DURATION_S seconds
  - Added GET /emergency/status so the frontend can poll state.
  - Added POST /emergency/clear to cancel an override early.

The route at /simulate/emergency also triggers emergencies (used by the
simulation page). Both routes share the same manager state.
"""

from fastapi import APIRouter
from app.models.schemas import EmergencyRequest, EmergencyResponse
from app.services.traffic_logic import traffic_logic
from app.websocket import manager

router = APIRouter()


@router.post("/emergency", response_model=EmergencyResponse)
async def trigger_emergency(data: EmergencyRequest):
    """
    Trigger an emergency vehicle override for the given lane.
    Freezes normal cycle broadcasts for EMERGENCY_DURATION_S seconds.
    """
    cycle_raw = traffic_logic.calculate_emergency_cycle(data.lane)

    await manager.trigger_emergency(data.lane, cycle_raw)

    return {
        "message": f"Emergency override activated on {data.lane.upper()}.",
        "active_lane": data.lane,
    }


@router.post("/emergency/clear")
async def clear_emergency():
    """Cancel an active emergency override before its timer expires."""
    if not manager.emergency_active:
        return {"message": "No active emergency.", "cleared": False}

    lane = manager.emergency_lane
    await manager.clear_emergency()

    return {
        "message": f"Emergency on {lane} cleared manually.",
        "cleared": True,
        "lane": lane,
    }


@router.get("/emergency/status")
async def emergency_status():
    """Return current emergency state — useful for dashboard polling."""
    return {
        "active": manager.emergency_active,
        "lane": manager.emergency_lane,
    }