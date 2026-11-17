use std::time::{Duration, Instant};

#[derive(Default)]
pub struct OverlaySession {
    pub presenting: bool,
    pub confirmed: bool,
    pub closing: bool,
    closed_at: Option<Instant>,
    exit_hint: Option<Instant>,
    input_idle_since: Option<Instant>,
}

impl OverlaySession {
    pub fn open(&mut self) { self.presenting = true; self.confirmed = false; self.closing = false; self.exit_hint = None; self.input_idle_since = None; }
    pub fn observe_input(&mut self, input: bool) {
        if self.presenting && input { self.confirmed = true; }
        if input { self.input_idle_since = None; }
        else if self.input_idle_since.is_none() { self.input_idle_since = Some(Instant::now()); }
        // Device capture ending is not a close command. Keep presenting.
    }
    pub fn close(&mut self) { self.presenting = false; self.confirmed = false; self.closing = false; self.closed_at = Some(Instant::now()); self.exit_hint = None; }
    pub fn can_adopt(&self) -> bool { !self.presenting && !self.closed_at.is_some_and(|at| at.elapsed() < Duration::from_millis(400)) }
    pub fn exit_interaction(&mut self) { self.exit_hint = Some(Instant::now()); }
    pub fn has_exit_hint(&self) -> bool { self.exit_hint.is_some_and(|at| at.elapsed() < Duration::from_millis(1200)) }
    pub fn exit_acknowledged(&self) -> bool {
        self.presenting && self.confirmed && !self.closing && self.has_exit_hint()
            && self.input_idle_since.is_some_and(|at| at.elapsed() >= Duration::from_millis(250))
    }
}

#[derive(Default)]
pub struct OverlayGate {
    pub last_native_transition: Option<Instant>,
    last_request: Option<Instant>,
}

impl OverlayGate {
    pub fn set_active(&mut self, _active: bool, now: Instant) {
        self.last_native_transition = Some(now);
    }

    pub fn begin(&mut self, now: Instant) -> bool {
        if self.last_request.is_some_and(|last| now.duration_since(last) < Duration::from_millis(500)) { return false; }
        self.last_request = Some(now);
        true
    }

    pub fn guide_was_handled(&self, pressed: Instant) -> bool {
        // Steam may handle the physical PS key before HID delivers its packet.
        let earliest = pressed.checked_sub(Duration::from_millis(250)).unwrap_or(pressed);
        self.last_native_transition.is_some_and(|last| last >= earliest)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn capture_handoff_cannot_close_or_unconfirm_a_presented_panel() {
        let mut session = OverlaySession::default();
        session.observe_input(true);
        assert!(!session.presenting);
        session.open(); session.observe_input(true); session.observe_input(false);
        assert!(session.presenting); assert!(session.confirmed);
        session.close(); assert!(!session.presenting); assert!(!session.can_adopt());
    }
    #[test]
    fn back_close_requires_exit_intent_and_sustained_input_release() {
        let mut session = OverlaySession::default();
        session.open(); session.observe_input(true); session.observe_input(false);
        session.input_idle_since = Some(Instant::now() - Duration::from_millis(300));
        assert!(!session.exit_acknowledged());
        session.exit_interaction(); assert!(session.exit_acknowledged());
        session.observe_input(true); assert!(!session.exit_acknowledged());
        session.observe_input(false); assert!(!session.exit_acknowledged());
        session.input_idle_since = Some(Instant::now() - Duration::from_millis(300));
        assert!(session.exit_acknowledged());
        session.closing = true; assert!(!session.exit_acknowledged());
    }
    #[test]
    fn steam_handling_before_or_after_hid_prevents_a_second_toggle() {
        let start = Instant::now();
        let press = start + Duration::from_secs(1);
        let mut gate = OverlayGate::default();
        assert!(!gate.guide_was_handled(press));
        gate.set_active(true, press - Duration::from_millis(20));
        assert!(gate.guide_was_handled(press));
        gate.set_active(false, press + Duration::from_millis(60));
        assert!(gate.guide_was_handled(press));
        assert!(!gate.guide_was_handled(press + Duration::from_secs(2)));
    }
    #[test]
    fn request_bounce_is_filtered_without_a_long_dead_period() {
        let now = Instant::now();
        let mut gate = OverlayGate::default();
        assert!(gate.begin(now));
        assert!(!gate.begin(now + Duration::from_millis(20)));
        assert!(gate.begin(now + Duration::from_millis(600)));
    }
}
