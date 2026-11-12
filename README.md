# Sonar

Your phone or laptop, seeing with sound. The speaker plays a tone too high to hear (around 19 kHz) and the microphone listens to its echoes: a hand pushing, pulling or waving in the air, someone moving in the room, even your chest rising and falling as you breathe, from half a metre away, with no camera.

How it works: the microphone's signal is mixed with the same tones (I/Q demodulation, in an audio worklet), 500 times a second. Two tones exactly 500 Hz apart are read at once without disturbing each other, which makes the echo steadier; a sensitivity setting trades range for false alarms. Still things add up to a fixed part; anything moving shows up in the Doppler spectrum, above the tone when it comes closer and below when it goes away, by 2v/λ. Breathing is too slow for Doppler, so the chest's echo is followed around the circle it traces (a full turn for every 9 mm the chest moves), which gives its movement in millimetres. Everything is computed in the page; nothing is recorded or sent.

Turn the volume up and don't use headphones. Some speakers and microphones barely reach these frequencies: the page tries a few tones first and picks the best one your device handles.
