-- Runs once when the dev container is first created.
-- A separate database for the test suite, so tests never touch dev data.
CREATE DATABASE booktracker_test OWNER = app;
