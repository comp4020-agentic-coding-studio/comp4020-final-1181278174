declare namespace App {
  interface Locals {
    /** This browser's id (src/middleware.ts): never sent back in a page. */
    person: string;
    /** Log one thing this person did (src/lib/log.ts). The line gets this request's id and the person's tag. */
    log: (what: string, fields?: import("./lib/log.ts").Fields) => void;
  }
}
