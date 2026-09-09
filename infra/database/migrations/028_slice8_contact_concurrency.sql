-- Slice 8B2c: Add contact persistence concurrency token.
--
-- Contact inherits version lifecycle from AggregateRoot:
-- - Fresh Contact.version = 1 (discover emits one event)
-- - Fresh Contact.loadedVersion = undefined (never persisted)
-- - Reconstituted Contact.version = aggregateVersion
-- - Reconstituted Contact.loadedVersion = aggregateVersion
-- - Each mutation increments version via applyEvent()
--
-- This column persists the aggregate version for optimistic concurrency control.
-- It is a persistence field, not a Contact business property.
-- ContactProps/Contact class do NOT add a separate contactVersion field.

-- Add contact_version column with default 1 (initial aggregate version)
ALTER TABLE intelligence.contacts
ADD COLUMN contact_version INTEGER NOT NULL DEFAULT 1;

-- Add CHECK constraint matching AggregateRoot semantics (version >= 1)
ALTER TABLE intelligence.contacts
ADD CONSTRAINT contacts_contact_version_check CHECK (contact_version >= 1);
