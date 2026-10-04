# Liquid Glass Studio

The keyboard gel selector adapts the rounded shape geometry, polynomial smooth-union SDF (merge rate), and spring animation approach from [iyinchao/liquid-glass-studio](https://github.com/iyinchao/liquid-glass-studio). The theme's optical maps port the superellipse SDF, Snell refraction, fifth-power Fresnel and directional glare equations from src/shaders/lib/sdf.glsl and src/shaders/fragment-main.glsl. The WebGL/WebGPU renderer is not bundled: generated SVG displacement maps refract the live DOM backdrop, preserving interactive content and video.

MIT License

Copyright (c) 2024 Charles Yin

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

# Xelu / Haaldor controller prompts

Steam Deck prompt vectors are exported from [haaldor/Xelu_prompts_SVG](https://github.com/haaldor/Xelu_prompts_SVG), based on Nicolae (Xelu) Berbece's prompt pack (CC0-1.0). Their editable font labels use Arial/system sans-serif rather than requiring COCOGOOSE. The isolated vector sources are in scripts/assets/xelu-steam-deck.json; regenerate with npm run generate:steam-deck.

# Steam overlay surface

The Windows overlay surface adapts [PSG-Team/tauri-steam-overlay-surface](https://github.com/PSG-Team/tauri-steam-overlay-surface) 0.1.3 (MIT), copyright 2026 The Private Sector Group, LLC (PSG Studios). Source, original license, and local changes are preserved in `src-tauri/vendor/steam-overlay-surface/`.
