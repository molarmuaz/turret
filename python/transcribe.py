import whisper
import sys
import os

def transcribe_audio(file_path):
    print(f"Loading Whisper model...")
    #model = whisper.load_model("tiny")  # Use "tiny" for faster transcription
    model = whisper.load_model("base")  # Use "base" for better accuracy
    print(f"Attempting to load file from: {file_path}")
    
    if not os.path.exists(file_path):
        print(f"Error: The file at {file_path} does not exist.")
        return
    
    print(f"Starting transcription...")
    result = model.transcribe(file_path)
    
    # Just print the transcription text as the last line for easy parsing
    print(result["text"])

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python transcribe.py <audio_file_path>")
        sys.exit(1)
    
    audio_file = sys.argv[1]
    transcribe_audio(audio_file)