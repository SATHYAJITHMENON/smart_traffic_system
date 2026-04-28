import os
import shutil

SOURCE_DIR = os.getcwd()

# 🔥 Absolute path (guaranteed)
DEST_DIR = os.path.abspath(os.path.join(SOURCE_DIR, "claude"))

# 🔁 Clean destination
if os.path.exists(DEST_DIR):
    shutil.rmtree(DEST_DIR)
os.makedirs(DEST_DIR, exist_ok=True)

print(f"\n📁 Creating folder at:\n{DEST_DIR}\n")

IGNORE_DIRS = {
    "__pycache__",
    "venv",
    "env",
    ".git",
    "node_modules",
    ".next",
    "dist",
    "build",
    "models"
}

ALLOWED_FILES = {
    "traffic_logic.py",
    "yolo_service.py",
    "main.py",
    "websocket.py",
    "config.py",
    "requirements.txt",
    "VehicleSimulation.tsx",
    "SignalCard.tsx",
    "ControlPanel.tsx",
    "TrafficChart.tsx",
    "page.tsx",
    "tailwind.config.js",
    "pygame_sim.py",
    "EmergencyToggle.tsx",
    "TrafficLights.tsx",
    "analyze.py",
    "simulate.py",
    "emergency.py",
    "ai_detector.py",
    "__init__.py"
}

total_copied = 0

def copy_file(src_file, root):
    global total_copied

    relative_path = os.path.relpath(root, SOURCE_DIR)
    dest_folder = os.path.join(DEST_DIR, relative_path)
    os.makedirs(dest_folder, exist_ok=True)

    filename = os.path.basename(src_file)
    dest_file = os.path.join(dest_folder, filename)

    shutil.copy2(src_file, dest_file)
    total_copied += 1

    print(f"✔ {filename}")

# ─────────────────────────────────────────────
# 🔁 WALK
# ─────────────────────────────────────────────

for root, dirs, files in os.walk(SOURCE_DIR):

    dirs[:] = [d for d in dirs if d not in IGNORE_DIRS]

    if DEST_DIR in root:
        continue

    for file in files:
        full_path = os.path.join(root, file)

        if file in ALLOWED_FILES:
            copy_file(full_path, root)

        elif "routes" in root:
            copy_file(full_path, root)

# ─────────────────────────────────────────────
# 📊 FINAL OUTPUT
# ─────────────────────────────────────────────

print("\n📊 SUMMARY")
print(f"Total files copied: {total_copied}")

print(f"\n📁 Claude folder location:\n👉 {DEST_DIR}\n")

# 🔥 Open folder automatically (Windows / Mac)
try:
    if os.name == 'nt':
        os.startfile(DEST_DIR)
    else:
        os.system(f'open "{DEST_DIR}"')
except:
    pass

print("🚀 Done!")