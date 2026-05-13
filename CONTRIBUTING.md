# Contributing

Thank you for considering contributing to OpenFront. Contributions are welcome — by participating in this project, you agree to treat all community members with respect.

## Getting Started

### Prerequisites

- **Node.js**: Ensure you have a recent version installed.
- **npm**: Version 10.9.2 or higher.
- **Git**: For version control.

### Installation

1. **Fork the repository** on GitHub.
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/OpenFrontIO.git
   cd OpenFrontIO
   ```
3. **Install dependencies**:
   > **Important**: Use `npm run inst` instead of `npm install`. This runs `npm ci --ignore-scripts` to ensure a consistent and secure environment.
   ```bash
   npm run inst
   ```

### Running the Game

- **Full Development Mode** (Client + Server):

  ```bash
  npm run dev
  ```

  This starts the webpack dev server and the game server, and opens your browser.

- **Client Only**:

  ```bash
  npm run start:client
  ```

- **Server Only**:
  ```bash
  npm run start:server-dev
  ```

## Development Workflow

### Branching

Create a new branch for each feature or bug fix:

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/issue-number-bug-name
```

### Coding Standards

We enforce code quality using ESLint and Prettier.

- **Format Code**:
  ```bash
  npm run format
  ```
- **Lint Code**:
  ```bash
  npm run lint
  ```
- **Lint & Fix**:
  ```bash
  npm run lint:fix
  ```

### Testing

All new features and bug fixes should include relevant tests. We use **Vitest**.

- **Run Tests**:
  ```bash
  npm test
  ```
- **Run Coverage**:
  ```bash
  npm run test:coverage
  ```

**Note**: All code changes in `src/core` **MUST** be tested to ensure game logic stability.

## Submitting a Pull Request

1. **Commit your changes**:

   - Write clear, concise commit messages.
   - Use the present tense ("Add feature" not "Added feature").

   ```bash
   git commit -m "Add new map rendering logic"
   ```

2. **Push to your fork**:

   ```bash
   git push origin feature/your-feature-name
   ```

3. **Open a Pull Request (PR)**:
   - Go to the original repository and click "New Pull Request".
   - Select your branch.
   - Fill out the **PR Template** completely.

### PR Checklist

Before submitting, ensure you have:

- [ ] Linked the relevant issue (e.g., `Resolves #123`).
- [ ] Added screenshots for any UI changes.
- [ ] Processed text through `translateText()` and added strings to `en.json`.
- [ ] Added/Updated tests in the `tests/` directory.
- [ ] Verified that `npm test` passes.

## Translations

Locale strings live in `resources/lang/`. `en.json` is the canonical source — add new keys there first, then translate into the other locale files as needed.

## Project Structure

- `src/client`: Frontend game client (rendering, input, UI).
- `src/server`: Backend game server (networking, game state).
- `src/core`: Shared game logic used by both client and server.
- `resources`: Static assets (images, sounds, maps).
- `tests`: Unit and integration tests.

## License

By contributing, you agree that your contributions will be licensed under the [GNU Affero General Public License v3.0 (AGPL v3.0)](LICENSE).
