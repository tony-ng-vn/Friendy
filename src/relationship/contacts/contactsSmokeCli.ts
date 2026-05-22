/** CLI for `npm run ingest:contacts:smoke -- --name Friendy-<number>`. Exits 0 on success, 1 on failure. */
import { runContactsSmoke } from "./contactsSmoke";

const result = runContactsSmoke({ argv: process.argv.slice(2) });

if (result.name && result.phoneNumber) {
  console.log(`Contact: ${result.name}`);
  console.log(`Method: ${result.phoneNumber}`);
}
console.log(result.message);

process.exitCode = result.ok ? 0 : 1;
