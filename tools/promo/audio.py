"""Original synthesized soundbeds. No samples, downloaded music or voices."""
from pathlib import Path
import math
import wave
import numpy as np

OUT = Path(__file__).resolve().parents[2] / 'dist/promo/work'
SR = 48000
DURATION = 30

def make(style):
    sound = np.zeros((SR * DURATION, 2), dtype=np.float64)
    rng = np.random.default_rng(240926)

    def note(at, hz, length, level, pan=0, pluck=True):
        start = int(at * SR)
        count = min(int(length * SR), len(sound) - start)
        if count <= 0:
            return
        t = np.arange(count) / SR
        wave0 = np.sin(2 * math.pi * hz * t) + .22 * np.sin(2 * math.pi * hz * 2.001 * t)
        env = (1 - np.exp(-t * (110 if pluck else 2))) * np.exp(-t * (3.1 if pluck else .35))
        env *= np.minimum(1, (length - t) * 3)
        mono = wave0 * env * level
        sound[start:start + count, 0] += mono * math.sqrt((1 - pan) / 2)
        sound[start:start + count, 1] += mono * math.sqrt((1 + pan) / 2)

    tempo = {'main': 100, 'squares': 120, 'constellation': 96}[style]
    beat = 60 / tempo
    chords = [[146.83, 220, 293.66, 349.23], [130.81, 196, 261.63, 329.63],
              [174.61, 220, 293.66, 349.23], [130.81, 196, 261.63, 392]]
    for bar in range(math.ceil(DURATION / (beat * 8))):
        chord = chords[bar % 4]
        for i, hz in enumerate(chord):
            note(bar * beat * 8, hz / 2, beat * 8 + .5, .039, (i - 1.5) * .3, False)
        for j in range(16):
            at = bar * beat * 8 + j * beat / 2
            if at >= 29:
                break
            hz = chord[[0, 2, 1, 3, 2, 1, 3, 2][j % 8]] * (2 if style != 'constellation' else 1)
            note(at, hz, 1.5, .044 if j % 2 == 0 else .025, math.sin(j * .8) * .6)
    for at in np.arange(0, 28.8, beat):
        start = int(at * SR)
        n = min(int(.28 * SR), len(sound) - start)
        t = np.arange(n) / SR
        kick = np.sin(2 * math.pi * (48 * t + 28 * (1 - np.exp(-t * 28)) / 28)) * np.exp(-t * 18) * .12
        sound[start:start + n] += kick[:, None]
    for at in [3, 7, 11, 15, 19, 23, 26] if style == 'main' else [3.6, 7.1, 10.6, 14.1, 17.6, 21.1, 24.6] if style == 'squares' else [5, 10, 15, 20, 25]:
        for i, hz in enumerate([587.33, 880, 1174.66]):
            note(at + i * .045, hz, .8, .045, (i - 1) * .25)
    sound = np.tanh(sound)
    sound /= max(1, np.max(np.abs(sound)) / .82)
    with wave.open(str(OUT / (style + '.wav')), 'wb') as output:
        output.setnchannels(2)
        output.setsampwidth(2)
        output.setframerate(SR)
        output.writeframes((sound * 32767).astype('<i2').tobytes())

for style in ['main', 'squares', 'constellation']:
    make(style)
    print('Original audio:', style)
