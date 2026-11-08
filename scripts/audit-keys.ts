// Make the auditor's key pair, once. The private key is written to the file
// given, readable only by you; it must never enter the repo, the image or the
// server. The public key is printed: it goes in AUDIT_PUBLIC_KEY in
// src/lib/escrow.ts, and AUDIT_KEY_VERSION goes up by one if it replaces a key.
//
//   node scripts/audit-keys.ts ~/hands-up-audit-private-key.pem
import { existsSync, writeFileSync } from "node:fs";
import { newAuditKeys } from "../src/lib/escrow.ts";

const path = process.argv[2];
if (!path) {
  console.error("usage: node scripts/audit-keys.ts <file to write the private key to>");
  process.exit(1);
}
if (existsSync(path)) {
  console.error(`${path} already exists: not writing over a key`);
  process.exit(1);
}
const { publicKey, privateKeyPem } = newAuditKeys();
writeFileSync(path, privateKeyPem, { mode: 0o600 });
console.log(publicKey);
