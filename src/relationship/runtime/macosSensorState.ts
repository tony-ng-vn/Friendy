/**
 * On-disk coordination files shared between the Node runtime and native sensor.
 *
 * The snapshot file records known Contacts identifiers; deleting it plus writing the
 * reset signal forces the sensor to treat the next poll as a fresh baseline (used after `start`).
 */
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Native sensor file listing known Contacts identifiers for snapshot-diff detection. */
export const MACOS_SENSOR_CONTACT_IDENTIFIER_SNAPSHOT = "contacts-identifier-snapshot.json";

/** Tells a live sensor process to drop its in-memory snapshot baseline on the next poll. */
export const MACOS_SENSOR_RESET_CONTACT_SNAPSHOT_SIGNAL = "reset-contact-snapshot.signal";

/** Whether the snapshot file existed and was removed before the reset signal was written. */
export type MacosSensorContactSnapshotResetResult = {
  removedSnapshot: boolean;
  wroteSignal: boolean;
};

/**
 * Clears the on-disk snapshot and writes a signal file so a running sensor re-baselines
 * on its next poll. Call when the user texts `start`.
 */
export function requestMacosSensorContactSnapshotReset(sensorStateDir: string): MacosSensorContactSnapshotResetResult {
  mkdirSync(sensorStateDir, { recursive: true });
  const snapshotPath = join(sensorStateDir, MACOS_SENSOR_CONTACT_IDENTIFIER_SNAPSHOT);
  const signalPath = join(sensorStateDir, MACOS_SENSOR_RESET_CONTACT_SNAPSHOT_SIGNAL);
  writeFileSync(signalPath, `${Date.now()}\n`, "utf8");

  if (!existsSync(snapshotPath)) {
    return { removedSnapshot: false, wroteSignal: true };
  }

  unlinkSync(snapshotPath);
  return { removedSnapshot: true, wroteSignal: true };
}
