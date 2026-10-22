-- Credit names the exact invitation independently of a fresh registration attempt.
-- Historical RSVPs remain NULL: prior invitation credit cannot be inferred safely.
ALTER TABLE community_event_guest_rsvps
  ADD COLUMN credited_invitation_id uuid;
