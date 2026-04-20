import React, { useState, useRef } from 'react';

const encodeWAV = (samples, sampleRate) => {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeString = (view, offset, string) => {
    for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i));
  };
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);
  const floatTo16BitPCM = (output, offset, input) => {
    for (let i = 0; i < input.length; i++, offset += 2) {
      const s = Math.max(-1, Math.min(1, input[i]));
      output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
  };
  floatTo16BitPCM(view, 44, samples);
  return view;
};

export default function Deepverse() {
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState('System Standby');
  const [prediction, setPrediction] = useState('-');
  const [score, setScore] = useState(0);
  const [alert, setAlert] = useState(false);
  const [logs, setLogs] = useState([]);
  const [sessionHistory, setSessionHistory] = useState([]);
  const [finalReport, setFinalReport] = useState(null);

  const audioContextRef = useRef(null);
  const processorRef = useRef(null);
  const sourceRef = useRef(null);
  const audioBufferRef = useRef([]); 

  const startMonitoring = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
  audio: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    sampleRate: 16000,
    channelCount: 1
  } 
});
      setIsRecording(true);
      setStatus('Acoustic Analysis Active');
      setAlert(false);
      setFinalReport(null);
      setLogs([]);
      setSessionHistory([]);
      setPrediction('-');
      setScore(0);

      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
      sourceRef.current = audioContextRef.current.createMediaStreamSource(stream);
      processorRef.current = audioContextRef.current.createScriptProcessor(4096, 1, 1);
      
      processorRef.current.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        audioBufferRef.current.push(new Float32Array(inputData));
      };

      sourceRef.current.connect(processorRef.current);
      processorRef.current.connect(audioContextRef.current.destination);

      const chunkInterval = setInterval(() => {
        sendChunkToBackend();
      }, 2500);
      
      processorRef.current.intervalId = chunkInterval;
    } catch (err) {
      console.error(err);
      setStatus('Microphone Error');
    }
  };

  const stopMonitoring = () => {
    setIsRecording(false);
    setStatus('System Standby');
    setAlert(false);
    
    if (processorRef.current) {
      clearInterval(processorRef.current.intervalId);
      processorRef.current.disconnect();
      sourceRef.current.disconnect();
      audioContextRef.current.close();
      audioBufferRef.current = [];
    }

    if (sessionHistory.length > 0) {
      const totalCount = sessionHistory.length;
      
      const avgConfidence = sessionHistory.reduce((acc, curr) => {
        const fakeProb = curr.prediction === 'FAKE' ? curr.confidence_score : (1 - curr.confidence_score);
        return acc + fakeProb;
      }, 0) / totalCount;
      
      const fakeCount = sessionHistory.filter(h => {
        const fakeProb = h.prediction === 'FAKE' ? h.confidence_score : (1 - h.confidence_score);
        return fakeProb > 0.55;
      }).length;
      
      const fakeRatio = fakeCount / totalCount;
      const isCompromised = fakeRatio >= 0.15 || avgConfidence > 0.45;
      
      setFinalReport({
        totalChunks: totalCount,
        fakeChunks: fakeCount,
        averageScore: avgConfidence,
        verdict: isCompromised ? 'COMPROMISED' : 'AUTHENTIC',
        riskLevel: isCompromised ? 'CRITICAL' : 'MINIMAL'
      });
    }
  };

  const sendChunkToBackend = async () => {
    if (audioBufferRef.current.length === 0) return;

    const length = audioBufferRef.current.reduce((acc, chunk) => acc + chunk.length, 0);
    const fullBuffer = new Float32Array(length);
    let offset = 0;
    for (const chunk of audioBufferRef.current) {
      fullBuffer.set(chunk, offset);
      offset += chunk.length;
    }
    
    audioBufferRef.current = [];
    const wavData = encodeWAV(fullBuffer, 16000);
    const audioBlob = new Blob([wavData], { type: 'audio/wav' });

    const formData = new FormData();
    formData.append('file', audioBlob, 'chunk.wav');

    try {
      const response = await fetch('http://127.0.0.1:8000/process_call_chunk', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();
      
      if (data.prediction !== "SILENCE") {
        setStatus('Acoustic Analysis Active');
        
        const logEntry = { 
          id: Date.now(),
          time: new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit' }), 
          ...data 
        };

        setLogs(prev => [logEntry, ...prev].slice(0, 6));

        setSessionHistory(prev => {
          const newHistory = [...prev, data];
          const recentChunks = newHistory.slice(-3);
          
          const rollingAvg = recentChunks.reduce((sum, item) => {
            const fakeProb = item.prediction === 'FAKE' ? item.confidence_score : (1 - item.confidence_score);
            return sum + fakeProb;
          }, 0) / recentChunks.length;
          
          setScore(rollingAvg);
          setPrediction(rollingAvg > 0.55 ? 'FAKE' : 'REAL');
          setAlert(rollingAvg > 0.55);

          return newHistory;
        });
      } else {
        setStatus('Scanning Ambient Silence');
      }
    } catch (error) {
      console.error(error);
      setStatus('Backend Offline');
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans relative overflow-hidden selection:bg-indigo-500/30 flex flex-col">
      <div className="absolute top-[-20%] left-[-10%] w-[70%] h-[70%] rounded-full bg-indigo-900/20 blur-[120px] pointer-events-none mix-blend-screen"></div>
      <div className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] rounded-full bg-fuchsia-900/10 blur-[120px] pointer-events-none mix-blend-screen"></div>
      <div className={`absolute inset-0 bg-rose-950/20 transition-opacity duration-1000 pointer-events-none z-0 ${alert ? 'opacity-100' : 'opacity-0'}`}></div>

      <div className="flex-1 max-w-7xl mx-auto w-full p-6 md:p-10 relative z-10 flex flex-col">
        <header className="flex justify-between items-center mb-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-indigo-500/25">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"></path></svg>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-zinc-100 to-zinc-400">
              Deepverse
            </h1>
          </div>
          <div className="flex items-center gap-3 px-5 py-2.5 rounded-full bg-zinc-900/60 border border-white/5 backdrop-blur-xl">
            <span className="relative flex h-2.5 w-2.5">
              {isRecording && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>}
              <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${isRecording ? 'bg-indigo-500' : 'bg-zinc-600'}`}></span>
            </span>
            <span className="text-[11px] font-semibold text-zinc-300 uppercase tracking-widest">{status}</span>
          </div>
        </header>

        {finalReport ? (
          <div className="flex-1 flex items-center justify-center animate-[fadeIn_0.5s_ease-out]">
            <div className="bg-white/[0.02] border border-white/[0.05] rounded-[2rem] p-10 md:p-16 backdrop-blur-3xl shadow-2xl w-full max-w-3xl relative overflow-hidden">
              <div className="relative z-10 text-center mb-12">
                <h2 className="text-sm font-semibold tracking-widest text-zinc-500 uppercase mb-2">Session Audit Complete</h2>
                <h3 className={`text-5xl font-bold tracking-tighter ${finalReport.verdict === 'COMPROMISED' ? 'text-rose-400' : 'text-emerald-400'}`}>
                  {finalReport.verdict}
                </h3>
              </div>

              <div className="grid grid-cols-2 gap-6 relative z-10 mb-12">
                <div className="bg-zinc-900/40 p-6 rounded-2xl border border-white/[0.03]">
                  <p className="text-zinc-500 text-xs font-semibold uppercase tracking-widest mb-1">Total Fragments</p>
                  <p className="text-3xl font-bold text-zinc-200">{finalReport.totalChunks}</p>
                </div>
                <div className="bg-zinc-900/40 p-6 rounded-2xl border border-white/[0.03]">
                  <p className="text-zinc-500 text-xs font-semibold uppercase tracking-widest mb-1">Threat Assessment</p>
                  <p className={`text-3xl font-bold ${finalReport.riskLevel === 'CRITICAL' ? 'text-rose-400' : 'text-emerald-400'}`}>{finalReport.riskLevel}</p>
                </div>
                <div className="col-span-2 bg-zinc-900/40 p-6 rounded-2xl border border-white/[0.03]">
                  <p className="text-zinc-500 text-xs font-semibold uppercase tracking-widest mb-3">Overall Synthetic Probability</p>
                  <div className="flex items-center gap-4">
                    <span className="text-4xl font-bold text-zinc-200">{(finalReport.averageScore * 100).toFixed(1)}%</span>
                    <div className="flex-1 bg-zinc-950 rounded-full h-3 overflow-hidden border border-white/5">
                      <div 
                        className={`h-full rounded-full ${finalReport.averageScore > 0.45 ? 'bg-gradient-to-r from-orange-500 to-rose-500' : 'bg-gradient-to-r from-teal-400 to-emerald-400'}`}
                        style={{ width: `${Math.min(finalReport.averageScore * 100, 100)}%` }}
                      ></div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-center relative z-10">
                <button 
                  onClick={() => setFinalReport(null)}
                  className="px-8 py-4 rounded-2xl font-semibold tracking-wide bg-white text-zinc-950 hover:bg-zinc-200 shadow-[0_0_40px_rgba(255,255,255,0.1)] transition-all"
                >
                  Dismiss Report
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className={`transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] overflow-hidden ${alert ? 'max-h-40 opacity-100 mb-8 transform translate-y-0' : 'max-h-0 opacity-0 transform -translate-y-4'}`}>
              <div className="bg-rose-500/10 border border-rose-500/20 rounded-3xl p-6 flex items-center gap-6 backdrop-blur-2xl shadow-2xl shadow-rose-900/20">
                <div className="p-4 bg-rose-500/20 rounded-2xl flex-shrink-0">
                  <svg className="w-8 h-8 text-rose-500 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                </div>
                <div>
                  <h2 className="text-xl font-bold text-rose-400 tracking-tight">Deepfake Audio Detected</h2>
                  <p className="text-rose-400/70 text-sm mt-1.5 font-medium">Synthetic anomalies have breached the confidence threshold. Identity verification failed.</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 flex-1">
              <div className="lg:col-span-8 flex flex-col gap-8">
                <div className="bg-white/[0.02] border border-white/[0.05] rounded-[2rem] p-10 backdrop-blur-3xl shadow-2xl flex flex-col justify-between relative overflow-hidden flex-1 group">
                  {isRecording && (
                    <div className="absolute inset-0 flex items-center justify-end pr-20 pointer-events-none z-0 overflow-hidden opacity-40">
                      <div className="w-[600px] h-[600px] bg-indigo-500/10 rounded-full blur-[80px] animate-pulse"></div>
                    </div>
                  )}

                  <div className="relative z-10">
                    <h3 className="text-zinc-500 text-xs font-semibold tracking-widest uppercase mb-6">Live Telemetry</h3>
                    <div className="flex flex-col md:flex-row md:items-end justify-between gap-8">
                      <div>
                        <span className={`text-[7rem] leading-none font-bold tracking-tighter transition-colors duration-500
                          ${prediction === 'FAKE' ? 'text-rose-400 drop-shadow-[0_0_30px_rgba(251,113,133,0.3)]' 
                          : prediction === 'REAL' ? 'text-emerald-400 drop-shadow-[0_0_30px_rgba(52,211,153,0.2)]' 
                          : 'text-zinc-700'}`}>
                          {prediction}
                        </span>
                      </div>
                      
                      <div className="pb-4 w-full md:w-64">
                        <div className="flex justify-between items-baseline mb-3">
                          <span className="text-zinc-500 text-xs font-semibold uppercase tracking-widest">Confidence</span>
                          <span className="text-3xl font-bold tracking-tight text-zinc-200">
                            {prediction !== '-' ? (score * 100).toFixed(1) : '0.0'}
                            <span className="text-lg text-zinc-500 ml-1">%</span>
                          </span>
                        </div>
                        <div className="w-full bg-zinc-900/80 rounded-full h-2 overflow-hidden border border-white/5">
                          <div 
                            className={`h-full rounded-full transition-all duration-1000 ease-[cubic-bezier(0.16,1,0.3,1)]
                              ${score > 0.55 ? 'bg-gradient-to-r from-orange-500 to-rose-500' : 'bg-gradient-to-r from-teal-400 to-emerald-400'}`}
                            style={{ width: `${Math.min(score * 100, 100)}%` }}
                          ></div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="relative z-10 mt-16 pt-8 border-t border-white/[0.04] flex items-center justify-between">
                    <div>
                      <h4 className="text-zinc-300 font-medium text-lg">Real-time Acoustic Scanner</h4>
                      <p className="text-zinc-500 text-sm mt-1">Intercepting and analyzing biometric voice parameters.</p>
                    </div>
                    <button 
                      onClick={isRecording ? stopMonitoring : startMonitoring}
                      className={`relative px-8 py-4 rounded-2xl font-semibold tracking-wide transition-all duration-300 overflow-hidden
                        ${isRecording 
                          ? 'bg-rose-500/10 text-rose-400 border border-rose-500/30 hover:bg-rose-500/20' 
                          : 'bg-white text-zinc-950 hover:bg-zinc-200 shadow-[0_0_40px_rgba(255,255,255,0.1)] hover:shadow-[0_0_60px_rgba(255,255,255,0.2)]'}`}
                    >
                      {isRecording ? 'Halt Analysis' : 'Initialize Capture'}
                    </button>
                  </div>
                </div>
              </div>

              <div className="lg:col-span-4 bg-white/[0.01] border border-white/[0.04] rounded-[2rem] p-8 backdrop-blur-3xl shadow-2xl flex flex-col">
                <h3 className="text-zinc-500 text-xs font-semibold tracking-widest uppercase mb-6">Analysis Audit</h3>
                <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                  {logs.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-zinc-600 space-y-4">
                      <div className="w-16 h-16 rounded-full border border-zinc-800 flex items-center justify-center bg-zinc-900/50">
                        <svg className="w-6 h-6 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"></path></svg>
                      </div>
                      <span className="text-sm font-medium">Awaiting stream data</span>
                    </div>
                  ) : (
                    <ul className="space-y-3">
                      {logs.map((log) => (
                        <li key={log.id} className="flex justify-between items-center bg-zinc-900/40 p-4 rounded-2xl border border-white/[0.03] transition-colors hover:bg-zinc-900/60">
                          <div className="flex items-center gap-4">
                            <span className="text-zinc-500 text-xs font-medium tracking-wider">{log.time}</span>
                            <span className={`px-3 py-1 text-[10px] font-bold rounded-lg tracking-widest uppercase
                              ${log.prediction === 'FAKE' ? 'bg-rose-500/10 text-rose-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                              {log.prediction}
                            </span>
                          </div>
                          <span className="text-zinc-300 font-medium text-sm">
                            {(log.confidence_score * 100).toFixed(1)}%
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}