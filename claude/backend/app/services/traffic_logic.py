from dataclasses import dataclass, field
from typing import Optional

@dataclass
class SubLaneCounts:
    straight: int = -1
    left: int = -1
    right: int = -1
    def is_specified(self):
        return self.straight >= 0 or self.left >= 0 or self.right >= 0
    def to_dict(self):
        if not self.is_specified(): return {}
        return {'straight': max(0,self.straight), 'left': max(0,self.left), 'right': max(0,self.right), 'total': max(0,self.straight)+max(0,self.left)+max(0,self.right)}

@dataclass
class LaneState:
    vehicle_count: int = 0
    queue_length: int = 0
    avg_wait_time: float = 0.0
    sub_lanes: SubLaneCounts = field(default_factory=SubLaneCounts)

class TrafficLogic:
    MIN_GREEN = 10
    MAX_GREEN = 60
    SEC_PER_VEHICLE = 3
    BASE_GREEN = 8.0
    QUEUE_WEIGHT = 2.5
    WAIT_WEIGHT = 0.4
    DIRECTIONS = ['north', 'south', 'east', 'west']
    @staticmethod
    def _extract_int(value):
        if isinstance(value, int): return value
        if isinstance(value, dict): return int(sum(value.values()))
        total = 0
        for attr in ('cars','bikes','trucks','buses','rickshaws'): total += int(getattr(value,attr,0) or 0)
        return total
    def _clamp(self, t): return max(self.MIN_GREEN, min(self.MAX_GREEN, int(round(t))))
    def calculate_cycle(self, densities):
        raw = {d: densities.get(d,0) for d in self.DIRECTIONS} if hasattr(densities,'__getitem__') else {d: getattr(densities,d,0) for d in self.DIRECTIONS}
        counts = {d: max(0,self._extract_int(raw[d])) for d in self.DIRECTIONS}
        total = sum(counts.values())
        results = []
        for d in self.DIRECTIONS:
            results.append({'lane':d,'green_time':self.MIN_GREEN if total==0 else self._clamp(counts[d]*self.SEC_PER_VEHICLE),'vehicle_count':counts[d],'queue_length':counts[d],'avg_wait_time':0.0,'sub_lanes':{},'mode':'legacy'})
        results.sort(key=lambda x:(x['vehicle_count'],x['green_time']),reverse=True)
        return results
    def calculate_adaptive_cycle(self, lane_states, queue_weight=None, wait_weight=None):
        qw = queue_weight if queue_weight is not None else self.QUEUE_WEIGHT
        ww = wait_weight if wait_weight is not None else self.WAIT_WEIGHT
        results = []
        for d in self.DIRECTIONS:
            state = lane_states.get(d, LaneState())
            vc,ql,wt = max(0,int(state.vehicle_count)),max(0,int(state.queue_length)),max(0.0,float(state.avg_wait_time))
            raw_score = self.BASE_GREEN+(ql*qw)+(wt*ww)
            results.append({'lane':d,'green_time':self._clamp(raw_score),'vehicle_count':vc,'queue_length':ql,'avg_wait_time':round(wt,1),'raw_score':round(raw_score,2),'sub_lanes':state.sub_lanes.to_dict(),'mode':'adaptive'})
        results.sort(key=lambda x:x['raw_score'],reverse=True)
        return results
    def calculate_emergency_cycle(self, priority_lane):
        if priority_lane not in self.DIRECTIONS: raise ValueError('Invalid lane')
        results = [{'lane':d,'green_time':self.MAX_GREEN if d==priority_lane else self.MIN_GREEN,'vehicle_count':0,'queue_length':0,'avg_wait_time':0.0,'raw_score':float(self.MAX_GREEN if d==priority_lane else self.MIN_GREEN),'sub_lanes':{},'mode':'emergency'} for d in self.DIRECTIONS]
        results.sort(key=lambda x:x['green_time'],reverse=True)
        return results

traffic_logic = TrafficLogic()
