from fastapi import APIRouter, File, UploadFile, HTTPException
from app.services.ai_detector import detector
from app.models.schemas import AnalyzeImageResponse

router = APIRouter()

@router.post("/analyze-image", response_model=AnalyzeImageResponse)
async def analyze_image_endpoint(file: UploadFile = File(...)):
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File provided is not an image.")
    
    try:
        contents = await file.read()
        lane_data = await detector.analyze_image(contents)
        return lane_data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
