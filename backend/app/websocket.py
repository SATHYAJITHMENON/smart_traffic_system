"""
WebSocket Connection Manager — Phase 1 + Phase 3 (Intelligence)
---------------------------------------------------------------
Phase 3 additions
-----------------
current_phase state
  The manager now tracks the last PhaseResult dict alongside the last
  cycle dict.  When a new client connects it receives the current phase
  immediately (PHASE_UPDATE message) so it never renders in an unknown
  state.

update_phase(phase_result)
  Call this from simulate.py / wherever you advance the PhaseSequencer.
  Stores the result and optionally broadcasts it (calls broadcast_if_unlocked).

broadcast_phase_if_unlocked(phase_result)
  Convenience wrapper — serialises a PhaseResult and calls
  broadcast_if_unlocked so emergency lock is respected.

Phase 1 changes (unchanged)
----------------------------
  1. Emergency freeze flag — blocks normal cycle broadcasts.
  2. current_cycle state — late-connecting clients see the last cycle.
  3. broadcast_if_unlocked() — normal cycles respect the emergency lock.
  4. trigger_emergency() / clear_emergency() — owned here.
"""

import asyncio
import logging
from typing import List, Optional, TYPE_CHECKING
from fastapi import WebSocket

if TYPE_CHECKING:
    from app.services.traffic_logic import PhaseResult

logger = logging.getLogger(__name__)

EMERGENCY_DURATION_S = 30       # seconds the emergency override stays active


class ConnectionManager:

    def __init__(self):
        self.active_connections: List[WebSocket] = []
        self._emergency_active: bool = False
        self._emergency_lane: Optional[str] = None
        self._emergency_task: Optional[asyncio.Task] = None
        self._current_cycle: Optional[dict] = None    # last flat cycle for late joiners
        self._current_phase: Optional[dict] = None    # last PhaseResult dict (Phase 3)

    # ── Connection lifecycle ──────────────────────────────────────────────────

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info("WebSocket connected. Total: %d", len(self.active_connections))

        # Immediately hydrate the new client with current state.
        if self._emergency_active and self._emergency_lane:
            await self._send_one(websocket, {
                "type": "EMERGENCY_OVERRIDE",
                "lane": self._emergency_lane,
                "active": True,
                "message": f"Emergency active on {self._emergency_lane}.",
            })
        elif self._current_phase:
            # Phase 3 — send the richer phase payload first …
            await self._send_one(websocket, self._current_phase)
        elif self._current_cycle:
            # … fall back to flat cycle if no phase has run yet
            await self._send_one(websocket, self._current_cycle)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        logger.info("WebSocket disconnected. Total: %d", len(self.active_connections))

    # ── Broadcast helpers ─────────────────────────────────────────────────────

    async def broadcast(self, message: dict):
        """
        Always broadcasts — used for emergency messages and status events.

        Does NOT update _current_cycle / _current_phase.  Those pointers are
        only updated by broadcast_if_unlocked (normal cycles) and store_phase
        (PhaseResult objects).  Emergency and cleared payloads must NOT
        overwrite the last good cycle state, because a client that connects
        *after* the emergency clears would otherwise receive EMERGENCY_CLEARED
        as its initial hydration message instead of the last real cycle.
        """
        dead = []
        for ws in self.active_connections:
            ok = await self._send_one(ws, message)
            if not ok:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

    async def broadcast_if_unlocked(self, message: dict) -> bool:
        """
        Broadcasts a normal cycle update ONLY when no emergency is active.
        Returns True if broadcast happened, False if suppressed.

        This is the ONLY place that updates _current_cycle for flat-cycle
        messages (CYCLE_UPDATE).  broadcast() deliberately does not do this
        so that emergency / cleared payloads never corrupt the hydration state.
        """
        if self._emergency_active:
            logger.info(
                "Normal cycle broadcast suppressed — emergency active on %s",
                self._emergency_lane,
            )
            return False
        # Persist as the last good cycle so late-joining clients are hydrated.
        self._current_cycle = message
        await self.broadcast(message)
        return True

    # ── Phase 3 — phase helpers ───────────────────────────────────────────────

    def store_phase(self, phase_result: "PhaseResult") -> dict:
        """
        Serialise a PhaseResult and store it as the current phase.
        Also updates _current_cycle so both pointers stay in sync.
        Returns the serialised dict so callers can use it without re-serialising.

        This (together with broadcast_if_unlocked) are the ONLY two places
        that write _current_cycle, ensuring emergency / cleared payloads never
        corrupt the hydration state seen by late-joining clients.
        """
        payload = phase_result.to_dict()
        self._current_phase = payload
        self._current_cycle = payload   # keep flat-cycle pointer in sync
        return payload

    async def broadcast_phase_if_unlocked(self, phase_result: "PhaseResult") -> bool:
        """
        Serialise phase_result, store it, and broadcast it — unless an
        emergency is active.  Returns True if broadcast happened.
        """
        payload = self.store_phase(phase_result)
        return await self.broadcast_if_unlocked(payload)

    async def broadcast_phase(self, phase_result: "PhaseResult") -> None:
        """
        Unconditional phase broadcast (use for emergency phases).
        """
        payload = self.store_phase(phase_result)
        await self.broadcast(payload)

    @property
    def current_phase(self) -> Optional[dict]:
        """The last serialised PhaseResult dict, or None if no phase has run."""
        return self._current_phase

    # ── Emergency management ──────────────────────────────────────────────────

    @property
    def emergency_active(self) -> bool:
        return self._emergency_active

    @property
    def emergency_lane(self) -> Optional[str]:
        return self._emergency_lane

    async def trigger_emergency(self, lane: str, cycle_data: list):
        """
        Activate emergency override for `lane`.
        - Sets the freeze flag so normal cycles are blocked.
        - Broadcasts EMERGENCY_OVERRIDE to all clients.
        - Schedules auto-clear after EMERGENCY_DURATION_S seconds.
        """
        # Cancel any in-flight timer from a previous emergency.
        if self._emergency_task and not self._emergency_task.done():
            self._emergency_task.cancel()

        self._emergency_active = True
        self._emergency_lane = lane
        logger.warning("🚑 Emergency ACTIVATED on lane: %s", lane)

        payload: dict = {
            "type": "EMERGENCY_OVERRIDE",
            "lane": lane,
            "active": True,
            "duration": EMERGENCY_DURATION_S,
            "data": cycle_data,
            "message": f"Emergency vehicle detected! Green light forced on {lane.upper()}.",
            # Phase 3 fields so the frontend can render phase UI during emergencies.
            "phase_name": "NS_straight" if lane in ("north", "south") else "EW_straight",
            "active_lanes": [lane],
            "ped_signals": {
                "NS": "STOP", "EW": "STOP", "NS_left": "STOP", "EW_left": "STOP"
            },
            "green_time": 60,
            "sequence_pos": -1,   # sentinel: not in normal ring
        }
        # Store as current phase so late-joining clients see the emergency state,
        # but do NOT touch _current_cycle — that must stay as the last good cycle
        # so it is available immediately when the emergency clears.
        self._current_phase = payload

        await self.broadcast(payload)

        self._emergency_task = asyncio.create_task(
            self._auto_clear_emergency(EMERGENCY_DURATION_S)
        )

    async def clear_emergency(self):
        """Manually clear the emergency (e.g. from a frontend cancel button)."""
        await self._do_clear_emergency()

    async def _auto_clear_emergency(self, delay: float):
        await asyncio.sleep(delay)
        await self._do_clear_emergency()

    async def _do_clear_emergency(self):
        self._emergency_active = False
        lane = self._emergency_lane
        self._emergency_lane = None
        logger.info("Emergency CLEARED (was: %s). Normal cycle resuming.", lane)

        cleared_payload: dict = {
            "type": "EMERGENCY_CLEARED",
            "lane": lane,
            "message": "Emergency cleared. Normal signal cycle resuming.",
            # Send the last *good* cycle/phase so the frontend can restore state
            # immediately without waiting for the next simulation tick.
            # _current_cycle was never overwritten by the emergency payload, so
            # this is always the last real CYCLE_UPDATE or PHASE_UPDATE.
            "last_cycle": self._current_cycle,
        }
        # broadcast() does not touch _current_cycle, so hydration state is safe.
        await self.broadcast(cleared_payload)

    # ── Internal ──────────────────────────────────────────────────────────────

    async def _send_one(self, ws: WebSocket, message: dict) -> bool:
        try:
            await ws.send_json(message)
            return True
        except Exception as exc:
            logger.warning("Failed to send to client: %s", exc)
            return False


manager = ConnectionManager()