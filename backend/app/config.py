import os

class Settings:
    PROJECT_NAME: str = "Smart Traffic Management System"
    VERSION: str = "1.0.0"
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    YOLO_MODEL: str = "yolov8n.pt"

settings = Settings()
