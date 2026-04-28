"""
YOLO class → VehicleCounts field mapping
-----------------------------------------
YOLOv8n is trained on COCO which contains these vehicle classes:
    "car"        → cars
    "motorcycle" → bikes
    "bicycle"    → bikes   (was missing — silently dropped before)
    "bus"        → buses
    "truck"      → trucks

"rickshaw" / "auto rickshaw" is NOT a COCO class — it requires a
custom-trained model.  The "rickshaws" key is still present in every
lane dict so the VehicleCounts schema is always fully populated and
TrafficLogic._extract_int() never gets a KeyError.  When a custom model
that emits a "rickshaw" class name is dropped in, the mapping below
will pick it up with zero code changes elsewhere.
"""

# Maps every YOLO class name we recognise to its VehicleCounts field.
# Extend this dict when using a custom model with additional classes.
_YOLO_CLASS_MAP: dict[str, str] = {
    "car":        "cars",
    "motorcycle": "bikes",
    "bicycle":    "bikes",    # COCO class; counts toward bikes
    "bus":        "buses",
    "truck":      "trucks",
    "rickshaw":       "rickshaws",   # custom-model class (not in COCO)
    "auto rickshaw":  "rickshaws",   # alternate custom-model label
}

_EMPTY_LANE: dict[str, int] = {
    "cars": 0, "bikes": 0, "buses": 0, "trucks": 0, "rickshaws": 0
}


def map_to_lanes(boxes, image_width, image_height):
    """
    Map detected vehicles to lanes using region splitting (quadrants).

    Parameters
    ----------
    boxes        : list of (cx, cy, w, h, cls_name) tuples from ai_detector.
    image_width  : pixel width of the source frame.
    image_height : pixel height of the source frame.

    Returns
    -------
    dict with keys north/south/east/west, each a dict with keys
    cars/bikes/buses/trucks/rickshaws — matching VehicleCounts in schemas.py.
    """
    lane_counts: dict[str, dict[str, int]] = {
        "north": dict(_EMPTY_LANE),
        "south": dict(_EMPTY_LANE),
        "east":  dict(_EMPTY_LANE),
        "west":  dict(_EMPTY_LANE),
    }

    center_x = image_width  / 2.0
    center_y = image_height / 2.0

    for box in boxes:
        x, y, w, h, cls = box

        cls_key = _YOLO_CLASS_MAP.get(cls)
        if cls_key is None:
            continue   # unknown class — skip silently

        dx = x - center_x
        dy = y - center_y

        if abs(dy) > abs(dx):
            lane = "north" if dy < 0 else "south"
        else:
            lane = "east"  if dx > 0 else "west"

        lane_counts[lane][cls_key] += 1

    return lane_counts