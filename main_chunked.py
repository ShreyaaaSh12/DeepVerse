from fastapi import FastAPI, WebSocket
from transformers import AutoFeatureExtractor, AutoModelForAudioClassification
import torch
import torch.nn.functional as F
import numpy as np
import librosa
import soundfile as sf
import io

app = FastAPI()

MODEL_ID = "facebook/wav2vec2-base"

print("Loading model...")
feature_extractor = AutoFeatureExtractor.from_pretrained(MODEL_ID)
model = AutoModelForAudioClassification.from_pretrained(MODEL_ID)
print("Model loaded!")

@app.get("/")
def root():
    return {"message": "On-Call Detection Server Running"}

# 2-second window streaming
CHUNK_DURATION = 2.0
TARGET_SR = 16000

@app.websocket("/ws-detect")
async def websocket_detect(websocket: WebSocket):
    await websocket.accept()
    print("Client connected")

    try:
        while True:
            # Receive raw audio bytes
            audio_bytes = await websocket.receive_bytes()

            # Convert bytes to waveform
            data, sample_rate = sf.read(io.BytesIO(audio_bytes), dtype="float32")

            if len(data.shape) > 1:
                data = data.mean(axis=1)

            if sample_rate != TARGET_SR:
                data = librosa.resample(data, orig_sr=sample_rate, target_sr=TARGET_SR)

            inputs = feature_extractor(
                data,
                sampling_rate=TARGET_SR,
                return_tensors="pt"
            )

            with torch.no_grad():
                outputs = model(**inputs)

            logits = outputs.logits
            probs = F.softmax(logits, dim=-1)
            score = probs[0].max().item()

            risk = "HIGH" if score > 0.7 else "LOW"

            await websocket.send_json({
                "score": float(score),
                "risk": risk
            })

    except Exception as e:
        print("Connection closed:", str(e))


