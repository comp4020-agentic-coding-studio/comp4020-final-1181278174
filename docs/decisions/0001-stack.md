# 1. Astro on Node, SQLite on the Fly volume

Date: 7 October 2026. Status: accepted.

## Context

The app needs a server that builds each page when it is requested, keeps
sessions, questions and votes after a restart or a redeploy, and, from crit 9,
sends changes to every open phone within about a second. The course's Fly
setup gives one small machine with 256 MB of memory, one storage volume
mounted at `/data`, and no separate database server. The `/readme/` page must
contain the README's headings in the HTML the server sends. I had about four
hours to build the first version.

## Options

- **Astro with the Node adapter, and SQLite through better-sqlite3 and
  Drizzle.** I used the same setup on Fly in crit 7. Pages are built on the
  server for each request, forms work without JavaScript, and Astro can import
  README.md as Markdown.
- **Hono with htmx.** Smaller, and htmx makes it easy to update part of a page,
  but I had not used either, so I would have set up templates, Markdown and the
  build from scratch on the night.
- **SvelteKit or Next.js.** Next.js needs a lot of memory for a 256 MB machine.
  SvelteKit would fit, but I would have had to learn how its forms work on the
  night, and I already knew how Astro's work.
- **PocketBase.** It has storage and live updates built in, but its database
  tables and access rules are set up in PocketBase's own format, so most of
  the app would be PocketBase settings rather than code I write and test.

For live updates I compared three ways:

- **Server-sent events.** The server keeps a connection open to each page and
  sends it updates. It is plain HTTP and works through Fly's proxy.
- **WebSockets.** A two-way connection. The app does not need two-way, because
  asking and voting are normal form posts.
- **Polling.** Each phone asks the server for changes every second or so. It is
  simple, but a full room would send a lot of requests for a page that rarely
  changes.

## Decision

Astro with the Node adapter, and SQLite on `/data` through Drizzle. Database
migrations are committed to the repo and run when the server starts.
Server-sent events for crit 9.

## Consequences

- There is one machine and one database file. The app cannot be spread over
  more machines, and if the volume is lost, the data is lost. For one room, one
  machine is enough.
- better-sqlite3 runs queries one at a time, so a slow query makes every other
  request wait. The queries are small, and questions are indexed by session.
- Until crit 9 adds JavaScript, every action reloads the whole page. This is
  slower than an app, but it works on any phone.
- Each open phone will keep one server-sent events connection to a 256 MB
  machine. I need to measure how many it can hold in crit 9.
