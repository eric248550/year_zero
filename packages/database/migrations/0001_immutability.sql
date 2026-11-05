-- Historical records are immutable once committed.
CREATE TRIGGER `history_events_no_update` BEFORE UPDATE ON `history_events`
BEGIN SELECT RAISE(ABORT, 'history_events is append-only: historical records are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `history_events_no_delete` BEFORE DELETE ON `history_events`
BEGIN SELECT RAISE(ABORT, 'history_events is append-only: historical records cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `decisions_no_update` BEFORE UPDATE ON `decisions`
BEGIN SELECT RAISE(ABORT, 'decisions log is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER `snapshots_no_update` BEFORE UPDATE ON `snapshots`
BEGIN SELECT RAISE(ABORT, 'snapshots are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `definition_versions_no_update` BEFORE UPDATE ON `event_definition_versions`
BEGIN SELECT RAISE(ABORT, 'definition versions are append-only'); END;
