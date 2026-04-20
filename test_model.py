import torch
import librosa
from transformers import Wav2Vec2Processor, Wav2Vec2Model

MODEL_ID = "facebook/wav2vec2-base" 


print("Loading model...")
processor = Wav2Vec2Processor.from_pretrained(MODEL_ID)
model = Wav2Vec2Model.from_pretrained(MODEL_ID)
model.eval()
print("Model loaded!")

# 🔥 Change this to any sample audio file you have
AUDIO_PATH = "sample.wav"

# Load audio
waveform, sample_rate = librosa.load(AUDIO_PATH, sr=16000)

inputs = processor(
    waveform,
    sampling_rate=16000,
    return_tensors="pt",
    padding=True
)

with torch.no_grad():
    outputs = model(**inputs)

embeddings = outputs.last_hidden_state
pooled_embedding = torch.mean(embeddings, dim=1)

print("Embedding shape:", pooled_embedding.shape)
print("Embedding norm:", torch.norm(pooled_embedding).item())

