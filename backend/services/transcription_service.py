"""
Audio/video transcription service using Faster-Whisper (local).
"""

from __future__ import annotations

import logging
import os

log = logging.getLogger(__name__)

# Cache the model to avoid reloading
_model = None


def _get_model():
    global _model
    if _model is None:
        from faster_whisper import WhisperModel

        # Use "base" model by default — good balance of speed and accuracy
        # Runs on CPU; use "cuda" device if GPU is available
        _model = WhisperModel("base", device="cpu", compute_type="int8")
        log.info("Loaded Faster-Whisper 'base' model on CPU")
    return _model


async def transcribe_file(filepath: str) -> str:
    """
    Transcribe an audio or video file to text.
    Supports: .mp3, .wav, .m4a, .ogg, .flac, .mp4, .webm, .mkv, .avi
    Returns the full transcription text.
    """
    import asyncio

    if not os.path.exists(filepath):
        raise FileNotFoundError(f"File not found: {filepath}")

    def _transcribe():
        model = _get_model()
        segments, info = model.transcribe(filepath, beam_size=5)
        log.info(
            "Transcribing %s — detected language: %s (prob: %.2f)",
            os.path.basename(filepath),
            info.language,
            info.language_probability,
        )
        text_parts = []
        for segment in segments:
            text_parts.append(segment.text.strip())
        return " ".join(text_parts)

    # Run in thread pool since Whisper is CPU-bound
    loop = asyncio.get_running_loop()
    text = await loop.run_in_executor(None, _transcribe)
    return text


def is_audio_video(filename: str) -> bool:
    """Check if a file is an audio or video file based on extension."""
    ext = os.path.splitext(filename)[1].lower()
    return ext in {
        ".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac", ".wma",
        ".mp4", ".webm", ".mkv", ".avi", ".mov", ".wmv", ".flv",
    }


def is_transcript(filename: str) -> bool:
    """Check if a file is a text transcript."""
    ext = os.path.splitext(filename)[1].lower()
    return ext in {".txt", ".md", ".csv", ".vtt", ".srt"}
