# Local Windows non-Steam shortcut adaptation

Based on PSG-Team/tauri-steam-overlay-surface 0.1.3 (MIT). Upstream README
describes the original implementation; this copy differs as follows:

- Use Direct3D 12 instead of scanning Vulkan/DX12 backends.
- Warm Steam with 20 frames in a DWM-cloaked window, then hide the window and
  pause idle presentation until a request. Cloaking allows native composition
  without showing the preparation window to the user.
- Permit an opaque swapchain because it is only visible while opening/using
  Steam's overlay; close/failure immediately hides it.
- The application registers this plugin only if Steam injected its renderer.
- Do not initialize Steamworks or override AppIDs.
- Capture the application once before showing the overlay and use that frozen
  frame as its backdrop, including when the swapchain is opaque.
- Present the captured backdrop before showing the window, with a bounded wait.
  Preserve the swapchain when showing it; reconfigure only for resize/recovery.
  Repeated activation notifications do not recapture the visible overlay.

The user must launch the executable through their existing non-Steam shortcut.
Steam's injected renderer handles the shortcut identity and native input.
