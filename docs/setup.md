# Local setup

MindKeep needs a C++20 compiler, CMake 3.20+, MySQL 8.x, OpenSSL, and ICU development libraries. On Ubuntu:

```bash
sudo apt install build-essential cmake libmysqlclient-dev libssl-dev libicu-dev mysql-server
```

Create a MySQL database and a dedicated user. Replace the placeholder password with your own:

```sql
CREATE DATABASE mindkeep CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'mindkeep'@'127.0.0.1' IDENTIFIED BY 'YOUR_RANDOM_LOCAL_PASSWORD';
GRANT ALL PRIVILEGES ON mindkeep.* TO 'mindkeep'@'127.0.0.1';
```

Copy `.env.example` to `.env`, set the database credentials, and keep the file private. The app applies its schema on startup.

```bash
cp .env.example .env
chmod 600 .env
# Edit .env before continuing.
./scripts/run.sh
```

Open [localhost:8080](http://localhost:8080) and create an account. Launch from the project root so the frontend and migration paths resolve.

## Checks

```bash
ctest --test-dir build --output-on-failure
node tests/search-ui-tests.mjs
node tests/note-preview-tests.mjs
```

VS Code uses the generated `build/compile_commands.json` for C++20 diagnostics. Both Microsoft C/C++ and clangd have project configuration.

## Optional services

Configure SMTP with `./scripts/configure-email.sh` for password recovery. PDF export requires a Chromium-based browser; set `MINDKEEP_PDF_BROWSER` to its executable. More details are in `.env.example` and [the API documentation](api.md).

For public deployment, use HTTPS, `MINDKEEP_SECURE_COOKIE=1`, the correct `MINDKEEP_PUBLIC_URL`, and persistent database/media storage. Keep `.env`, `data/`, and database backups private; they are excluded from Git.
