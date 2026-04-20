from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from transformers import pipeline
import soundfile as sf
import numpy as np
import shutil
import os
import tempfile

app = FastAPI(title="Deepverse API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

print("🚀 Loading 'In-The-Wild' AI Deepfake Detection Model...")
classifier = pipeline(
    "audio-classification", 
    model="abhishtagatya/wav2vec2-base-960h-itw-deepfake"
)
print("✅ Deepverse Engine loaded successfully!")

def predict_audio(file_path: str):
    audio_array, sr = sf.read(file_path, dtype='float32')
    
    if len(audio_array.shape) > 1:
        audio_array = audio_array.mean(axis=1)
        
    
    rms_volume = np.sqrt(np.mean(audio_array**2))
    if rms_volume < 0.005:  
        return "SILENCE", 0.0


    results = classifier({"raw": audio_array, "sampling_rate": sr})
    
    
    print(f"🧠 RAW AI OUTPUT: {results}") 

    top_prediction = results[0]
    label = str(top_prediction["label"]).upper()
    score = float(top_prediction["score"])
    
    if "FAKE" in label or "SPOOF" in label:
        prediction = "REAL"
    elif "REAL" in label or "BONA" in label:
        prediction = "REAL"
    else:
        prediction = "FAKE"
        
    return prediction, score

@app.post("/process_call_chunk")
def process_call_chunk(file: UploadFile = File(...)):
    try:
        tmp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".wav")
        shutil.copyfileobj(file.file, tmp_file)
        tmp_file.close()

        prediction, confidence_score = predict_audio(tmp_file.name)
        
        alert = prediction == "FAKE" and confidence_score > 0.55

    finally:
        if os.path.exists(tmp_file.name):
            os.remove(tmp_file.name)

    return {
        "prediction": prediction,
        "confidence_score": confidence_score,
        "alert": alert
    }