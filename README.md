<div align="center">
  
# 🚦 Traffic AI 

**Intelligent, Real-Time Traffic Management & Simulation System**

[![FastAPI](https://img.shields.io/badge/FastAPI-005571?style=for-the-badge&logo=fastapi)](https://fastapi.tiangolo.com/)
[![Next.js](https://img.shields.io/badge/Next.js-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![YOLOv8](https://img.shields.io/badge/YOLOv8-FF00FF?style=for-the-badge&logo=ultralytics&logoColor=white)](https://ultralytics.com/)
[![Python](https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
[![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)](https://reactjs.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)

</div>

---

## 📖 Overview

**Traffic AI** is an advanced, end-to-end traffic management system designed to alleviate urban congestion by dynamically adjusting traffic light phases based on real-time vehicle density. 

By leveraging state-of-the-art **Computer Vision (YOLOv8 fine-tuned on VisDrone)**, the system analyzes live camera feeds, classifies vehicle types, tracks their movement, and computes the optimal green-light duration for each lane. It comes complete with a robust FastAPI backend, a highly interactive Next.js dashboard, and a standalone Pygame 2D simulation environment.

---

## ✨ Core Features

### 🧠 Intelligent Traffic Logic & Vision
*   **VisDrone Fine-Tuned AI**: Utilizes a custom fine-tuned YOLO model (`yolov8m.pt` base) trained on the **VisDrone dataset** for highly accurate aerial vehicle detection.
*   **Multi-Class Detection**: Accurately detects, tracks, and counts 5 distinct vehicle classes: **Cars, Bikes, Buses, Trucks, and Rickshaws**.
*   **Object Tracking**: Custom distance-based ID tracker prevents double-counting of vehicles across frames.
*   **Dynamic Signal Timing**: Allocates green time dynamically (e.g., 3 seconds per vehicle) bounded by configurable min/max constraints to prevent lane starvation.
*   **Emergency Vehicle Override**: One-click or API-triggered emergency mode instantly grants priority green lights to designated lanes.

### 💻 Real-Time Web Dashboard (Frontend)
*   **Next.js & React 18**: Lightning-fast modern web architecture.
*   **Live Intersection Canvas**: A high-performance HTML5 `<canvas>` simulation visualizing real-time traffic flow, vehicle lag, and intersection crossing.
*   **WebSockets Integration**: Bi-directional real-time communication between the AI backend and the frontend dashboard.
*   **Analytics & Charts**: Real-time traffic density visualizations and system performance metrics.

### 🎮 Pygame Simulation (Standalone)
*   **Offline Algorithm Testing**: A dedicated Python 2D simulation environment (`pygame_sim.py`) to test complex routing algorithms, vehicle lag, custom vehicle distributions, and turning logic for heavy vehicles without needing the web stack.

---

## 🏗️ System Architecture

```text
traffic-ai/
├── backend/                  # 🐍 Python FastAPI application
│   ├── app/                  # Core application modules
│   │   ├── routes/           # REST API endpoints (analyze, simulate, emergency)
│   │   ├── services/         # Core business logic (AI Detector, Lane Mapping)
│   │   ├── models/           # Pydantic schemas for data validation
│   │   ├── main.py           # Application entry point & CORS config
│   │   └── websocket.py      # Real-time WebSockets connection manager
│   ├── finetune_visdrone.py  # Script for training YOLO on VisDrone dataset
│   ├── requirements.txt      # Python dependencies
│   └── runs/                 # Stores fine-tuned YOLO model weights
├── frontend/                 # ⚛️ Next.js Web Dashboard
│   ├── app/                  # App Router directory
│   │   ├── components/       # Reusable UI (SignalCards, Simulation canvas, Charts)
│   │   ├── dashboard/        # Main control panel view
│   │   └── page.tsx          # Landing page with Framer Motion UI
│   ├── tailwind.config.js    # Tailwind CSS styling configuration
│   └── package.json          # Node dependencies
└── pygame_sim.py             # 🚗 Offline Pygame 2D traffic simulator
```

---

## 🚀 Getting Started

### Prerequisites
*   **Python 3.9+**
*   **Node.js 18+ & npm**
*   *(Optional but Recommended)* **NVIDIA GPU** with CUDA support for real-time AI inference.

### 1. Backend Setup (FastAPI & YOLOv8)

```bash
# Navigate to the backend directory
cd backend

# Create and activate a virtual environment
python -m venv venv
# On Windows:
venv\Scripts\activate
# On macOS/Linux:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Start the FastAPI server
uvicorn app.main:app --reload
```
> The API will be available at `http://localhost:8000`.

### 2. Frontend Setup (Next.js Dashboard)

Open a new terminal instance:

```bash
# Navigate to the frontend directory
cd frontend

# Install Node dependencies
npm install

# Start the Next.js development server
npm run dev
```
> The dashboard will be available at `http://localhost:3000`.

### 3. Running the Pygame Simulation
For rapid algorithm testing without the web UI:

```bash
# Ensure you have pygame installed in your active environment
pip install pygame

# Run the simulator
python pygame_sim.py
```

---

## 🛠️ Fine-Tuning the AI Model

This project includes a dedicated pipeline for fine-tuning YOLO models on the **VisDrone dataset** for improved aerial accuracy.

1. Download the VisDrone dataset and extract it into `backend/VisDrone/`.
2. Ensure the directory structure matches the requirements in `finetune_visdrone.py`.
3. Run the training script:
```bash
cd backend
python finetune_visdrone.py
```
4. The script will automatically convert annotations, train the model, and save the `best.pt` weights to the `runs/visdrone_finetune/weights/` directory. The `ai_detector.py` is pre-configured to use these custom weights.

---

## 📡 API Endpoints Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/` | Health check and API status. |
| `WS` | `/ws` | WebSocket endpoint for real-time bi-directional data flow. |
| `POST` | `/analyze` | Upload an image frame for YOLOv8 inference and lane mapping. |
| `POST` | `/emergency` | Trigger emergency priority mode for a specific lane. |
| `POST` | `/simulate` | Send/receive backend simulation cycle ticks. |

---

## 👨‍💻 Development & Contribution

*   **Canvas Performance**: The `VehicleSimulation.tsx` in the frontend relies heavily on `requestAnimationFrame`. Adjust simulation speeds carefully via the defined constants to maintain 60FPS.
*   **Model Weights**: Do **not** commit `.pt` or `.onnx` files to version control. Let the scripts generate/download them locally.

<br/>

<div align="center">
  <i>Built with precision for smarter, safer, and faster cities.</i>
</div>
