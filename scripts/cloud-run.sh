#!/bin/bash
# Narrates every page that still lacks OmniVoice audio, skipping any page already present in audio-omni/.
# Before the first run, copy finished pages from the Mac (rsync -a audio-omni/ <host>:~/Hayatus_Sahaba/audio-omni/)
# so nothing is redone. When finished, copy audio-omni/ back to the Mac and run scripts/publish-omni.sh.
cd ~/Hayatus_Sahaba && . ~/venv/bin/activate
for v in 1 2 3; do python scripts/gen-audio-omni-cuda.py $v; done
echo "ALL DONE"
