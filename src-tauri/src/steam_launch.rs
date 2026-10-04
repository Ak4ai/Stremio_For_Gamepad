#[derive(Default)]
pub struct OverlayGate {
    active: bool,
    ever_activated: bool,
    last_transition: Option<std::time::Instant>,
}

impl OverlayGate {
    pub fn set_active(&mut self, active: bool, now: std::time::Instant) {
        self.active = active;
        self.ever_activated |= active;
        self.last_transition = Some(now);
    }

    pub fn needs_bootstrap(&self) -> bool {
        !self.ever_activated
    }

    pub fn is_active(&self) -> bool {
        self.active
    }

    pub fn request_open(&mut self, now: std::time::Instant) -> bool {
        // Closing the native overlay can hand the same key press back to the
        // webview. Ignore that tail and duplicate requests before the callback.
        if self.active || self.last_transition.is_some_and(|last| now.duration_since(last) < std::time::Duration::from_millis(250)) {
            return false;
        }
        self.last_transition = Some(now);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn overlay_does_not_toggle_or_reopen_on_focus_handoff() {
        use std::time::{Instant, Duration};
        let start = Instant::now();
        let mut gate = OverlayGate::default();
        assert!(gate.needs_bootstrap());
        assert!(gate.request_open(start));
        assert!(!gate.request_open(start + Duration::from_millis(50)));
        gate.set_active(true, start + Duration::from_millis(100));
        assert!(!gate.needs_bootstrap());
        assert!(!gate.request_open(start + Duration::from_secs(5)));
        gate.set_active(false, start + Duration::from_secs(6));
        assert!(!gate.needs_bootstrap(), "never show the closed surface after Steam has painted opaque frames");
        assert!(!gate.request_open(start + Duration::from_millis(6100)));
        assert!(gate.request_open(start + Duration::from_millis(6400)), "accept a deliberate reopen without a long dead period");
    }
}
