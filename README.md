# 🚦 Traffic AI - Smart Traffic Management System

Traffic AI is an advanced, AI-powered traffic management system designed to optimize traffic light timings, reduce congestion, and prioritize emergency vehicles. By leveraging cutting-edge computer vision (**YOLOv8**) and real-time data processing, the system dynamically analyzes traffic density across multiple lanes and adjusts signal phases to ensure the most efficient flow of vehicles.

The project is split into three main components:
1. **Python / FastAPI Backend**: Handles ML inference, traffic algorithm logic, and WebSocket distribution.
2. **Next.js React Frontend**: A modern, interactive web dashboard for real-time monitoring and simulation control.
3. **Pygame Simulation Environment**: A standalone 2D simulation script for testing complex algorithms and vehicle behaviors offline.

---

## 🌟 Key Features

*   **Real-time Vehicle Detection**: Uses YOLOv8 Nano (`yolov8n.pt`) to detect four distinct classes of vehicles: Cars, Bikes (motorcycles), Trucks, and Buses.
*   **Dynamic Signal Timing**: Calculates optimal green light duration based on real-time vehicle counts. The system allocates **3 seconds per vehicle**, strictly clamped between a **10-second minimum** and a **60-second maximum** phase length.
*   **Intelligent Prioritization**: Analyzes quadrant-based traffic density (North, South, East, West) and automatically grants the green light to the busiest lane first.
*   **Emergency Vehicle Override**: Includes endpoints and UI controls to force a priority green light phase, simulating the approach of an ambulance or fire engine.
*   **Live Web Dashboard**: A Next.js frontend featuring rich CSS animations, Framer Motion transitions, real-time charts, and a detailed 2D visual representation of the intersection.
*   **WebSocket Integration**: Bi-directional real-time communication ensures the frontend dashboard instantly reflects backend state changes, vehicle detections, and active signal phases.

---

## 📁 Project Architecture

```text
traffic-ai/
├── backend/                  # Python FastAPI application
│   ├── app/
│   │   ├── routes/           # REST API endpoints (analyze, simulate, emergency)
│   │   ├── services/         # Core business logic (CV, Traffic routing)
│   │   ├── models/           # Pydantic schemas for data validation
│   │   ├── main.py           # Application entry point & CORS config
│   │   ├── config.py         # App configuration & environment setup
│   │   └── websocket.py      # Real-time connection manager
│   ├── requirements.txt      # Python dependencies
│   └── venv/                 # Python Virtual Environment
├── frontend/                 # Next.js Application
│   ├── app/
│   │   ├── components/       # Reusable UI (SignalCards, Simulation canvas, Charts)
│   │   ├── dashboard/        # Main control panel view
│   │   ├── simulation/       # Dedicated web-simulation view
│   │   ├── layout.tsx        # Root React layout
│   │   └── page.tsx          # Landing page with Framer Motion UI
│   ├── tailwind.config.js    # Tailwind CSS styling configuration
│   └── package.json          # Node dependencies
├── model/                    # ML Model Storage
│   ├── yolov8n.pt            # Auto-downloaded PyTorch weights (ignored in git)
│   └── README.md
├── pygame_sim.py             # Offline Pygame 2D traffic simulator
└── cleanup_unused.sh         # Housekeeping shell script
```

---

## 🧠 How the AI Works

### 1. Computer Vision Pipeline (`yolo_service.py`)
When a frame or image is submitted to the `/analyze` endpoint:
1. **Validation**: The image is validated for correct dimensions and color channels.
2. **Inference**: The cached YOLOv8n model runs inference to identify bounding boxes for vehicles.
3. **Quadrant Splitting**: The image is mathematically divided into four equal quadrants:
    *   **North** (Top Half)
    *   **South** (Bottom Half)
    *   **West** (Left Half)
    *   **East** (Right Half)
4. **Classification & Counting**: Based on the center-point `(cx, cy)` of each detected bounding box, the system increments the count for the specific vehicle type in the corresponding lane.

### 2. Traffic Logic Engine (`traffic_logic.py`)
1. **Aggregation**: Receives the raw vehicle counts from the CV pipeline.
2. **Phase Calculation**: Applies the `(total_vehicles * 3 seconds)` formula.
3. **Clamping**: Enforces the `MIN_GREEN` (10s) and `MAX_GREEN` (60s) constraints to prevent starvation of empty lanes or infinite green lights for congested lanes.
4. **Sorting**: Sorts the resulting queue so that the lane with the highest required green time is serviced first.

---

## 🖥️ The User Interface (`/frontend`)

Built with **React 18**, **Next.js**, and **Tailwind CSS**, the frontend serves as the command center.

### Core Components
*   **`VehicleSimulation.tsx`**: A highly complex HTML5 `<canvas>` component that renders a realistic 2D simulation. It handles vehicle spawning, spacing, acceleration (vehicle lag), stop-line adherence, and intersection crossing detection.
*   **`SignalCard.tsx`**: Displays the active status of a specific lane (Red/Yellow/Green) along with a dynamic countdown timer and visual queue representations.
*   **`ControlPanel.tsx`**: Allows manual intervention, tweaking simulation parameters, and triggering emergency protocols.
*   **`TrafficChart.tsx`**: Visualizes historical traffic density and system performance metrics.

---

## 🚀 Getting Started

### Prerequisites
*   **Python 3.9+** (For the FastAPI backend and Pygame simulation)
*   **Node.js 18+ & npm** (For the Next.js frontend)

### 1. Starting the Backend
The backend utilizes FastAPI and Uvicorn. Note: On the very first run, it will automatically download the `yolov8n.pt` weights (~6MB) to the `/model` directory.

```bash
cd backend

# Create and activate a virtual environment
python -m venv venv

# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run the development server
uvicorn app.main:app --reload
```
The API will be available at `http://localhost:8000`.

### 2. Starting the Frontend
Open a new terminal window to start the web dashboard.

```bash
cd frontend

# Install Node dependencies
npm install

# Start the Next.js development server
npm run dev
```
The dashboard will be available at `http://localhost:3000`.

### 3. Running the Offline Pygame Simulation
For algorithm testing and rapid visual feedback without needing the full web stack:

```bash
# Ensure you are in the project root and have the pygame library installed
pip install pygame
python pygame_sim.py
```

---

## ⚠️ Notes for Developers

*   **Model Weights**: Do **not** commit the `yolov8n.pt` or any other `.pt` / `.onnx` files to version control. They are automatically handled by the application.
*   **Canvas Performance**: The `VehicleSimulation.tsx` component is heavily optimized using React `useRef` and a `requestAnimationFrame` style draw loop (via `setInterval`). Modify the `TICK`, `SPEED`, and `SLOW_SPEED` constants carefully as they affect the flow rate and visual timing of the vehicles.
