import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

import { MigrationInputError } from './errors.js';
import type { JsonObject, JsonValue, V1LibrarySnapshot } from './types.js';
import { assertSafeEmulatorEnvironment } from './write.js';

const outputPath = path.resolve('.local-data/v1-export/library.json');

function tagged(type: string, value: JsonValue): JsonObject {
  return { $firestoreType: type, value };
}

function toPortableJson(value: unknown, fieldPath: string): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Timestamp) return tagged('timestamp', value.toDate().toISOString());
  if (value instanceof Date) return tagged('timestamp', value.toISOString());
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return tagged('bytes', Buffer.from(value).toString('base64'));
  }
  if (Array.isArray(value)) return value.map((item, index) => toPortableJson(item, `${fieldPath}[${index}]`));
  if (typeof value === 'object') {
    const constructorName = value.constructor?.name;
    if (constructorName === 'GeoPoint') {
      const point = value as { latitude: number; longitude: number };
      return tagged('geopoint', { latitude: point.latitude, longitude: point.longitude });
    }
    if (constructorName === 'DocumentReference') {
      const reference = value as { path: string };
      return tagged('reference', reference.path);
    }
    if (constructorName !== 'Object' && constructorName !== undefined) {
      throw new MigrationInputError(`Unsupported Firestore value at ${fieldPath}: ${constructorName}.`);
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, toPortableJson(nested, `${fieldPath}.${key}`)]),
    );
  }
  throw new MigrationInputError(`Unsupported Firestore value at ${fieldPath}: ${typeof value}.`);
}

async function extractLibrary(): Promise<void> {
  const { projectId } = assertSafeEmulatorEnvironment();
  const app = initializeApp({ projectId }, `migration-v1-extract-${Date.now()}`);
  try {
    const snapshot = await getFirestore(app).collection('library').get();
    const output: V1LibrarySnapshot = {
      schemaVersion: 1,
      collection: 'library',
      documents: snapshot.docs.map((document) => ({
        id: document.id,
        data: toPortableJson(document.data(), `library/${document.id}`) as JsonObject,
      })),
    };
    await mkdir(path.dirname(outputPath), { recursive: true });
    const temporaryPath = `${outputPath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(output, null, 2)}\n`, { encoding: 'utf8', flag: 'w' });
    await rename(temporaryPath, outputPath);
    console.log(`Extracted ${output.documents.length} library documents to .local-data/v1-export/library.json.`);
  } finally {
    await deleteApp(app);
  }
}

void extractLibrary().catch((error: unknown) => {
  const name = error instanceof Error ? error.name : 'Error';
  const message = error instanceof Error ? error.message : 'Unknown extraction failure.';
  console.error(JSON.stringify({ status: 'FAILED', error: name, message }, null, 2));
  process.exitCode = 1;
});
