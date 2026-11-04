#!/bin/bash
# Run once on a fresh NVIDIA GPU machine (Ubuntu): installs everything and clones the repo.
# Then upload audio-omni/narrator.wav and narrator.txt from the Mac into ~/Hayatus_Sahaba/audio-omni/ and run
# scripts/cloud-run.sh. The narrator files must come from the Mac so the voice is identical on every page.
set -e
apt-get update -qq && apt-get install -y -qq ffmpeg git python3-venv
git clone https://github.com/aayashahmad/Hayatus_Sahaba.git ~/Hayatus_Sahaba
python3 -m venv ~/venv && . ~/venv/bin/activate
pip install -q torch torchaudio omnivoice faster-whisper soundfile numpy
mkdir -p ~/Hayatus_Sahaba/audio-omni
echo "setup done"
