import whisper
import sys
import os
import numpy as np
import speech_recognition as sr
import torch

from datetime import datetime, timedelta
from queue import Queue
from time import sleep
from sys import platform

def transcribe_audio(file_path):
    print(f"Loading Whisper model...")
    model = whisper.load_model("base")  # Use "base" for better accuracy
    print(f"Attempting to load file from: {file_path}")
    
    if not os.path.exists(file_path):
        print(f"Error: The file at {file_path} does not exist.")
        return
    
    print(f"Starting transcription...")
    result = model.transcribe(file_path)
    
    print("\nTranscription:\n")
    print(result["text"])

def transcribe_realtime():
    """
    Perform real-time transcription using the microphone with Whisper.
    """
    # Configs
    model_name = "base"
    energy_threshold = 1000
    record_timeout = 1.0
    phrase_timeout = 2.0
    
    phrase_time = None
    data_queue = Queue()
    phrase_bytes = bytes()
    
    recorder = sr.Recognizer()
    recorder.energy_threshold = energy_threshold
    recorder.dynamic_energy_threshold = False

    # Microphone setup
    if 'linux' in platform:
        mic_name = 'pulse'
        for index, name in enumerate(sr.Microphone.list_microphone_names()):
            if mic_name in name:
                source = sr.Microphone(sample_rate=16000, device_index=index)
                break
        else:
            source = sr.Microphone(sample_rate=16000)
    else:
        source = sr.Microphone(sample_rate=16000)

    # Load Whisper model
    print("Loading Whisper model...")
    audio_model = whisper.load_model(model_name)

    transcription = ['']

    with source:
        print("Adjusting for ambient noise, please wait...")
        recorder.adjust_for_ambient_noise(source)

    def record_callback(_, audio: sr.AudioData):
        """Callback to receive audio chunks from mic."""
        data = audio.get_raw_data()
        data_queue.put(data)

    # Start listening in the background
    print("\nListening in real-time... (Press Ctrl+C to stop)\n")
    recorder.listen_in_background(source, record_callback, phrase_time_limit=record_timeout)

    try:
        while True:
            now = datetime.utcnow()
            if not data_queue.empty():
                phrase_complete = False
                if phrase_time and now - phrase_time > timedelta(seconds=phrase_timeout):
                    phrase_bytes = bytes()
                    phrase_complete = True

                phrase_time = now

                audio_data = b''.join(data_queue.queue)
                data_queue.queue.clear()

                phrase_bytes += audio_data

                audio_np = np.frombuffer(phrase_bytes, dtype=np.int16).astype(np.float32) / 32768.0

                result = audio_model.transcribe(audio_np, fp16=torch.cuda.is_available())
                text = result['text'].strip()

                if phrase_complete:
                    transcription.append(text)
                else:
                    transcription[-1] = text

                os.system('cls' if os.name == 'nt' else 'clear')
                for line in transcription:
                    print(line)
                print('', end='', flush=True)
            else:
                sleep(0.25)
    except KeyboardInterrupt:
        print("\n\nReal-time transcription stopped.\n")
        print("Final transcription:\n")
        for line in transcription:
            print(line)

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("No audio file provided, switching to real-time transcription mode.\n")
        transcribe_realtime()
    else:
        audio_file = sys.argv[1]
        transcribe_audio(audio_file)
