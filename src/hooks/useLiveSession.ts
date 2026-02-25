import { useState, useCallback, useRef, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";
import { floatTo16BitPCM, arrayBufferToBase64, base64ToArrayBuffer } from '../utils/audio-utils';

const MODEL = "gemini-2.5-flash-native-audio-preview-12-2025";

export function useLiveSession() {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [transcript, setTranscript] = useState<{ role: 'user' | 'model', text: string }[]>([]);
  const [turnCount, setTurnCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const aiRef = useRef<any>(null);
  const sessionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioQueueRef = useRef<Float32Array[]>([]);
  const isPlayingRef = useRef(false);

  const stopAudio = useCallback(() => {
    if (processorRef.current) processorRef.current.disconnect();
    if (sourceRef.current) sourceRef.current.disconnect();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    setIsConnected(false);
  }, []);

  const playNextChunk = useCallback(async () => {
    if (audioQueueRef.current.length === 0 || isPlayingRef.current || !audioContextRef.current) {
      return;
    }

    isPlayingRef.current = true;
    const chunk = audioQueueRef.current.shift()!;
    
    const audioBuffer = audioContextRef.current.createBuffer(1, chunk.length, 24000);
    audioBuffer.getChannelData(0).set(chunk);
    
    const source = audioContextRef.current.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContextRef.current.destination);
    
    source.onended = () => {
      isPlayingRef.current = false;
      playNextChunk();
    };
    
    source.start();
  }, []);

  const connect = useCallback(async () => {
    if (isConnected || isConnecting) return;
    
    setIsConnecting(true);
    setError(null);

    try {
      const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
      if (!apiKey || apiKey.length < 10) {
        throw new Error("Gemini API Key is missing. Please add your GEMINI_API_KEY to the Secrets panel (bottom left) and refresh.");
      }

      const ai = new GoogleGenAI({ apiKey });
      aiRef.current = ai;

      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      audioContextRef.current = audioContext;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const source = audioContext.createMediaStreamSource(stream);
      sourceRef.current = source;

      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      const sessionPromise = ai.live.connect({
        model: MODEL,
        callbacks: {
          onopen: () => {
            console.log("Live session opened");
            setIsConnected(true);
            setIsConnecting(false);
            
            processor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmData = floatTo16BitPCM(inputData);
              const base64Data = arrayBufferToBase64(pcmData.buffer);
              
              sessionPromise.then(session => {
                session.sendRealtimeInput({
                  media: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
                });
              });
            };
            
            // Increment turn count when session opens (or we can do it on first audio input)
            // But let's do it when the user actually speaks.
            // Actually, the Live API doesn't have a clear "user turn start" event in the same way as chat.
            // We'll increment it when we receive the first user transcription.
            
            source.connect(processor);
            processor.connect(audioContext.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.modelTurn?.parts) {
              for (const part of message.serverContent.modelTurn.parts) {
                if (part.inlineData) {
                  const pcmBuffer = base64ToArrayBuffer(part.inlineData.data);
                  const pcmData = new Int16Array(pcmBuffer);
                  const floatData = new Float32Array(pcmData.length);
                  for (let i = 0; i < pcmData.length; i++) {
                    floatData[i] = pcmData[i] / 32768;
                  }
                  audioQueueRef.current.push(floatData);
                  playNextChunk();
                }
              }
            }

            if (message.serverContent?.interrupted) {
              audioQueueRef.current = [];
              // In a real app, we'd stop the current source node too
            }

            // Handle transcriptions
            if (message.serverContent?.modelTurn?.parts?.[0]?.text) {
              const text = message.serverContent.modelTurn.parts[0].text;
              setTranscript(prev => {
                // If the last message was from the model, append to it (streaming feel)
                // Actually, Live API usually sends full turns or chunks.
                // For simplicity, let's just append if it's a new turn.
                return [...prev, { role: 'model', text }];
              });
            }

            // User transcription
            const anyMessage = message as any;
            if (anyMessage.serverContent?.userTurn?.parts?.[0]?.text) {
              const text = anyMessage.serverContent.userTurn.parts[0].text;
              setTranscript(prev => [...prev, { role: 'user', text }]);
              setTurnCount(prev => prev + 1);
            }

            // Turn is complete
            if (message.serverContent?.turnComplete) {
              // Turn is complete
            }
          },
          onclose: () => {
            console.log("Live session closed");
            stopAudio();
          },
          onerror: (err: any) => {
            console.error("Live session error", err);
            const errorMsg = err?.message || "Connection error. Please try again.";
            setError(`Live session error: ${errorMsg}`);
            stopAudio();
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
          },
          outputAudioTranscription: {},
          inputAudioTranscription: {},
          systemInstruction: "You are the AI assistant for 'Healing with MMA', a compassionate and professional AI counseling service. Your goal is to provide a safe, non-judgmental space for the user to talk about their feelings, challenges, and goals. Listen actively, validate their emotions, and offer gentle guidance or coping strategies when appropriate. Keep your responses concise and conversational, as this is a voice interaction. Do not provide medical or psychiatric diagnoses. If the user mentions self-harm, provide resources and encourage professional help.",
        },
      });

      sessionRef.current = await sessionPromise;

    } catch (err: any) {
      console.error("Failed to connect", err);
      setError(err.message || "Failed to access microphone or connect to AI.");
      setIsConnecting(false);
    }
  }, [isConnected, isConnecting, playNextChunk, stopAudio]);

  const disconnect = useCallback(() => {
    if (sessionRef.current) {
      sessionRef.current.close();
    }
    stopAudio();
  }, [stopAudio]);

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    isConnected,
    isConnecting,
    transcript,
    turnCount,
    error,
    connect,
    disconnect
  };
}
