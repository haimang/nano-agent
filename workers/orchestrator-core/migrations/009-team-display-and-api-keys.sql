ALTER TABLE nano_teams ADD COLUMN team_name TEXT NOT NULL DEFAULT '';
ALTER TABLE nano_teams ADD COLUMN team_slug TEXT;

UPDATE nano_teams
   SET team_name = CASE
     WHEN team_name IS NULL OR trim(team_name) = '' THEN 'team-' || substr(team_uuid, 1, 8)
     ELSE trim(team_name)
   END;

UPDATE nano_teams
   SET team_slug =
     lower(
       substr(
         replace(
           replace(
             replace(coalesce(nullif(trim(team_name), ''), 'team-' || substr(team_uuid, 1, 8)), ' ', '-'),
             '--',
             '-'
           ),
           '--',
           '-'
         ),
         1,
         25
       )
     ) || '-' || lower(hex(randomblob(3)))
 WHERE team_slug IS NULL;

CREATE UNIQUE INDEX uq_nano_teams_team_slug
  ON nano_teams(team_slug);

ALTER TABLE nano_team_api_keys ADD COLUMN key_salt TEXT NOT NULL DEFAULT '';
ALTER TABLE nano_auth_sessions ADD COLUMN device_uuid TEXT;

CREATE INDEX idx_nano_auth_sessions_device_uuid
  ON nano_auth_sessions(device_uuid);
