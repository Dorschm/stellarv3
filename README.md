# OpenFront

A real-time strategy game focused on territorial control and alliance building. Players compete to expand their territory, build structures, and form strategic alliances.

## License

OpenFront source code is licensed under the **GNU Affero General Public License v3.0**

Current copyright notices appear in:

- Footer: "© OpenFront and Contributors"
- Loading screen: "© OpenFront and Contributors"

Modified versions must preserve these notices in reasonably visible locations.

See the [LICENSE](LICENSE) for complete requirements.

For asset licensing, see [LICENSE-ASSETS](LICENSE-ASSETS).
For license history, see [LICENSING.md](LICENSING.md).

## Features

- Real-time strategy gameplay: expand your territory and engage in strategic battles
- Alliance system: form alliances with other players for mutual defense
- Multiple maps across various geographical regions
- Resource management: balance expansion with defensive capabilities
- Cross-platform: play in any modern web browser

## Prerequisites

- npm (v10.9.2 or higher)
- A modern web browser (Chrome, Firefox, Edge, etc.)

## Installation

1. Clone the repository.
2. Install dependencies:

   ```bash
   npm run inst
   ```

   Do NOT use `npm install` nor `npm i` — use `npm run inst`. It runs the safer `npm ci --ignore-scripts` to install exactly the versions in `package-lock.json` without executing install scripts.

3. Copy the env template and fill in your own credentials:

   ```bash
   cp .env.example .env
   # then edit .env
   ```

   The server starts without any of these variables — Discord login and the run-history sync just stay disabled until they're set. See `.env.example` for the full list and inline documentation.

## Backend

This repo ships a self-hosted backend (SQLite, by default at `data/userdb.sqlite`). It implements every endpoint the client expects: Discord OAuth login, user profile, run history, leaderboards (stubbed empty until you add data), and a cosmetics catalog (also stubbed). All routes mount under `/api` on the same Node server that serves the game client — no external service required.

To use Discord login you need to register your own application at https://discord.com/developers/applications, set its OAuth redirect URI to `${API_BASE_URL}/api/auth/login/discord/callback`, and put the client id / secret in `.env`. The repo's server never calls any external OpenFront API.

## Running the Game

### Development Mode

Run both the client and server in development mode with live reloading:

```bash
npm run dev
```

This will:

- Start the webpack dev server for the client
- Launch the game server with development settings
- Open the game in your default browser (to disable this behavior, set `SKIP_BROWSER_OPEN=true` in your environment)

### Client Only

```bash
npm run start:client
```

### Server Only

```bash
npm run start:server-dev
```

## Development Tools

- Format code: `npm run format`
- Lint code: `npm run lint`
- Lint and fix code: `npm run lint:fix`
- Run tests: `npm test`

## Project Structure

- `/src/client` — Frontend game client
- `/src/core` — Shared game logic
- `/src/server` — Backend game server
- `/resources` — Static assets (images, maps, etc.)

## Contributing

Contributions are welcome. Please open an issue describing what you want to contribute before investing significant time, and keep pull requests focused on a single feature or bug fix.

### Code Quality Requirements

- All code must follow the existing style patterns
- New features should not break existing functionality
- All code changes in `src/core` must be covered by tests
