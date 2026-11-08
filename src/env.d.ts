declare namespace App {
  interface Locals {
    /** The signed-in account id, or this browser's id: never sent back in a page. */
    person: string;
    /** The original browser cookie, retained to claim sessions started before sign-in. */
    browser: string;
    /** Only the owner is shown this username. */
    account: import("./lib/accounts.ts").Account | null;
    /** Log one thing this person did (src/lib/log.ts). The line gets this request's id and the person's tag. */
    log: (what: string, fields?: import("./lib/log.ts").Fields) => void;
  }
}
