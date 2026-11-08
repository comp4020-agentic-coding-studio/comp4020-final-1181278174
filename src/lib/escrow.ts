import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
} from "node:crypto";

// Who asked a question, sealed so that the app can write it and cannot read it
// back. The app holds only the auditor's public key; the private key that opens
// a sealed author is kept off the server by the auditor (scripts/audit-keys.ts
// makes the pair, scripts/reveal.ts opens one question at a time, with a
// reason). This file needs nothing but node:crypto, so the reveal script can
// use it without opening the app's database.
//
// The seal: a fresh X25519 key pair for every question, a shared secret with
// the auditor's public key, HKDF-SHA256 to an AES-256-GCM key. The question's
// id is bound in as associated data, so an envelope can't be moved to another
// question, and the sealed text holds a digest of the question's words, so it
// can't be passed off as the author of different words.

/** Which public key sealed an envelope, so the key can be changed later. */
export const AUDIT_KEY_VERSION = 1;
/** The auditor's public key (X25519, SPKI DER, base64). Public: it can only seal. */
export const AUDIT_PUBLIC_KEY = "MCowBQYDK2VuAyEAMROvM/a0oPHLUzTvCC8j2VomYYBRLv7a3Px3/UPzIGI=";

const INFO = "hands-up sealed author v1";

/** What a sealed envelope holds. */
export type Author = {
  /** the account that asked */
  account: string;
  question: number;
  /** the session's code */
  session: string;
  /** SHA-256 of the question's words, hex */
  body: string;
  /** when it was asked, ms since 1970 */
  at: number;
};

type Envelope = { v: 1; epk: string; iv: string; ct: string; tag: string };

const digest = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");
const aad = (question: number): Buffer => Buffer.from(`question:${question}`, "utf8");

function keyFor(shared: Buffer, epk: Buffer, recipient: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", shared, Buffer.concat([epk, recipient]), INFO, 32));
}

/** Seal who asked question `question`, with these words, to the auditor's public key. */
export function seal(
  who: { account: string; question: number; session: string; body: string; at: number },
  publicKey: string = AUDIT_PUBLIC_KEY,
): string {
  const recipientDer = Buffer.from(publicKey, "base64");
  const recipient = createPublicKey({ key: recipientDer, format: "der", type: "spki" });
  const ephemeral = generateKeyPairSync("x25519");
  const epk = ephemeral.publicKey.export({ format: "der", type: "spki" });
  const shared = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: recipient });
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFor(shared, epk, recipientDer), iv);
  cipher.setAAD(aad(who.question));
  const author: Author = { account: who.account, question: who.question, session: who.session, body: digest(who.body), at: who.at };
  const ct = Buffer.concat([cipher.update(JSON.stringify(author), "utf8"), cipher.final()]);
  const envelope: Envelope = {
    v: 1,
    epk: epk.toString("base64"),
    iv: iv.toString("base64"),
    ct: ct.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
  return JSON.stringify(envelope);
}

/**
 * Open a sealed author with the auditor's private key (PEM, PKCS#8). Throws if
 * the key is the wrong one, the envelope was changed, or it was made for
 * another question. `words`, when given, must be the question's words.
 */
export function open(envelope: string, question: number, privateKeyPem: string, words?: string): Author {
  const sealed = JSON.parse(envelope) as Envelope;
  if (sealed.v !== 1) throw new Error(`unknown envelope version ${String(sealed.v)}`);
  const privateKey = createPrivateKey({ key: privateKeyPem, format: "pem" });
  const recipientDer = createPublicKey(privateKey).export({ format: "der", type: "spki" });
  const epk = Buffer.from(sealed.epk, "base64");
  const shared = diffieHellman({ privateKey, publicKey: createPublicKey({ key: epk, format: "der", type: "spki" }) });
  const iv = Buffer.from(sealed.iv, "base64");
  const tag = Buffer.from(sealed.tag, "base64");
  // a shortened tag would make a changed envelope easier to pass off
  if (iv.length !== 12 || tag.length !== 16) throw new Error("this envelope's lengths are wrong");
  const decipher = createDecipheriv("aes-256-gcm", keyFor(shared, epk, recipientDer), iv, { authTagLength: 16 });
  decipher.setAAD(aad(question));
  decipher.setAuthTag(tag);
  const author = JSON.parse(
    Buffer.concat([decipher.update(Buffer.from(sealed.ct, "base64")), decipher.final()]).toString("utf8"),
  ) as Author;
  if (author.question !== question) throw new Error("this envelope belongs to another question");
  if (words !== undefined && author.body !== digest(words)) throw new Error("the question's words are not the ones that were sealed");
  return author;
}

/** A new auditor key pair: the public key to put in this file, the private key to keep off the server. */
export function newAuditKeys(): { publicKey: string; privateKeyPem: string } {
  const pair = generateKeyPairSync("x25519");
  return {
    publicKey: pair.publicKey.export({ format: "der", type: "spki" }).toString("base64"),
    privateKeyPem: String(pair.privateKey.export({ format: "pem", type: "pkcs8" })),
  };
}
