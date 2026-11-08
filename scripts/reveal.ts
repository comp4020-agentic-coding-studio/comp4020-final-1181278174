// Open the sealed author of one question, as the auditor, with a reason. The
// private key stays with the auditor and is read from a file given here; the
// app never has it. Every opening is written to the database's `reveals`
// table first: which question, when, and why.
//
//   node scripts/reveal.ts --db hands-up.db --key ~/hands-up-audit-private-key.pem \
//     --question 42 --reason "reported as a threat, case 2026-11-09-1"
//
// For the live app, take a backup first (`mise exec -- scripts/backup.sh`, which
// copies what is still in the write-ahead log too), copy it, and run this on the
// copy: never on the live database.
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { open } from "../src/lib/escrow.ts";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1] ?? "");
const dbPath = args.get("db");
const keyPath = args.get("key");
const question = Number(args.get("question"));
const reason = (args.get("reason") ?? "").trim();
if (!dbPath || !keyPath || !Number.isInteger(question) || question < 1 || reason.length < 10) {
  console.error('usage: node scripts/reveal.ts --db <file> --key <private key file> --question <id> --reason "<why, at least 10 characters>"');
  process.exit(1);
}

const db = new Database(dbPath);
const row = db
  .prepare("SELECT q.body AS body, s.envelope AS envelope FROM questions q JOIN sealed_authors s ON s.question_id = q.id WHERE q.id = ?")
  .get(question) as { body: string; envelope: string } | undefined;
if (!row) {
  console.error(`question ${question} has no sealed author (asked before sealing began, or no such question)`);
  process.exit(1);
}
// on record before anything is shown
db.prepare("INSERT INTO reveals (question_id, at, reason) VALUES (?, ?, ?)").run(question, Date.now(), reason);
const author = open(row.envelope, question, readFileSync(keyPath, "utf8"), row.body);
const account = db.prepare("SELECT username FROM accounts WHERE id = ?").get(author.account) as { username: string } | undefined;
console.log(
  JSON.stringify({ question, session: author.session, asked: new Date(author.at).toISOString(), account: author.account, username: account?.username ?? null }, null, 2),
);
