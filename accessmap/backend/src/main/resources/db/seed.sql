-- AccessMap Authentication & Reports Database Schema

-- 1. Tabela utilizatorilor (suportă autentificare locală și OAuth: Google / Facebook)
CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255),
    full_name VARCHAR(100),
    avatar_url VARCHAR(500),
    role VARCHAR(20) NOT NULL DEFAULT 'ROLE_USER',
    provider VARCHAR(20) NOT NULL DEFAULT 'LOCAL',
    provider_id VARCHAR(100),
    google_id VARCHAR(100),
    facebook_id VARCHAR(100),
    preferred_profile VARCHAR(30) DEFAULT 'wheelchair',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    failed_attempts INT NOT NULL DEFAULT 0,
    lockout_until TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP
);

-- Asigură existența coloanelor pentru upgrade incremental
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS facebook_id VARCHAR(100);

-- Indexuri unice case-insensitive pentru garantarea absolută a unicității
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users(LOWER(username));
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users(LOWER(email));

-- Indexuri pentru căutare rapidă OAuth și securitate
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
CREATE INDEX IF NOT EXISTS idx_users_facebook_id ON users(facebook_id);
CREATE INDEX IF NOT EXISTS idx_users_provider ON users(provider, provider_id);

-- 2. Tabela de rapoarte obstacole (dacă nu există deja)
CREATE TABLE IF NOT EXISTS reports (
    id BIGSERIAL PRIMARY KEY,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    type VARCHAR(50) NOT NULL,
    description TEXT,
    upvotes INT NOT NULL DEFAULT 1,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    author_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    author_name VARCHAR(100),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. Cont demonstrativ prestabilit
-- Parolă cont demo: Parola123!
-- BCrypt hash pentru 'Parola123!' (cost 12):
-- $2a$12$K8q2cMhYI692l4aH20vIKeJ4jN49P.Q/gVv8Z0Y46lPvZ0t.iW6b.
INSERT INTO users (username, email, password_hash, full_name, role, provider, preferred_profile)
VALUES (
    'utilizator_demo',
    'demo@accessmap.ro',
    '$2a$12$4mU87N3Z9G4K3n1KkPvUheFq6G2C2sYk9W5zL2sP8kZ9aB7c4D6eO',
    'Utilizator Demo',
    'ROLE_USER',
    'LOCAL',
    'wheelchair'
)
ON CONFLICT (email) DO NOTHING;
