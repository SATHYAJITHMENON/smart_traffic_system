"""
predictor.py — Phase 4 Analytics Helper
----------------------------------------
Lives at app/services/predictor.py.

Watches a sliding window of per-lane vehicle-arrival counts and emits an
EARLY_EXTEND WebSocket message when the arrival rate crosses a configurable
threshold.  Designed to be called from simulate.py on every phase tick.

Usage
-----
    from app.services.predictor import ArrivalPredictor

    predictor = ArrivalPredictor()          # one per intersection / singleton

    # Inside your simulation tick:
    signal = predictor.record(
        lane="north",
        vehicle_count=12,
        timestamp=time.time(),              # optional; defaults to now
    )
    if signal:
        await manager.broadcast(signal)     # signal is a ready-to-send dict
"""

from __future__ import annotations

import time
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Deque, Dict, Optional

# ── Tunable defaults ────────────────────────────────────────────────────────

# How many seconds of history the window covers.
WINDOW_SECONDS: float = 60.0

# Minimum number of samples required before we trust the rate estimate.
MIN_SAMPLES: int = 3

# Arrival rate (vehicles / second) that triggers an EARLY_EXTEND signal.
# Default: more than 0.25 veh/s ≈ 15 veh/min per lane → extend green.
DEFAULT_THRESHOLD: float = 0.25

# Minimum gap (seconds) between successive EARLY_EXTEND signals for the same
# lane, so we don't spam the WebSocket during a sustained surge.
SIGNAL_COOLDOWN_S: float = 20.0


# ── Data structures ─────────────────────────────────────────────────────────

@dataclass
class _Sample:
    timestamp: float
    vehicle_count: int


@dataclass
class LaneStats:
    """Snapshot returned by ArrivalPredictor.stats() for one lane."""
    lane: str
    arrival_rate: float          # vehicles / second over the current window
    window_seconds: float        # actual span of samples in the window
    sample_count: int
    last_vehicle_count: int
    threshold: float
    surge_detected: bool


# ── Predictor ───────────────────────────────────────────────────────────────

class ArrivalPredictor:
    """
    Sliding-window arrival-rate monitor.

    Parameters
    ----------
    window_seconds  : Duration of the rolling window (default 60 s).
    threshold       : Arrival rate (veh/s) that triggers EARLY_EXTEND.
    min_samples     : Minimum samples needed before emitting a signal.
    cooldown        : Minimum seconds between successive signals per lane.
    """

    def __init__(
        self,
        window_seconds: float = WINDOW_SECONDS,
        threshold: float = DEFAULT_THRESHOLD,
        min_samples: int = MIN_SAMPLES,
        cooldown: float = SIGNAL_COOLDOWN_S,
    ) -> None:
        self._window_s = window_seconds
        self._threshold = threshold
        self._min_samples = min_samples
        self._cooldown = cooldown

        # lane → deque of _Sample (oldest first)
        self._buffers: Dict[str, Deque[_Sample]] = defaultdict(deque)
        # lane → timestamp of the last EARLY_EXTEND signal emitted
        self._last_signal: Dict[str, float] = {}

    # ── Public API ───────────────────────────────────────────────────────────

    def record(
        self,
        lane: str,
        vehicle_count: int,
        timestamp: Optional[float] = None,
    ) -> Optional[dict]:
        """
        Add a new observation for *lane* and check for a surge.

        Returns a ready-to-broadcast dict if an EARLY_EXTEND signal should be
        emitted, otherwise None.

        Parameters
        ----------
        lane          : Direction string — "north" | "south" | "east" | "west".
        vehicle_count : Number of vehicles observed in this sample.
        timestamp     : Unix timestamp of the observation (default: now).
        """
        ts = timestamp if timestamp is not None else time.time()
        buf = self._buffers[lane]

        # Append new sample.
        buf.append(_Sample(timestamp=ts, vehicle_count=vehicle_count))

        # Evict samples older than the window.
        cutoff = ts - self._window_s
        while buf and buf[0].timestamp < cutoff:
            buf.popleft()

        # Not enough data yet.
        if len(buf) < self._min_samples:
            return None

        rate = self._compute_rate(buf)

        # Below threshold → no signal.
        if rate < self._threshold:
            return None

        # Respect cooldown.
        last = self._last_signal.get(lane, 0.0)
        if ts - last < self._cooldown:
            return None

        # Emit signal.
        self._last_signal[lane] = ts
        return self._build_signal(lane, rate, buf, ts)

    def stats(self, lane: str) -> LaneStats:
        """Return a diagnostic snapshot for *lane* (useful for the analytics panel)."""
        buf = self._buffers[lane]
        now = time.time()
        cutoff = now - self._window_s
        # Evict stale samples before computing.
        while buf and buf[0].timestamp < cutoff:
            buf.popleft()

        rate = self._compute_rate(buf) if len(buf) >= 2 else 0.0
        span = (buf[-1].timestamp - buf[0].timestamp) if len(buf) >= 2 else 0.0

        return LaneStats(
            lane=lane,
            arrival_rate=round(rate, 4),
            window_seconds=round(span, 1),
            sample_count=len(buf),
            last_vehicle_count=buf[-1].vehicle_count if buf else 0,
            threshold=self._threshold,
            surge_detected=rate >= self._threshold,
        )

    def all_stats(self) -> Dict[str, LaneStats]:
        """Return LaneStats for every lane that has at least one sample."""
        return {lane: self.stats(lane) for lane in list(self._buffers)}

    def reset(self, lane: Optional[str] = None) -> None:
        """Clear history.  If *lane* is None, resets all lanes."""
        if lane is None:
            self._buffers.clear()
            self._last_signal.clear()
        else:
            self._buffers[lane].clear()
            self._last_signal.pop(lane, None)

    # ── Internal helpers ─────────────────────────────────────────────────────

    @staticmethod
    def _compute_rate(buf: Deque[_Sample]) -> float:
        """
        Estimate vehicles-per-second over the buffer span.

        Strategy: divide the total vehicle count across the buffer by the time
        span (oldest → newest sample).  Falls back to zero if span is too
        short to be meaningful.
        """
        if len(buf) < 2:
            return 0.0
        span = buf[-1].timestamp - buf[0].timestamp
        if span < 1e-3:
            return 0.0
        total_vehicles = sum(s.vehicle_count for s in buf)
        return total_vehicles / span

    def _build_signal(
        self,
        lane: str,
        rate: float,
        buf: Deque[_Sample],
        ts: float,
    ) -> dict:
        """Construct the EARLY_EXTEND WebSocket payload."""
        # Severity tier: mild / moderate / high
        ratio = rate / self._threshold
        if ratio < 1.5:
            severity = "mild"
        elif ratio < 2.5:
            severity = "moderate"
        else:
            severity = "high"

        return {
            "type": "EARLY_EXTEND",
            "lane": lane,
            "arrival_rate": round(rate, 3),        # veh/s
            "threshold": self._threshold,
            "ratio": round(ratio, 2),              # rate / threshold
            "severity": severity,
            "sample_count": len(buf),
            "window_seconds": round(buf[-1].timestamp - buf[0].timestamp, 1),
            "recommendation": (
                f"Extend green on {lane.upper()} — "
                f"arrival rate {rate:.2f} veh/s exceeds threshold "
                f"{self._threshold:.2f} veh/s (×{ratio:.1f})."
            ),
            "timestamp": ts,
        }


# Singleton — import and reuse across routes.
arrival_predictor = ArrivalPredictor()
