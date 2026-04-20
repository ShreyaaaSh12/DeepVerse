import asyncio
import websockets
import sounddevice as sd
import numpy as np
import io
import scipy.io.wavfile as wav
import json

DURATION = 3  # seconds
SAMPLE_RATE = 16000

async def record_and_send():
    uri = "ws://127.0.0.1:8000/ws-detect"

    print("Recording for 3 seconds... Speak now!")

    # Record audio from system mic
    recording = sd.rec(
        int(DURATION * SAMPLE_RATE),
        samplerate=SAMPLE_RATE,
        channels=1,
        dtype='int16'
    )
    sd.wait()

    print("Recording complete. Sending to server...")

    # Convert numpy array to WAV bytes
    wav_bytes = io.BytesIO()
    wav.write(wav_bytes, SAMPLE_RATE, recording)
    wav_bytes.seek(0)

    async with websockets.connect(uri) as websocket:
        await websocket.send(wav_bytes.read())

        response = await websocket.recv()
        result = json.loads(response)

        print("\n===== Deepfake Detection Result =====")
        print("Prediction:", result["prediction"])
        print("Embedding Score:", result["embedding_score"])
        print("=====================================\n")

if __name__ == "__main__":
    asyncio.run(record_and_send())

