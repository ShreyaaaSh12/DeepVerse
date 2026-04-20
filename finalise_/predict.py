import librosa
import numpy as np
import joblib

svm_model = joblib.load("svm_final.pkl")
scaler = joblib.load("scaler_final.pkl")

def extract_features(path):
    y, sr = librosa.load(path, sr=16000, mono=True)

    y = librosa.util.normalize(y)
    y = librosa.effects.preemphasis(y)
    y, _ = librosa.effects.trim(y, top_db=20)

    mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13)
    mfcc_mean = np.mean(mfcc, axis=1)
    mfcc_std = np.std(mfcc, axis=1)

    delta = librosa.feature.delta(mfcc)
    delta_mean = np.mean(delta, axis=1)

    centroid = np.mean(librosa.feature.spectral_centroid(y=y, sr=sr))
    bandwidth = np.mean(librosa.feature.spectral_bandwidth(y=y, sr=sr))
    rolloff = np.mean(librosa.feature.spectral_rolloff(y=y, sr=sr))
    zcr = np.mean(librosa.feature.zero_crossing_rate(y))
    rms = np.mean(librosa.feature.rms(y=y))

    return np.hstack([
        mfcc_mean, mfcc_std, delta_mean,
        centroid, bandwidth, rolloff, zcr, rms
    ])

def predict_audio(path):
    feat = extract_features(path)
    feat = scaler.transform([feat])

    prob = svm_model.predict_proba(feat)[0][1]

    if prob > 0.75:
        decision = "Fake"
    elif prob > 0.45:
        decision = "Uncertain"
    else:
        decision = "Real"

    return {
        "decision": decision,
        "fake_probability": float(prob)
    }
