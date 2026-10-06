import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { sessions } from "./schema.ts";

// One SQLite file is the app's whole persistent state. In the image,
// DATABASE_PATH points at the volume (/data), which is how questions survive
// a restart and a redeploy; locally it is an untracked file in .data/.
const path = process.env.DATABASE_PATH ?? "./.data/hands-up.db";
mkdirSync(dirname(path), { recursive: true });

const client = new Database(path);
client.pragma("journal_mode = WAL");
client.pragma("foreign_keys = ON");

export const db = drizzle(client);

// Migrations run at boot, on whatever machine holds the volume. Edit
// src/lib/schema.ts, `pnpm db:generate`, commit the migration it writes.
migrate(db, { migrationsFolder: "./drizzle" });

// HAND is always there and always open, so a stranger has somewhere to ask
// the moment they arrive. Nobody is its host.
db.insert(sessions)
  .values({ code: "HAND", title: "Questions for the maker of this app", host: null, createdAt: new Date() })
  .onConflictDoNothing({ target: sessions.code })
  .run();
