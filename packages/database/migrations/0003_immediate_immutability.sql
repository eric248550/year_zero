-- Between-tick player actions are part of the replay log and never change.
CREATE TRIGGER `immediate_actions_no_update` BEFORE UPDATE ON `immediate_actions`
BEGIN SELECT RAISE(ABORT, 'immediate_actions log is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER `immediate_actions_no_delete` BEFORE DELETE ON `immediate_actions`
BEGIN SELECT RAISE(ABORT, 'immediate_actions log is append-only'); END;
