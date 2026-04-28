"""
pygame_sim.py  –  WebSocket-connected Pygame intersection simulation
---------------------------------------------------------------------
Upgraded to match Smart-Traffic-Management vehicle types fully:
  - Added 'rickshaw' to vehicleTypes and spawn weights
  - Rickshaw timing (2.25 s) handled by backend traffic_logic.py
  - Staggered spawner supports all 5 vehicle classes

NEW FEATURES (v2)
─────────────────
  1. Vehicle density heatmap overlay       [toggle: H]
       Semi-transparent coloured bands over each approach lane that
       shift green → amber → red as the waiting vehicle count rises.
       Thresholds: 0-4 = green, 5-9 = amber, 10+ = red.

  2. Manual vehicle spawner                [keyboard shortcuts]
       R              → 1 random vehicle on a random lane
       1 / 2 / 3 / 4  → spawn on north / south / east / west
       SHIFT + 1-4    → force a heavy vehicle (bus or truck)

  3. Live stats dashboard                  [toggle: D]
       Semi-transparent HUD panel (top-left) showing:
         • elapsed simulation time
         • vehicles crossed per lane
         • current green-time allocation per lane
         • spawn-queue depth
         • live FPS

  4. Pause / resume                        [toggle: SPACE]
       Freezes vehicle movement and signal countdown.
       WS messages are still received and queued while paused.
       A centred "PAUSED" banner is shown on screen.

Run from traffic-ai/ root so relative image paths resolve:
    python pygame_sim.py
"""

import random
import math
import time
import threading
import pygame
import sys
import websocket
import json

# ── Signal timing defaults ─────────────────────────────────────────────────────
defaultRed     = 150
defaultYellow  = 5
defaultGreen   = 20
defaultMinimum = 10
defaultMaximum = 60

signals      = []
noOfSignals  = 4
simTime      = 300
timeElapsed  = 0

currentGreen  = 0
nextGreen     = (currentGreen + 1) % noOfSignals
currentYellow = 0

noOfLanes     = 2
detectionTime = 5

# ── Vehicle physics speeds (pixels/frame) ──────────────────────────────────────
speeds = {
    'car':      2.25,
    'bus':      1.8,
    'truck':    1.8,
    'rickshaw': 2.0,
    'bike':     2.5,
}

vehicleTypes         = {0: 'car', 1: 'bus', 2: 'truck', 3: 'rickshaw', 4: 'bike'}
directionNumbers     = {0: 'right', 1: 'down', 2: 'left', 3: 'up'}
directionStringToInt = {'east': 0, 'south': 1, 'west': 2, 'north': 3}

SPAWN_WEIGHTS = [0.45, 0.10, 0.10, 0.15, 0.20]   # car, bus, truck, rickshaw, bike
HEAVY_TYPES   = ['bus', 'truck']

# ── Intersection geometry ──────────────────────────────────────────────────────
x = {'right': [0, 0, 0],          'down': [755, 727, 697],
     'left':  [1400, 1400, 1400],  'up':   [602, 627, 657]}
y = {'right': [348, 370, 398],    'down': [0, 0, 0],
     'left':  [498, 466, 436],    'up':   [800, 800, 800]}

vehicles = {
    'right': {0: [], 1: [], 2: [], 'crossed': 0},
    'down':  {0: [], 1: [], 2: [], 'crossed': 0},
    'left':  {0: [], 1: [], 2: [], 'crossed': 0},
    'up':    {0: [], 1: [], 2: [], 'crossed': 0},
}

signalCoods       = [(530, 230), (810, 230), (810, 570), (530, 570)]
signalTimerCoods  = [(530, 210), (810, 210), (810, 550), (530, 550)]
vehicleCountCoods = [(480, 210), (880, 210), (880, 550), (480, 550)]
vehicleCountTexts = ["0", "0", "0", "0"]

stopLines   = {'right': 590, 'down': 330, 'left': 800, 'up': 535}
defaultStop = {'right': 580, 'down': 320, 'left': 810, 'up': 545}
stops       = {'right': [580, 580, 580], 'down': [320, 320, 320],
               'left':  [810, 810, 810], 'up':   [545, 545, 545]}

mid = {
    'right': {'x': 705, 'y': 445}, 'down': {'x': 695, 'y': 450},
    'left':  {'x': 695, 'y': 425}, 'up':   {'x': 695, 'y': 400},
}
rotationAngle = 3
gap  = 15
gap2 = 15

# ── Heatmap zones: (x, y, w, h) per approach direction ────────────────────────
HEATMAP_ZONES = {
    'right': (0,   335, 590, 80),
    'down':  (685,   0,  80, 330),
    'left':  (800, 425, 600, 80),
    'up':    (585, 535,  80, 265),
}
# (max_count_inclusive, RGBA_colour)
HEATMAP_LEVELS = [
    (4,   (0,   220,  60, 60)),
    (9,   (255, 180,   0, 80)),
    (999, (220,  30,  30, 100)),
]

pygame.init()
simulation   = pygame.sprite.Group()
simStartTime = time.time()

vehiclesToSpawn = []
spawn_lock      = threading.Lock()

# ── UI state (mutable via event loop) ─────────────────────────────────────────
ui = {
    'paused':         False,
    'show_heatmap':   False,
    'show_dashboard': False,
}


# ── Classes ────────────────────────────────────────────────────────────────────

class TrafficSignal:
    def __init__(self, red, yellow, green, minimum, maximum):
        self.red            = red
        self.yellow         = yellow
        self.green          = green
        self.minimum        = minimum
        self.maximum        = maximum
        self.signalText     = "30"
        self.totalGreenTime = 0
        self.vehicles       = {v: 0 for v in vehicleTypes.values()}


class Vehicle(pygame.sprite.Sprite):
    def __init__(self, lane, vehicleClass, direction_number, direction, will_turn):
        pygame.sprite.Sprite.__init__(self)
        self.lane             = lane
        self.vehicleClass     = vehicleClass
        self.speed            = speeds[vehicleClass]
        self.direction_number = direction_number
        self.direction        = direction
        self.x                = x[direction][lane]
        self.y                = y[direction][lane]
        self.crossed          = 0
        self.willTurn         = will_turn
        self.turned           = 0
        self.rotateAngle      = 0

        signals[direction_number].vehicles[vehicleClass] += 1
        vehicles[direction][lane].append(self)
        self.index = len(vehicles[direction][lane]) - 1

        self.startLag = random.uniform(0.5, 1.5)
        self.lagTimer = 0

        path = f"images/{direction}/{vehicleClass}.png"
        try:
            self.originalImage = pygame.image.load(path)
        except FileNotFoundError:
            w, h = (30, 15) if direction in ('right', 'left') else (15, 30)
            colour_map = {
                'car':      (0,   120, 255),
                'bus':      (255, 165,   0),
                'truck':    (180,   0,   0),
                'rickshaw': (0,   200, 100),
                'bike':     (200, 200,   0),
            }
            surf = pygame.Surface((w, h))
            surf.fill(colour_map.get(vehicleClass, (200, 200, 200)))
            self.originalImage = surf

        self.currentImage = self.originalImage.copy()

        if direction == 'right':
            if len(vehicles[direction][lane]) > 1 and vehicles[direction][lane][self.index - 1].crossed == 0:
                self.stop = stops[direction][lane] - self.currentImage.get_rect().width - gap
            else:
                self.stop = defaultStop[direction]
            temp = self.currentImage.get_rect().width + gap
            x[direction][lane] -= temp
            stops[direction][lane] -= temp

        elif direction == 'left':
            if len(vehicles[direction][lane]) > 1 and vehicles[direction][lane][self.index - 1].crossed == 0:
                self.stop = stops[direction][lane] + self.currentImage.get_rect().width + gap
            else:
                self.stop = defaultStop[direction]
            temp = self.currentImage.get_rect().width + gap
            x[direction][lane] += temp
            stops[direction][lane] += temp

        elif direction == 'down':
            if len(vehicles[direction][lane]) > 1 and vehicles[direction][lane][self.index - 1].crossed == 0:
                self.stop = stops[direction][lane] - self.currentImage.get_rect().height - gap
            else:
                self.stop = defaultStop[direction]
            temp = self.currentImage.get_rect().height + gap
            y[direction][lane] -= temp
            stops[direction][lane] -= temp

        elif direction == 'up':
            if len(vehicles[direction][lane]) > 1 and vehicles[direction][lane][self.index - 1].crossed == 0:
                self.stop = stops[direction][lane] + self.currentImage.get_rect().height + gap
            else:
                self.stop = defaultStop[direction]
            temp = self.currentImage.get_rect().height + gap
            y[direction][lane] += temp
            stops[direction][lane] += temp

        simulation.add(self)

    def processLag(self):
        if currentGreen == self.direction_number and currentYellow == 0:
            if self.lagTimer < self.startLag:
                self.lagTimer += 0.05
                return True
        return False

    def move(self):
        if self.crossed == 0 and self.processLag():
            return

        tm = 2.0
        ty = 1.8
        if self.vehicleClass in ('bus', 'truck'):
            tm, ty = 1.6, 1.4

        d     = self.direction
        img_w = self.currentImage.get_rect().width
        img_h = self.currentImage.get_rect().height

        if d == 'right':
            if self.crossed == 0 and self.x + img_w > stopLines[d]:
                self.crossed = 1
                vehicles[d]['crossed'] += 1
                signals[self.direction_number].vehicles[self.vehicleClass] -= 1
            if self.willTurn == 1:
                if self.crossed == 0 or self.x + img_w < mid[d]['x']:
                    if (self.x + img_w <= self.stop or (currentGreen == 0 and currentYellow == 0) or self.crossed == 1) and \
                       (self.index == 0 or self.x + img_w < (vehicles[d][self.lane][self.index - 1].x - gap2) or vehicles[d][self.lane][self.index - 1].turned == 1):
                        self.x += self.speed
                else:
                    if self.turned == 0:
                        self.rotateAngle += rotationAngle
                        self.currentImage = pygame.transform.rotate(self.originalImage, -self.rotateAngle)
                        self.x += tm; self.y += ty
                        if self.rotateAngle >= 90:
                            self.turned = 1
                    else:
                        if self.index == 0 or self.y + img_h < (vehicles[d][self.lane][self.index - 1].y - gap2) or self.x + img_w < (vehicles[d][self.lane][self.index - 1].x - gap2):
                            self.y += self.speed
            else:
                if (self.x + img_w <= self.stop or self.crossed == 1 or (currentGreen == 0 and currentYellow == 0)) and \
                   (self.index == 0 or self.x + img_w < (vehicles[d][self.lane][self.index - 1].x - gap2) or vehicles[d][self.lane][self.index - 1].turned == 1):
                    self.x += self.speed

        elif d == 'down':
            if self.crossed == 0 and self.y + img_h > stopLines[d]:
                self.crossed = 1
                vehicles[d]['crossed'] += 1
                signals[self.direction_number].vehicles[self.vehicleClass] -= 1
            if self.willTurn == 1:
                if self.crossed == 0 or self.y + img_h < mid[d]['y']:
                    if (self.y + img_h <= self.stop or (currentGreen == 1 and currentYellow == 0) or self.crossed == 1) and \
                       (self.index == 0 or self.y + img_h < (vehicles[d][self.lane][self.index - 1].y - gap2) or vehicles[d][self.lane][self.index - 1].turned == 1):
                        self.y += self.speed
                else:
                    if self.turned == 0:
                        self.rotateAngle += rotationAngle
                        self.currentImage = pygame.transform.rotate(self.originalImage, -self.rotateAngle)
                        self.x -= (ty + 0.5); self.y += tm
                        if self.rotateAngle >= 90:
                            self.turned = 1
                    else:
                        if self.index == 0 or self.x > (vehicles[d][self.lane][self.index - 1].x + vehicles[d][self.lane][self.index - 1].currentImage.get_rect().width + gap2) or self.y < (vehicles[d][self.lane][self.index - 1].y - gap2):
                            self.x -= self.speed
            else:
                if (self.y + img_h <= self.stop or self.crossed == 1 or (currentGreen == 1 and currentYellow == 0)) and \
                   (self.index == 0 or self.y + img_h < (vehicles[d][self.lane][self.index - 1].y - gap2) or vehicles[d][self.lane][self.index - 1].turned == 1):
                    self.y += self.speed

        elif d == 'left':
            if self.crossed == 0 and self.x < stopLines[d]:
                self.crossed = 1
                vehicles[d]['crossed'] += 1
                signals[self.direction_number].vehicles[self.vehicleClass] -= 1
            if self.willTurn == 1:
                if self.crossed == 0 or self.x > mid[d]['x']:
                    if (self.x >= self.stop or (currentGreen == 2 and currentYellow == 0) or self.crossed == 1) and \
                       (self.index == 0 or self.x > (vehicles[d][self.lane][self.index - 1].x + vehicles[d][self.lane][self.index - 1].currentImage.get_rect().width + gap2) or vehicles[d][self.lane][self.index - 1].turned == 1):
                        self.x -= self.speed
                else:
                    if self.turned == 0:
                        self.rotateAngle += rotationAngle
                        self.currentImage = pygame.transform.rotate(self.originalImage, -self.rotateAngle)
                        self.x -= tm; self.y -= (ty + 0.5)
                        if self.rotateAngle >= 90:
                            self.turned = 1
                    else:
                        if self.index == 0 or self.y > (vehicles[d][self.lane][self.index - 1].y + vehicles[d][self.lane][self.index - 1].currentImage.get_rect().height + gap2) or self.x > (vehicles[d][self.lane][self.index - 1].x + gap2):
                            self.y -= self.speed
            else:
                if (self.x >= self.stop or self.crossed == 1 or (currentGreen == 2 and currentYellow == 0)) and \
                   (self.index == 0 or self.x > (vehicles[d][self.lane][self.index - 1].x + vehicles[d][self.lane][self.index - 1].currentImage.get_rect().width + gap2) or vehicles[d][self.lane][self.index - 1].turned == 1):
                    self.x -= self.speed

        elif d == 'up':
            if self.crossed == 0 and self.y < stopLines[d]:
                self.crossed = 1
                vehicles[d]['crossed'] += 1
                signals[self.direction_number].vehicles[self.vehicleClass] -= 1
            if self.willTurn == 1:
                if self.crossed == 0 or self.y > mid[d]['y']:
                    if (self.y >= self.stop or (currentGreen == 3 and currentYellow == 0) or self.crossed == 1) and \
                       (self.index == 0 or self.y > (vehicles[d][self.lane][self.index - 1].y + vehicles[d][self.lane][self.index - 1].currentImage.get_rect().height + gap2) or vehicles[d][self.lane][self.index - 1].turned == 1):
                        self.y -= self.speed
                else:
                    if self.turned == 0:
                        self.rotateAngle += rotationAngle
                        self.currentImage = pygame.transform.rotate(self.originalImage, -self.rotateAngle)
                        self.x += tm; self.y -= ty
                        if self.rotateAngle >= 90:
                            self.turned = 1
                    else:
                        if self.index == 0 or self.x < (vehicles[d][self.lane][self.index - 1].x - vehicles[d][self.lane][self.index - 1].currentImage.get_rect().width - gap2) or self.y > (vehicles[d][self.lane][self.index - 1].y + gap2):
                            self.x += self.speed
            else:
                if (self.y >= self.stop or self.crossed == 1 or (currentGreen == 3 and currentYellow == 0)) and \
                   (self.index == 0 or self.y > (vehicles[d][self.lane][self.index - 1].y + vehicles[d][self.lane][self.index - 1].currentImage.get_rect().height + gap2) or vehicles[d][self.lane][self.index - 1].turned == 1):
                    self.y -= self.speed


# ── Signal control ─────────────────────────────────────────────────────────────

def initialize():
    ts1 = TrafficSignal(0, defaultYellow, defaultGreen, defaultMinimum, defaultMaximum)
    signals.append(ts1)
    ts2 = TrafficSignal(ts1.red + ts1.yellow + ts1.green, defaultYellow, defaultGreen, defaultMinimum, defaultMaximum)
    signals.append(ts2)
    ts3 = TrafficSignal(defaultRed, defaultYellow, defaultGreen, defaultMinimum, defaultMaximum)
    signals.append(ts3)
    ts4 = TrafficSignal(defaultRed, defaultYellow, defaultGreen, defaultMinimum, defaultMaximum)
    signals.append(ts4)
    repeat()


def setTime():
    carTime = 2; bikeTime = 1; rickshawTime = 2.25; busTime = 2.5; truckTime = 2.5
    v = signals[nextGreen].vehicles
    green = math.ceil(
        (v['car'] * carTime + v['rickshaw'] * rickshawTime +
         v['bus'] * busTime + v['truck'] * truckTime + v['bike'] * bikeTime)
        / (noOfLanes + 1)
    )
    signals[nextGreen].green = max(defaultMinimum, min(defaultMaximum, green))


def repeat():
    global currentGreen, currentYellow, nextGreen
    while signals[currentGreen].green > 0:
        if not ui['paused']:                    # Feature 4 – freeze countdown
            updateValues()
            if signals[(currentGreen + 1) % noOfSignals].red == detectionTime:
                t = threading.Thread(name="detection", target=setTime)
                t.daemon = True
                t.start()
        time.sleep(1)

    currentYellow = 1
    vehicleCountTexts[currentGreen] = "0"

    for i in range(3):
        stops[directionNumbers[currentGreen]][i] = defaultStop[directionNumbers[currentGreen]]
        for v in vehicles[directionNumbers[currentGreen]][i]:
            v.stop = defaultStop[directionNumbers[currentGreen]]

    while signals[currentGreen].yellow > 0:
        if not ui['paused']:
            updateValues()
        time.sleep(1)

    currentYellow = 0
    signals[currentGreen].green  = defaultGreen
    signals[currentGreen].yellow = defaultYellow
    signals[currentGreen].red    = defaultRed

    currentGreen = nextGreen
    nextGreen    = (currentGreen + 1) % noOfSignals
    signals[nextGreen].red = signals[currentGreen].yellow + signals[currentGreen].green
    repeat()


def updateValues():
    for i in range(noOfSignals):
        if i == currentGreen:
            if currentYellow == 0:
                signals[i].green -= 1
                signals[i].totalGreenTime += 1
            else:
                signals[i].yellow -= 1
        else:
            signals[i].red -= 1


# ── Staggered spawner ──────────────────────────────────────────────────────────

def staggeredSpawner():
    while True:
        if not ui['paused']:                    # Feature 4 – pause spawner too
            with spawn_lock:
                if vehiclesToSpawn:
                    job = vehiclesToSpawn.pop(0)
                    lane_number = 0 if job['class'] == 'bike' else random.randint(1, 2)
                    will_turn   = 1 if lane_number == 2 and random.random() < 0.4 else 0
                    Vehicle(lane_number, job['class'], job['dir_num'],
                            directionNumbers[job['dir_num']], will_turn)
        time.sleep(random.uniform(0.3, 0.75))


# ── Feature 2 – manual spawn helper ───────────────────────────────────────────

def spawn_manual(dir_num, force_heavy=False):
    """Queue a single vehicle onto the given direction index."""
    vclass = random.choice(HEAVY_TYPES) if force_heavy else \
             random.choices(list(vehicleTypes.values()), weights=SPAWN_WEIGHTS)[0]
    with spawn_lock:
        vehiclesToSpawn.append({"dir_num": dir_num, "class": vclass})
    print(f"[MANUAL] Queued {vclass} → {directionNumbers[dir_num]}")


# ── WebSocket integration ──────────────────────────────────────────────────────

def on_message(ws_app, message):
    global currentGreen, nextGreen, currentYellow
    data = json.loads(message)

    if data.get("type") == "CYCLE_UPDATE":
        densities = data.get("densities", {})
        total = sum(densities.values())
        print(f"[WS] CYCLE_UPDATE: spawning {total} vehicles across {list(densities.keys())}")
        to_spawn = []
        for lane_str, count in densities.items():
            dir_num = directionStringToInt.get(lane_str)
            if dir_num is None:
                continue
            for _ in range(int(count)):
                vclass = random.choices(list(vehicleTypes.values()), weights=SPAWN_WEIGHTS)[0]
                to_spawn.append({"dir_num": dir_num, "class": vclass})
        random.shuffle(to_spawn)
        with spawn_lock:
            vehiclesToSpawn.extend(to_spawn)

    elif data.get("type") == "EMERGENCY_OVERRIDE":
        target  = data.get("lane")
        dir_num = directionStringToInt.get(target)
        print(f"[WS] EMERGENCY OVERRIDE → {target} (dir {dir_num})")
        if dir_num is not None and currentGreen != dir_num:
            signals[currentGreen].green  = 0
            signals[currentGreen].yellow = 0
            nextGreen = dir_num


def on_error(ws_app, error): print(f"[WS ERROR] {error}")
def on_close(ws_app, *_):    print("[WS] Connection closed")
def on_open(ws_app):         print("[WS] Connected to TrafficAI backend")


def start_ws_client():
    websocket.enableTrace(False)
    ws_app = websocket.WebSocketApp(
        "ws://localhost:8000/ws",
        on_open=on_open, on_message=on_message,
        on_error=on_error, on_close=on_close,
    )
    ws_app.run_forever(reconnect=5)


# ── Feature render helpers ─────────────────────────────────────────────────────

def _lane_waiting_count(direction):
    """Count vehicles that have not yet crossed the stop line."""
    return sum(
        1 for lane_idx in range(3)
        for v in vehicles[direction][lane_idx]
        if v.crossed == 0
    )


def draw_heatmap(screen):
    """Feature 1 – coloured semi-transparent overlay per approach lane."""
    overlay = pygame.Surface((1400, 800), pygame.SRCALPHA)
    for dir_name, rect in HEATMAP_ZONES.items():
        count = _lane_waiting_count(dir_name)
        colour = HEATMAP_LEVELS[-1][1]
        for threshold, col in HEATMAP_LEVELS:
            if count <= threshold:
                colour = col
                break
        pygame.draw.rect(overlay, colour, rect)
    screen.blit(overlay, (0, 0))


def draw_dashboard(screen, font_small, clock):
    """Feature 3 – semi-transparent stats HUD."""
    elapsed     = int(time.time() - simStartTime)
    fps         = int(clock.get_fps())
    with spawn_lock:
        queue_depth = len(vehiclesToSpawn)

    dir_labels = ['E (right)', 'S (down )', 'W (left )', 'N (up   )']
    lines = [
        "TrafficAI  Stats",
        "─────────────────────",
        f"Elapsed : {elapsed}s",
        f"FPS     : {fps}",
        f"Queue   : {queue_depth} pending",
        "",
        "Lane        Crossed  Timer",
    ]
    for i, label in enumerate(dir_labels):
        d       = directionNumbers[i]
        crossed = vehicles[d]['crossed']
        if i == currentGreen:
            timer_str = f"G {signals[i].green}s"
        else:
            timer_str = f"R {signals[i].red}s"
        lines.append(f"{label}   {crossed:>4}    {timer_str}")

    pad = 10; lh = 20; w = 260
    h   = pad * 2 + lh * len(lines)
    panel = pygame.Surface((w, h), pygame.SRCALPHA)
    panel.fill((10, 10, 20, 185))
    screen.blit(panel, (8, 8))
    for idx, line in enumerate(lines):
        colour = (100, 220, 255) if idx == 0 else (200, 200, 200)
        surf   = font_small.render(line, True, colour)
        screen.blit(surf, (8 + pad, 8 + pad + idx * lh))


def draw_paused_banner(screen, font_big):
    """Feature 4 – centred PAUSED overlay."""
    banner = pygame.Surface((420, 60), pygame.SRCALPHA)
    banner.fill((0, 0, 0, 175))
    screen.blit(banner, (490, 370))
    txt = font_big.render("  PAUSED  –  SPACE to resume", True, (255, 220, 50))
    screen.blit(txt, (498, 383))


def draw_keybind_hint(screen, font_small):
    """Permanent one-line keybind reminder at the very bottom."""
    hint = "SPACE=pause  H=heatmap  D=stats  R=random spawn  1-4=spawn lane  SHIFT+1-4=heavy"
    surf    = font_small.render(hint, True, (170, 170, 170))
    backing = pygame.Surface((surf.get_width() + 20, surf.get_height() + 8), pygame.SRCALPHA)
    backing.fill((0, 0, 0, 140))
    screen.blit(backing, (10, 774))
    screen.blit(surf, (20, 778))


# ── Main loop ──────────────────────────────────────────────────────────────────

class Main:
    t_init    = threading.Thread(name="initialization",   target=initialize,       daemon=True)
    t_spawner = threading.Thread(name="staggeredSpawner", target=staggeredSpawner,  daemon=True)
    t_ws      = threading.Thread(name="wsClient",         target=start_ws_client,   daemon=True)
    t_init.start(); t_spawner.start(); t_ws.start()

    black = (0, 0, 0); white = (255, 255, 255)
    screenWidth = 1400; screenHeight = 800
    screen = pygame.display.set_mode((screenWidth, screenHeight))
    pygame.display.set_caption("TrafficAI  ·  Smart Intersection Simulation")

    try:    background = pygame.image.load('images/mod_int.png')
    except: background = pygame.Surface((screenWidth, screenHeight)); background.fill((40, 40, 40))

    try:    redSignal    = pygame.image.load('images/signals/red.png')
    except: s = pygame.Surface((30, 30)); s.fill((220, 0, 0));    redSignal    = s

    try:    yellowSignal = pygame.image.load('images/signals/yellow.png')
    except: s = pygame.Surface((30, 30)); s.fill((220, 180, 0)); yellowSignal = s

    try:    greenSignal  = pygame.image.load('images/signals/green.png')
    except: s = pygame.Surface((30, 30)); s.fill((0, 200, 0));   greenSignal  = s

    font       = pygame.font.Font(None, 30)
    font_big   = pygame.font.Font(None, 36)
    font_small = pygame.font.Font(None, 22)
    clock      = pygame.time.Clock()

    # Key → direction index mapping for manual spawner (1=north, 2=south, 3=east, 4=west)
    LANE_KEYS = {
        pygame.K_1: 3,   # north = up   = index 3
        pygame.K_2: 1,   # south = down = index 1
        pygame.K_3: 0,   # east  = right= index 0
        pygame.K_4: 2,   # west  = left = index 2
    }

    while True:
        # ── Events ───────────────────────────────────────────────────────────
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                sys.exit()

            if event.type == pygame.KEYDOWN:
                mods = pygame.key.get_mods()

                if event.key == pygame.K_SPACE:          # Feature 4
                    ui['paused'] = not ui['paused']
                    print(f"[UI] {'Paused' if ui['paused'] else 'Resumed'}")

                elif event.key == pygame.K_h:            # Feature 1
                    ui['show_heatmap'] = not ui['show_heatmap']
                    print(f"[UI] Heatmap {'ON' if ui['show_heatmap'] else 'OFF'}")

                elif event.key == pygame.K_d:            # Feature 3
                    ui['show_dashboard'] = not ui['show_dashboard']
                    print(f"[UI] Dashboard {'ON' if ui['show_dashboard'] else 'OFF'}")

                elif event.key == pygame.K_r:            # Feature 2 – random
                    spawn_manual(random.randint(0, 3))

                elif event.key in LANE_KEYS:             # Feature 2 – by lane
                    spawn_manual(LANE_KEYS[event.key],
                                 force_heavy=bool(mods & pygame.KMOD_SHIFT))

        # ── Draw ─────────────────────────────────────────────────────────────
        screen.blit(background, (0, 0))

        if ui['show_heatmap']:                           # Feature 1
            draw_heatmap(screen)

        # Signals
        for i in range(noOfSignals):
            if i == currentGreen:
                if currentYellow == 1:
                    signals[i].signalText = "STOP" if signals[i].yellow == 0 else signals[i].yellow
                    screen.blit(yellowSignal, signalCoods[i])
                else:
                    signals[i].signalText = "SLOW" if signals[i].green == 0 else signals[i].green
                    screen.blit(greenSignal, signalCoods[i])
            else:
                signals[i].signalText = "---" if signals[i].red > 10 else ("GO" if signals[i].red == 0 else signals[i].red)
                screen.blit(redSignal, signalCoods[i])

        for i in range(noOfSignals):
            t  = font.render(str(signals[i].signalText), True, white, black)
            screen.blit(t, signalTimerCoods[i])
            ct = font.render(str(vehicles[directionNumbers[i]]['crossed']), True, black, white)
            screen.blit(ct, vehicleCountCoods[i])

        # Vehicles
        for vehicle in simulation:
            screen.blit(vehicle.currentImage, [vehicle.x, vehicle.y])
            if not ui['paused']:                         # Feature 4 – freeze
                vehicle.move()

        # Overlays
        if ui['show_dashboard']:                         # Feature 3
            draw_dashboard(screen, font_small, clock)

        if ui['paused']:                                 # Feature 4
            draw_paused_banner(screen, font_big)

        draw_keybind_hint(screen, font_small)

        pygame.display.update()
        clock.tick(60)


if __name__ == '__main__':
    Main()