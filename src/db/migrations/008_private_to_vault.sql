-- Migration 008: Rename 'private' visibility to 'vault'
UPDATE media SET visibility = 'vault' WHERE visibility = 'private';
