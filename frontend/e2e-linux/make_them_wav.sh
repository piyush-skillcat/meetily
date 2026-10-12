#!/usr/bin/env bash
# Generates them.wav, the "remote participant" speech played through the default sink during the e2e loop.
set -euo pipefail
cd "$(dirname "$0")"
espeak-ng -s 150 -w them.wav "Hi Bios, thanks for joining. Let's go over the launch plan. We decided to ship the new onboarding flow on Friday, and you agreed to send the release notes to the design team by Thursday. One open question is whether we need a pricing page update before launch."
echo "wrote $(pwd)/them.wav"
