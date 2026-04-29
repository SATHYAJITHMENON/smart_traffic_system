"""
finetune_visdrone.py
────────────────────
Fine-tunes YOLOv8l on the VisDrone dataset you extracted from Kaggle.

Expected folder structure in your project root:
    your_project/
    ├── app/
    ├── VisDrone/
    │   ├── VisDrone2019-DET-train/
    │   │   ├── images/
    │   │   └── annotations/
    │   ├── VisDrone2019-DET-val/
    │   │   ├── images/
    │   │   └── annotations/
    │   └── VisDrone2019-DET-test-dev/
    │       ├── images/
    │       └── annotations/
    └── finetune_visdrone.py   ← run this from project root

Steps this script does:
    1. Verifies your folder structure is correct
    2. Converts VisDrone annotations → YOLO format
    3. Writes dataset.yaml
    4. Fine-tunes yolov8l.pt
    5. Prints where best.pt is saved

Install dependencies first:
    pip install ultralytics pillow tqdm pyyaml

Run:
    python finetune_visdrone.py
"""

import os
import yaml
import multiprocessing
from pathlib import Path
from PIL import Image
from tqdm import tqdm
from ultralytics import YOLO


# ── Paths ─────────────────────────────────────────────────────────────────────
# Assumes you run this script from your project root
PROJECT_ROOT = Path(__file__).resolve().parent
VISDRONE_DIR = PROJECT_ROOT / "VisDrone"
YAML_PATH    = PROJECT_ROOT / "VisDrone.yaml"

SPLITS = {
    "train": "VisDrone2019-DET-train",
    "val":   "VisDrone2019-DET-val",
    # test-dev has no annotations so we skip it for training
}

# ── Training config ───────────────────────────────────────────────────────────
BASE_MODEL  = "yolov8m.pt"
EPOCHS      = 25
IMG_SIZE    = 416
BATCH_SIZE  = 8    # reduce to 8 if you get CUDA out of memory
DEVICE      = 0     # GPU 0. Change to "cpu" if no GPU

# ── VisDrone → your 5 classes ─────────────────────────────────────────────────
# VisDrone classes (1-indexed in the annotation file):
#   1: pedestrian  2: people      3: bicycle   4: car
#   5: van         6: truck       7: tricycle  8: awning-tricycle
#   9: bus         10: motor      0: ignored region (skip)
#
# We map to:
#   0: car       1: bike      2: bus      3: truck      4: rickshaw

VISDRONE_TO_YOLO = {
    0:  None,   # ignored region → skip
    1:  None,   # pedestrian     → skip
    2:  None,   # people         → skip
    3:  1,      # bicycle        → bike
    4:  0,      # car            → car
    5:  0,      # van            → car
    6:  3,      # truck          → truck
    7:  4,      # tricycle       → rickshaw
    8:  4,      # awning-tricycle→ rickshaw
    9:  2,      # bus            → bus
    10: 1,      # motor          → bike
}

CLASS_NAMES = ["car", "bike", "bus", "truck", "rickshaw"]


# ── Step 1: Verify structure ──────────────────────────────────────────────────

def verify_structure():
    print("\n[verify] Checking VisDrone folder structure...")
    ok = True
    for split_key, split_name in SPLITS.items():
        split_dir = VISDRONE_DIR / split_name
        img_dir   = split_dir / "images"
        ann_dir   = split_dir / "annotations"

        for d in [split_dir, img_dir, ann_dir]:
            if not d.exists():
                print(f"  MISSING: {d}")
                ok = False
            else:
                count = len(list(d.iterdir()))
                print(f"  OK ({count} files): {d.relative_to(PROJECT_ROOT)}")

    if not ok:
        print("\n  Fix the missing folders above then re-run.")
        print("  Make sure you extracted the Kaggle zip into your project root")
        print("  so that the VisDrone/ folder sits next to finetune_visdrone.py")
        raise SystemExit(1)

    print("[verify] Structure OK.\n")


# ── Step 2: Convert annotations → YOLO format ────────────────────────────────

def convert_split(split_key: str, split_name: str):
    split_dir  = VISDRONE_DIR / split_name
    ann_dir    = split_dir / "annotations"
    img_dir    = split_dir / "images"
    label_dir  = split_dir / "labels"
    label_dir.mkdir(exist_ok=True)

    ann_files  = sorted(ann_dir.glob("*.txt"))
    converted  = 0
    skipped    = 0

    for ann_file in tqdm(ann_files, desc=f"  Converting {split_key}"):
        stem = ann_file.stem

        # Find matching image
        img_path = None
        for ext in [".jpg", ".jpeg", ".png"]:
            candidate = img_dir / f"{stem}{ext}"
            if candidate.exists():
                img_path = candidate
                break

        if img_path is None:
            skipped += 1
            continue

        try:
            img_w, img_h = Image.open(img_path).size
        except Exception:
            skipped += 1
            continue

        yolo_lines = []

        for row in ann_file.read_text().strip().splitlines():
            parts = row.strip().split(",")
            if len(parts) < 6:
                continue

            x1   = int(parts[0])
            y1   = int(parts[1])
            bw   = int(parts[2])
            bh   = int(parts[3])
            score = int(parts[4])   # 0 = ignored region
            vis_cls = int(parts[5]) # 1-indexed VisDrone class

            # Skip ignored regions
            if score == 0:
                continue

            # Skip degenerate boxes
            if bw <= 0 or bh <= 0:
                continue

            yolo_cls = VISDRONE_TO_YOLO.get(vis_cls)
            if yolo_cls is None:
                continue

            # Convert to YOLO normalized cx, cy, w, h
            cx = (x1 + bw / 2) / img_w
            cy = (y1 + bh / 2) / img_h
            nw = bw / img_w
            nh = bh / img_h

            # Clamp to valid range
            cx = max(0.0, min(1.0, cx))
            cy = max(0.0, min(1.0, cy))
            nw = max(0.0, min(1.0, nw))
            nh = max(0.0, min(1.0, nh))

            yolo_lines.append(
                f"{yolo_cls} {cx:.6f} {cy:.6f} {nw:.6f} {nh:.6f}"
            )

        (label_dir / f"{stem}.txt").write_text("\n".join(yolo_lines))
        converted += 1

    print(f"  {split_key}: {converted} converted, {skipped} skipped.")


def convert_all():
    print("[convert] Converting annotations to YOLO format...")
    for split_key, split_name in SPLITS.items():
        convert_split(split_key, split_name)
    print("[convert] Done.\n")


# ── Step 3: Write dataset.yaml ────────────────────────────────────────────────

def write_yaml():
    cfg = {
        "path":  str(VISDRONE_DIR.resolve()),
        "train": f"{SPLITS['train']}/images",
        "val":   f"{SPLITS['val']}/images",
        "nc":    len(CLASS_NAMES),
        "names": CLASS_NAMES,
    }
    YAML_PATH.write_text(yaml.dump(cfg, default_flow_style=False))
    print(f"[yaml] Written → {YAML_PATH.relative_to(PROJECT_ROOT)}\n")


# ── Step 4: Fine-tune ─────────────────────────────────────────────────────────

def finetune():
    model = YOLO(BASE_MODEL)
    print(f"[train] Fine-tuning {BASE_MODEL} for {EPOCHS} epochs...\n")

    model.train(
        data          = str(YAML_PATH),
        epochs        = EPOCHS,
        imgsz         = IMG_SIZE,
        batch         = BATCH_SIZE,
        device        = DEVICE,
        project       = str(PROJECT_ROOT / "runs"),
        name          = "visdrone_finetune",
        exist_ok      = True,

        # Lower LR because we are fine-tuning, not training cold
        lr0           = 0.001,
        lrf           = 0.01,
        warmup_epochs = 3,

        # Freeze backbone for first pass — only trains detection head
        # Remove or set freeze=0 if you have a lot of compute time
        freeze        = 10,

        # Augmentation — good for dense aerial scenes
        mosaic        = 0.5,
        scale         = 0.5,
        fliplr        = 0.5,
        degrees       = 0.0,
        hsv_h         = 0.015,
        hsv_s         = 0.7,
        hsv_v         = 0.4,

        # Windows fix — if you are on Windows set workers=0
        workers       = 0,

        # Save a checkpoint every 10 epochs so you don't lose progress
        save_period   = 10,
        plots         = True,
        verbose       = True,
    )

    best = PROJECT_ROOT / "runs" / "visdrone_finetune" / "weights" / "best.pt"
    print(f"\n[done] Training complete.")
    print(f"       Best weights → {best}")
    print(f"\n  Now update ai_detector.py:")
    print(f'       FINETUNED_WEIGHTS = "{best}"')
    print(f'       USING_FINETUNED   = True')


# ── Step 5: Validate ──────────────────────────────────────────────────────────

def validate():
    best = PROJECT_ROOT / "runs" / "visdrone_finetune" / "weights" / "best.pt"
    if not best.exists():
        print("[skip] No trained weights found. Run finetune() first.")
        return

    model   = YOLO(str(best))
    metrics = model.val(data=str(YAML_PATH), imgsz=IMG_SIZE, device=DEVICE)

    print("\n── Validation results ──────────────────")
    print(f"  mAP50      : {metrics.box.map50:.3f}")
    print(f"  mAP50-95   : {metrics.box.map:.3f}")
    print(f"  Precision  : {metrics.box.mp:.3f}")
    print(f"  Recall     : {metrics.box.mr:.3f}")
    print("\n  Per-class mAP50:")
    for i, name in enumerate(CLASS_NAMES):
        try:
            print(f"    {name:<12} {metrics.box.ap50[i]:.3f}")
        except IndexError:
            pass


# ── Main ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    # Windows multiprocessing fix
    multiprocessing.freeze_support()

    print("=" * 55)
    print("  TrafficAI — VisDrone Fine-tune Pipeline")
    print("=" * 55)

    verify_structure()   # crashes early with clear message if paths are wrong
    convert_all()        # VisDrone CSV → YOLO TXT labels
    write_yaml()         # dataset.yaml
    finetune()           # train
    validate()           # print mAP
