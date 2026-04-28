"""
Traffic Logic — Phase 1 + Phase 2 + Phase 3 (Intelligence)
------------------------------------------------------------
Single source of truth. Lives at app/services/traffic_logic.py.

Phase 3 additions
-----------------
PhaseSequencer
  Four named phases replace the flat sorted list returned by
  calculate_adaptive_cycle / calculate_cycle:

    NS_straight   – North & South get green, pedestrian crossing EW is WALK
    EW_straight   – East & West get green, pedestrian crossing NS is WALK
    left_turns    – Lagging left-turn slots for all four directions (protected)
    pedestrian    – Full pedestrian phase, all vehicle signals red

  Each phase carries:
    phase_name    str
    active_lanes  list[str]       vehicle lanes that are green this phase
    ped_signals   dict[str,str]   direction → "WALK" | "STOP"
    green_time    int             seconds for the phase
    sequence_pos  int             0-based index in the ring

  PhaseSequencer.next_phase() advances the ring and returns a PhaseResult.
  PhaseSequencer.current() returns the current PhaseResult without advancing.
"""

from dataclasses import dataclass, field
from typing import Optional, List, Dict
import time


# ─────────────────────────────────────────────────────────────────────────────
# Existing helpers (unchanged)
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class SubLaneCounts:
    straight: int = -1
    left: int = -1
    right: int = -1

    def is_specified(self) -> bool:
        return self.straight >= 0 or self.left >= 0 or self.right >= 0

    def to_dict(self) -> dict:
        if not self.is_specified():
            return {}
        return {
            "straight": max(0, self.straight),
            "left":     max(0, self.left),
            "right":    max(0, self.right),
            "total":    max(0, self.straight) + max(0, self.left) + max(0, self.right),
        }


@dataclass
class LaneState:
    vehicle_count: int = 0
    queue_length: int = 0
    avg_wait_time: float = 0.0
    sub_lanes: SubLaneCounts = field(default_factory=SubLaneCounts)


# ─────────────────────────────────────────────────────────────────────────────
# Phase 3 — PhaseResult & PhaseSequencer
# ─────────────────────────────────────────────────────────────────────────────

# Canonical pedestrian directions: four crossings, one per road arm.
# Each crossing is named after the road it crosses (e.g. "NS" crosses the
# north-south road and is therefore WALK when EW traffic is moving).
PED_DIRECTIONS = ("NS", "EW", "NS_left", "EW_left")


@dataclass
class PhaseResult:
    """Everything a client needs to render one signal phase."""
    phase_name: str                    # e.g. "NS_straight"
    active_lanes: List[str]            # vehicle lanes with green light
    ped_signals: Dict[str, str]        # PED_DIRECTION → "WALK" | "STOP"
    green_time: int                    # seconds
    sequence_pos: int                  # 0-based ring index
    lane_data: List[dict]              # full per-lane dicts (same shape as before)
    timestamp: float = field(default_factory=time.time)

    def to_dict(self) -> dict:
        return {
            "type": "PHASE_UPDATE",
            "phase_name": self.phase_name,
            "active_lanes": self.active_lanes,
            "ped_signals": self.ped_signals,
            "green_time": self.green_time,
            "sequence_pos": self.sequence_pos,
            "lane_data": self.lane_data,
            "timestamp": self.timestamp,
        }


# Fixed phase definitions — order is the ring order.
# active_lanes: vehicle lanes that are GREEN.
# ped_signals: per-crossing WALK/STOP.
_PHASE_DEFINITIONS = [
    {
        "phase_name": "NS_straight",
        "active_lanes": ["north", "south"],
        "ped_signals": {
            "NS":      "STOP",   # vehicles going NS → pedestrians crossing NS must stop
            "EW":      "WALK",   # pedestrians crossing EW can go (no EW vehicles)
            "NW_left": "STOP",
            "EW_left": "STOP",
        },
    },
    {
        "phase_name": "EW_straight",
        "active_lanes": ["east", "west"],
        "ped_signals": {
            "NS":      "WALK",   # pedestrians crossing NS can go
            "EW":      "STOP",
            "NW_left": "STOP",
            "EW_left": "STOP",
        },
    },
    {
        "phase_name": "left_turns",
        # Protected left turns: all four directions get a brief left-turn arrow.
        # Pedestrians stop on all crossings during this phase.
        "active_lanes": ["north", "south", "east", "west"],
        "ped_signals": {
            "NS":      "STOP",
            "EW":      "STOP",
            "NW_left": "STOP",
            "EW_left": "STOP",
        },
    },
    {
        "phase_name": "pedestrian",
        # All vehicle signals red; all pedestrian crossings WALK (Barnes dance /
        # all-way pedestrian phase).
        "active_lanes": [],
        "ped_signals": {
            "NS":      "WALK",
            "EW":      "WALK",
            "NW_left": "WALK",
            "EW_left": "WALK",
        },
    },
]

# Default green-time budgets (seconds) per phase when no adaptive data supplied.
_DEFAULT_GREEN_TIMES = {
    "NS_straight": 30,
    "EW_straight": 30,
    "left_turns":  15,
    "pedestrian":  20,
}


class PhaseSequencer:
    """
    Manages a four-phase ring for one intersection.

    Usage (adaptive):
        sequencer = PhaseSequencer()
        phase = sequencer.next_phase(lane_states=my_lane_states)
        await manager.broadcast(phase.to_dict())

    Usage (manual / legacy):
        phase = sequencer.next_phase()   # uses default green times
    """

    def __init__(self):
        self._pos: int = -1                      # ring cursor; -1 = not started
        self._current: Optional[PhaseResult] = None
        self._logic = TrafficLogic()

    # ── Public API ─────────────────────────────────────────────────────────────

    @property
    def current(self) -> Optional[PhaseResult]:
        """Return the current PhaseResult without advancing the ring."""
        return self._current

    def next_phase(
        self,
        lane_states: Optional[dict] = None,
        queue_weight: Optional[float] = None,
        wait_weight: Optional[float] = None,
        emergency_lane: Optional[str] = None,
    ) -> PhaseResult:
        """
        Advance to the next phase and return a PhaseResult.

        Parameters
        ----------
        lane_states   : dict[str, LaneState] — optional adaptive data.
                        When supplied, green_time is derived from traffic density.
        queue_weight  : override TrafficLogic.QUEUE_WEIGHT for this call.
        wait_weight   : override TrafficLogic.WAIT_WEIGHT for this call.
        emergency_lane: if set, forces NS_straight or EW_straight so the
                        emergency lane gets priority and the sequencer doesn't
                        skip to left_turns / pedestrian.
        """
        # Emergency shortcut: jump straight to the phase that serves the lane.
        if emergency_lane:
            return self._emergency_phase(emergency_lane, lane_states)

        self._pos = (self._pos + 1) % len(_PHASE_DEFINITIONS)
        definition = _PHASE_DEFINITIONS[self._pos]

        green_time = self._compute_green_time(
            definition, lane_states, queue_weight, wait_weight
        )

        lane_data = self._build_lane_data(definition, lane_states, green_time)

        result = PhaseResult(
            phase_name=definition["phase_name"],
            active_lanes=list(definition["active_lanes"]),
            ped_signals=dict(definition["ped_signals"]),
            green_time=green_time,
            sequence_pos=self._pos,
            lane_data=lane_data,
        )
        self._current = result
        return result

    def reset(self) -> None:
        """Restart the ring from the beginning (e.g. after emergency clear)."""
        self._pos = -1
        self._current = None

    # ── Internal helpers ───────────────────────────────────────────────────────

    def _compute_green_time(
        self,
        definition: dict,
        lane_states: Optional[dict],
        queue_weight: Optional[float],
        wait_weight: Optional[float],
    ) -> int:
        phase_name = definition["phase_name"]

        if phase_name == "pedestrian":
            # Pedestrian phase is fixed; traffic density is irrelevant.
            return _DEFAULT_GREEN_TIMES["pedestrian"]

        if phase_name == "left_turns":
            return _DEFAULT_GREEN_TIMES["left_turns"]

        if lane_states is None:
            return _DEFAULT_GREEN_TIMES.get(phase_name, 30)

        # Adaptive: sum the two active lanes' scores, cap to [MIN, MAX].
        active = definition["active_lanes"]
        qw = queue_weight if queue_weight is not None else self._logic.QUEUE_WEIGHT
        ww = wait_weight  if wait_weight  is not None else self._logic.WAIT_WEIGHT

        scores = []
        for lane_name in active:
            state: LaneState = lane_states.get(lane_name, LaneState())
            ql = max(0, int(state.queue_length))
            wt = max(0.0, float(state.avg_wait_time))
            scores.append(self._logic.BASE_GREEN + (ql * qw) + (wt * ww))

        raw = max(scores) if scores else self._logic.BASE_GREEN
        return self._logic._clamp(raw)

    def _build_lane_data(
        self,
        definition: dict,
        lane_states: Optional[dict],
        green_time: int,
    ) -> list:
        active = set(definition["active_lanes"])
        rows = []
        for d in TrafficLogic.DIRECTIONS:
            is_active = d in active
            state: LaneState = (lane_states or {}).get(d, LaneState())
            vc = max(0, int(state.vehicle_count))
            ql = max(0, int(state.queue_length))
            wt = max(0.0, float(state.avg_wait_time))
            rows.append({
                "lane": d,
                "green_time": green_time if is_active else 0,
                "vehicle_count": vc,
                "queue_length": ql,
                "avg_wait_time": round(wt, 1),
                "sub_lanes": state.sub_lanes.to_dict(),
                "mode": "phase",
                "phase": definition["phase_name"],
                "is_active": is_active,
            })
        return rows

    def _emergency_phase(
        self, emergency_lane: str, lane_states: Optional[dict]
    ) -> PhaseResult:
        """Return a synthetic phase that maximises green for emergency_lane."""
        if emergency_lane in ("north", "south"):
            definition = _PHASE_DEFINITIONS[0]  # NS_straight
        else:
            definition = _PHASE_DEFINITIONS[1]  # EW_straight

        green_time = TrafficLogic.MAX_GREEN

        lane_data = []
        for d in TrafficLogic.DIRECTIONS:
            state: LaneState = (lane_states or {}).get(d, LaneState())
            lane_data.append({
                "lane": d,
                "green_time": green_time if d == emergency_lane else TrafficLogic.MIN_GREEN,
                "vehicle_count": max(0, int(state.vehicle_count)),
                "queue_length": max(0, int(state.queue_length)),
                "avg_wait_time": round(max(0.0, float(state.avg_wait_time)), 1),
                "sub_lanes": state.sub_lanes.to_dict(),
                "mode": "emergency",
                "phase": definition["phase_name"],
                "is_active": d == emergency_lane,
            })

        result = PhaseResult(
            phase_name=definition["phase_name"],
            active_lanes=[emergency_lane],
            ped_signals={k: "STOP" for k in definition["ped_signals"]},
            green_time=green_time,
            sequence_pos=self._pos,
            lane_data=lane_data,
        )
        self._current = result
        return result


# ─────────────────────────────────────────────────────────────────────────────
# Original TrafficLogic (unchanged except docstring update)
# ─────────────────────────────────────────────────────────────────────────────

class TrafficLogic:
    MIN_GREEN = 10
    MAX_GREEN = 60
    SEC_PER_VEHICLE = 3

    BASE_GREEN: float = 8.0
    QUEUE_WEIGHT: float = 2.5
    WAIT_WEIGHT: float = 0.4

    DIRECTIONS = ["north", "south", "east", "west"]

    @staticmethod
    def _extract_int(value) -> int:
        if isinstance(value, int):
            return value
        if isinstance(value, dict):
            return int(sum(value.values()))
        total = 0
        for attr in ("cars", "bikes", "trucks", "buses", "rickshaws"):
            total += int(getattr(value, attr, 0) or 0)
        return total

    def _clamp(self, t: float) -> int:
        return max(self.MIN_GREEN, min(self.MAX_GREEN, int(round(t))))

    def calculate_cycle(self, densities) -> list:
        if hasattr(densities, "__getitem__"):
            raw = {d: densities.get(d, 0) for d in self.DIRECTIONS}
        else:
            raw = {d: getattr(densities, d, 0) for d in self.DIRECTIONS}

        counts = {d: max(0, self._extract_int(raw[d])) for d in self.DIRECTIONS}
        total = sum(counts.values())

        results = []
        for d in self.DIRECTIONS:
            green_time = self.MIN_GREEN if total == 0 else self._clamp(
                counts[d] * self.SEC_PER_VEHICLE
            )
            results.append({
                "lane": d,
                "green_time": green_time,
                "vehicle_count": counts[d],
                "queue_length": counts[d],
                "avg_wait_time": 0.0,
                "sub_lanes": {},
                "mode": "legacy",
            })

        results.sort(key=lambda x: (x["vehicle_count"], x["green_time"]), reverse=True)
        return results

    def calculate_adaptive_cycle(
        self,
        lane_states: dict,
        queue_weight: Optional[float] = None,
        wait_weight: Optional[float] = None,
    ) -> list:
        qw = queue_weight if queue_weight is not None else self.QUEUE_WEIGHT
        ww = wait_weight  if wait_weight  is not None else self.WAIT_WEIGHT

        results = []
        for d in self.DIRECTIONS:
            state: LaneState = lane_states.get(d, LaneState())
            vc = max(0, int(state.vehicle_count))
            ql = max(0, int(state.queue_length))
            wt = max(0.0, float(state.avg_wait_time))

            raw_score  = self.BASE_GREEN + (ql * qw) + (wt * ww)
            green_time = self._clamp(raw_score)

            results.append({
                "lane": d,
                "green_time": green_time,
                "vehicle_count": vc,
                "queue_length": ql,
                "avg_wait_time": round(wt, 1),
                "raw_score": round(raw_score, 2),
                "sub_lanes": state.sub_lanes.to_dict(),
                "mode": "adaptive",
            })

        results.sort(key=lambda x: x["raw_score"], reverse=True)
        return results

    def calculate_emergency_cycle(self, priority_lane: str) -> list:
        if priority_lane not in self.DIRECTIONS:
            raise ValueError(
                f"Invalid lane '{priority_lane}'. Must be one of {self.DIRECTIONS}."
            )

        results = []
        for d in self.DIRECTIONS:
            results.append({
                "lane": d,
                "green_time": self.MAX_GREEN if d == priority_lane else self.MIN_GREEN,
                "vehicle_count": 0,
                "queue_length": 0,
                "avg_wait_time": 0.0,
                "raw_score": float(self.MAX_GREEN if d == priority_lane else self.MIN_GREEN),
                "sub_lanes": {},
                "mode": "emergency",
            })

        results.sort(key=lambda x: x["green_time"], reverse=True)
        return results


traffic_logic = TrafficLogic()
phase_sequencer = PhaseSequencer()   # singleton — import and reuse across routes