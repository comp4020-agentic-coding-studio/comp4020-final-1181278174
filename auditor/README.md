# The auditor's private key, published for marking

`hands-up-audit-private-key.pem` opens the sealed author of a question
(`scripts/reveal.ts`). It is here so that a marker can try the auditor's side on
a local copy of the app. In real use it would stay with the auditor, off the
server and out of the repository; it is still kept out of the image
(`.dockerignore`), so the live server never has it.
