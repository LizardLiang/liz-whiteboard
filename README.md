# liz-whiteboard — Real-Time Collaborative ER Diagram & Database Schema Designer

> **Open-source, self-hostable entity-relationship (ER) diagram editor for designing database schemas in the browser** — with real-time multiplayer collaboration and a built-in **MCP (Model Context Protocol) server** so AI agents like **Claude** and **Cursor** can read and edit your diagrams.

![Bun](https://img.shields.io/badge/runtime-Bun-black)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TanStack Start](https://img.shields.io/badge/TanStack-Start-ff4154)
![SQLite](https://img.shields.io/badge/SQLite-embedded-003B57?logo=sqlite&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

liz-whiteboard is a **collaborative database design tool** — think a focused, self-hosted alternative to dbdiagram.io, drawSQL, or the diagram side of DataGrip — for sketching **entity-relationship diagrams**, modelling **SQL database schemas**, and documenting data models. It runs as a single Bun process backed by an embedded SQLite database, so you can self-host the whole thing from one container.

---

## Table of contents

- [Features](#features)
- [Why liz-whiteboard](#why-liz-whiteboard)
- [Tech stack](#tech-stack)
- [Quick start (development)](#quick-start-development)
- [Run with Docker](#run-with-docker)
- [AI / MCP integration](#ai--mcp-integration-edit-diagrams-with-claude--cursor)
- [Configuration](#configuration)
- [Project structure](#project-structure)
- [Testing](#testing)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

---

## Features

- 🎨 **Visual ER diagram editor** — drag-and-drop tables, columns, and relationships on an infinite canvas (powered by [React Flow](https://reactflow.dev/)).
- 🧱 **Rich schema modelling** — 25 SQL **data types** (`int`, `varchar`, `uuid`, `json`, `timestamp`, …) and 17 relationship **cardinalities** (one-to-one, one-to-many, many-to-many, and zero/optional variants).
- 🔑 **Keys & constraints** — primary keys, foreign keys, unique, nullable, and column ordering.
- 👥 **Real-time multiplayer collaboration** — multiple users edit the same whiteboard live over Socket.IO (create/update/move/delete broadcast instantly).
- 🗂️ **Projects, folders & whiteboards** — organise many diagrams per project.
- 🔐 **Accounts & sessions** — email/password authentication with secure session cookies.
- 🪪 **Built-in OAuth 2.1 Authorization Server** — issue access tokens (PKCE, JWKS) for first-party and AI clients.
- 🤖 **AI-ready (MCP)** — a companion [Model Context Protocol server](https://github.com/LizardLiang/liz-whiteboard-mcp) lets LLM agents (Claude Desktop, Claude Code, Cursor, VS Code) **read and edit your ER diagrams** programmatically.
- 📦 **Self-hosted & portable** — one SQLite file, one Docker image, no external database required.

## Why liz-whiteboard

- **Own your data.** Self-host on your own machine or server; everything lives in a single `data/app.db` SQLite file.
- **Design databases faster.** A canvas built specifically for entity-relationship modelling and SQL schema design — not a generic drawing tool.
- **Collaborate in real time.** Share a whiteboard and design schemas together, live.
- **Automate with AI.** Generate or refactor schemas with an LLM through the MCP integration instead of clicking every table by hand.

## Tech stack

- **Runtime:** [Bun](https://bun.sh/)
- **Framework:** [TanStack Start](https://tanstack.com/start) (React 19, SSR) + [TanStack Router](https://tanstack.com/router), [Query](https://tanstack.com/query), and [Form](https://tanstack.com/form)
- **Canvas:** [React Flow / @xyflow/react](https://reactflow.dev/)
- **Realtime:** [Socket.IO](https://socket.io/)
- **Database:** SQLite (raw SQL data layer, schema auto-created on first run)
- **Auth:** session cookies + OAuth 2.1 (PKCE, JWKS) via [`jose`](https://github.com/panva/jose)
- **UI:** [Tailwind CSS](https://tailwindcss.com/) + [Radix UI](https://www.radix-ui.com/) / [shadcn/ui](https://ui.shadcn.com/)
- **Validation:** [Zod](https://zod.dev/)

## Quick start (development)

Requirements: [Bun](https://bun.sh/) `1.2+`.

```bash
bun install
cp .env.local.example .env.local   # if present; otherwise see Configuration below
bun run dev
```

Open **http://localhost:3000**. The dev script runs the Vite app and the Socket.IO collaboration server together. The SQLite schema is created automatically on first connect; seed sample data with:

```bash
bun run db:seed
```

## Run with Docker

```bash
bun run docker:build      # docker build -t liz-whiteboard:test .
bun run docker:run        # docker run --rm -p 3000:3000 liz-whiteboard:test
```

The image bundles the web app, the OAuth Authorization Server, and the real-time collaboration server in one container with an embedded SQLite database. For a **full stack behind a single domain** (app + AI/MCP server fronted by a reverse proxy), see the Docker Compose setup in [liz-whiteboard-mcp](https://github.com/LizardLiang/liz-whiteboard-mcp).

## AI / MCP integration (edit diagrams with Claude & Cursor)

liz-whiteboard ships a companion **Model Context Protocol (MCP) server**: **[liz-whiteboard-mcp](https://github.com/LizardLiang/liz-whiteboard-mcp)**. It exposes 23 tools that let AI agents list projects and whiteboards, read the full schema and per-table DDL, create/update/delete tables, columns, and relationships (individually or in a single batch), and create/manage subject areas (colored grouping regions) — all authenticated through this app's OAuth 2.1 server. Point Claude Desktop, Claude Code, Cursor, or any MCP client at it to design databases conversationally.

## Configuration

Configuration is via environment variables (loaded from `.env.local` in development).

| Variable                                               | Description                                                                                                                        |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                         | SQLite database file, e.g. `file:./data/app.db` (absolute path recommended in production).                                         |
| `OAUTH_ISSUER`                                         | Public issuer URL of the built-in Authorization Server (e.g. `https://your-domain`).                                               |
| `MCP_RESOURCE_URI`                                     | Canonical URI of the MCP resource server (e.g. `https://your-domain/mcp`) — used as the OAuth token audience.                      |
| `COLLAB_RESOURCE_URI`                                  | Audience for internal collaboration tokens (defaults to the app origin).                                                           |
| `MCP_CLIENT_SECRET`                                    | Shared secret the MCP backend uses to mint collaboration tokens (`/api/collab-token`).                                             |
| `OAUTH_SIGNING_KEY_FILE` / `OAUTH_SIGNING_KEY_PRIVATE` | RS256 signing key (PKCS#8 PEM) for OAuth tokens — set a **persistent** key in production. `OAUTH_SIGNING_KEY_KID` sets its key id. |
| `OAUTH_ALLOW_DCR`                                      | Set to `true` to enable the open Dynamic Client Registration endpoint (`/oauth/register`). **Off by default** — it is not advertised in AS metadata and DCR-registered clients are always untrusted, so leave this unset unless you've added a consent screen. |
| `CIMD_ALLOWED_ORIGINS`                                 | JSON array of https origins trusted for Client ID Metadata Document (CIMD) resolution. Defaults to `["https://claude.ai", "https://claude.com"]`. |
| `DEBUG_SUPER_PASSWORD`                                 | Optional dev-only login bypass (never set in production).                                                                          |

## Project structure

```
src/
├── routes/            # TanStack file-based routes (pages + API)
│   ├── api/           # auth, projects, folders, whiteboards, tables, columns,
│   │                  # relationships, permissions, collaboration, collab-token
│   ├── authorize.ts   # OAuth 2.1 /authorize (PKCE)
│   ├── token.ts       # OAuth 2.1 /token
│   └── whiteboard/    # the diagram editor
├── data/              # raw-SQL SQLite data layer + schema-sql.ts
├── lib/
│   ├── auth/          # sessions, password hashing
│   └── oauth/         # keys (JWKS), token issuance, PKCE, client allowlist
└── components/        # React UI (Tailwind + Radix/shadcn)
server.prod.ts         # production server (HTTP + Socket.IO)
server.dev.ts          # dev Socket.IO server
```

## Testing

```bash
bun run test           # Vitest
bun run check          # prettier + eslint
```

## Roadmap

- Role-based access control for shared projects (membership model exists; enforcement is being finalised)
- SQL / DBML export and import
- Dynamic client registration (DCR) and a consent screen for third-party MCP clients

## Contributing

Issues and pull requests are welcome. Run `bun run check` before submitting.

## License

[MIT](LICENSE) © LizardLiang

---

**Keywords:** ER diagram tool, entity relationship diagram editor, database schema designer, SQL schema design, data modeling tool, online ERD, collaborative diagram editor, real-time multiplayer whiteboard, self-hosted dbdiagram alternative, drawSQL alternative, Model Context Protocol, MCP server, AI database design, Claude, Cursor, TanStack Start, Bun, React, SQLite, open source.
