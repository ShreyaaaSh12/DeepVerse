import sounddevice as sd
import numpy as np
import requests
import wave
import io
import queue
import threading
from collections import deque  


BACKEND_URL = "http://127.0.0.1:8000/process_call_chunk"
CHUNK_DURATION = 2.5  
SAMPLE_RATE = 16000   
CHANNELS = 1

audio_queue = queue.Queue()
recent_scores = deque(maxlen=3) 

def create_wav_in_memory(audio_data):
    wav_io = io.BytesIO()
    with wave.open(wav_io, 'wb') as wf:
        wf.setnchannels(CHANNELS)
        wf.setsampwidth(2) 
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(audio_data.tobytes())
    wav_io.seek(0) 
    return wav_io

def audio_callback(indata, frames, time, status):
    audio_data = (indata.flatten() * 32767).astype(np.int16)
    audio_queue.put(audio_data)

def process_and_send_worker():
    while True:
        audio_data = audio_queue.get()
        if audio_data is None: 
            break
            
        wav_io = create_wav_in_memory(audio_data)
        
        try:
            files = {'file': ('chunk.wav', wav_io, 'audio/wav')}
            r = requests.post(BACKEND_URL, files=files)
            
            if r.status_code == 200:
                response = r.json()
                pred = response.get("prediction")
                score = response.get("confidence_score")

                if pred == "SILENCE":
                    print("🔈 SILENCE detected")
                else:
                    is_fake_score = 1.0 if pred == "FAKE" else 0.0
                    recent_scores.append(is_fake_score)
                    
                    rolling_avg = sum(recent_scores) / len(recent_scores)
                    
                    print(f"Chunk: {pred:<5} | Rolling Fake Probability: {rolling_avg:.2f}")
                    
                    if rolling_avg > 0.3:
                        print("⚠️  ALERT: Sustained Deepfake Audio Detected! ⚠️")
            else:
                print(f"❌ Server Error {r.status_code}")
                
        except Exception as e:
            print(f"❌ Connection Error: {e}")
            
        finally:
            audio_queue.task_done()

if __name__ == "__main__":
    print("🚀 Starting live continuous call monitoring...")
    worker_thread = threading.Thread(target=process_and_send_worker, daemon=True)
    worker_thread.start()

    try:
        block_size = int(CHUNK_DURATION * SAMPLE_RATE)
        with sd.InputStream(samplerate=SAMPLE_RATE, channels=CHANNELS, 
                            blocksize=block_size, callback=audio_callback):
            print("🎙️  Recording in the background. Press Ctrl+C to stop.")
            while True:
                sd.sleep(1000)

    except KeyboardInterrupt:
        print("\n🛑 Stopped monitoring. Shutting down gracefully...")
        audio_queue.put(None)
        worker_thread.join()