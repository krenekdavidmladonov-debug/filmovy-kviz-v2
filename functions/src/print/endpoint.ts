import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onRequest } from 'firebase-functions/v2/https';
import { PrintCenterError } from './errors.js';
import { PRINT_LIMITS } from './limits.js';
import { renderPrintArtifact } from './renderer.js';
import { mapSnapshotToPrintEvent } from './snapshot-mapper.js';
import { registrationToPrintTeam } from '../registrations/print-adapter.js';
import type { PrintLogMetadata, PrintOptions, PrintRequestOptions, PrintTeam } from './types.js';
import { authorizePrintArtifact, parsePrintRequestOptions } from './validation.js';

if (getApps().length === 0) initializeApp();

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PrintCenterError(422, 'malformed-data', 'Data pro tisk nejsou platná.');
  }
  return value as Record<string, unknown>;
}

function bearerToken(header: string | undefined): string {
  const match = /^Bearer ([^\s]+)$/u.exec(header ?? '');
  if (!match?.[1]) throw new PrintCenterError(401, 'unauthenticated', 'Přihlášení je vyžadováno.');
  return match[1];
}

function eventIdFromBody(body: unknown): string {
  const data = record(body);
  if (typeof data.eventId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(data.eventId)) {
    throw new PrintCenterError(400, 'invalid-event', 'Neplatná akce.');
  }
  return data.eventId;
}

function optionsFromBody(body: unknown): unknown {
  const data = record(body);
  const keys = Object.keys(data);
  if (keys.some((key) => key !== 'eventId' && key !== 'options')) {
    throw new PrintCenterError(400, 'invalid-request', 'Požadavek obsahuje nepovolená pole.');
  }
  return data.options;
}

async function acceptedTeams(eventId: string): Promise<PrintTeam[]> {
  const snapshot = await getFirestore().collection('events').doc(eventId)
    .collection('registrations').orderBy('createdAt').limit(501).get();
  const teams = snapshot.docs.flatMap((document) => {
    const team = registrationToPrintTeam(document.id, record(document.data()));
    return team === undefined ? [] : [team];
  });
  if (teams.length > PRINT_LIMITS.teams) {
    throw new PrintCenterError(409, 'team-limit', `PDF podporuje nejvýše ${PRINT_LIMITS.teams} přijatých týmů.`);
  }
  return teams;
}

async function resolvePrintOptions(eventId: string, request: PrintRequestOptions): Promise<PrintOptions> {
  if (request.artifactType === 'answer-key') return request;
  if (request.artifactType === 'team-sheets' && request.mode === 'generic') {
    return { ...request, teams: [] };
  }
  if (request.artifactType === 'team-sheets' && request.mode === 'single') {
    const snapshot = await getFirestore().collection('events').doc(eventId)
      .collection('registrations').doc(request.teamId).get();
    const team = snapshot.exists ? registrationToPrintTeam(snapshot.id, record(snapshot.data())) : undefined;
    if (team === undefined) throw new PrintCenterError(404, 'team-not-found', 'Přijatý tým nebyl nalezen.');
    return { artifactType: 'team-sheets', disposition: request.disposition, mode: 'single', teams: [team] };
  }
  const teams = await acceptedTeams(eventId);
  if (teams.length === 0) throw new PrintCenterError(409, 'missing-teams', 'Akce zatím nemá žádné přijaté týmy.');
  return request.artifactType === 'score-table'
    ? { ...request, teams }
    : { ...request, teams };
}

export const generatePrintArtifact = onRequest(
  {
    region: 'europe-west1',
    cors: true,
    timeoutSeconds: 30,
    memory: '512MiB',
    maxInstances: 10,
  },
  async (request, response) => {
    const startedAt = Date.now();
    try {
      if (request.method !== 'POST') {
        response.set('Allow', 'POST').status(405).json({ code: 'method-not-allowed', message: 'Použijte POST.' });
        return;
      }
      if (!request.is('application/json')) {
        throw new PrintCenterError(415, 'unsupported-media-type', 'Požadavek musí být JSON.');
      }
      if (request.rawBody.byteLength > PRINT_LIMITS.requestBytes) {
        throw new PrintCenterError(413, 'request-limit', 'Požadavek je příliš velký.');
      }

      const eventId = eventIdFromBody(request.body);
      const requestedOptions = parsePrintRequestOptions(optionsFromBody(request.body));
      const token = await getAuth().verifyIdToken(bearerToken(request.header('authorization')));
      authorizePrintArtifact(token.role, requestedOptions.artifactType);
      const options = await resolvePrintOptions(eventId, requestedOptions);

      const db = getFirestore();
      const eventSnapshot = await db.collection('events').doc(eventId).get();
      if (!eventSnapshot.exists) throw new PrintCenterError(404, 'event-not-found', 'Akce nebyla nalezena.');
      const eventData = record(eventSnapshot.data());
      const assignmentValue = eventData.quizAssignment;
      if (typeof assignmentValue !== 'object' || assignmentValue === null || Array.isArray(assignmentValue)) {
        throw new PrintCenterError(409, 'event-not-locked', 'Nejdříve uzamkněte kvíz pro tuto akci. Potom bude možné připravit tiskové dokumenty.');
      }
      const assignment = assignmentValue as Record<string, unknown>;
      if (typeof assignment.snapshotId !== 'string' || assignment.snapshotId.length === 0) {
        throw new PrintCenterError(409, 'event-not-locked', 'Nejdříve uzamkněte kvíz pro tuto akci. Potom bude možné připravit tiskové dokumenty.');
      }

      const snapshotRef = db.collection('quizSnapshots').doc(assignment.snapshotId);
      const [snapshot, rounds, slides] = await Promise.all([
        snapshotRef.get(),
        snapshotRef.collection('rounds').orderBy('position').limit(PRINT_LIMITS.rounds + 1).get(),
        snapshotRef.collection('slides').orderBy('position').limit(PRINT_LIMITS.slides + 1).get(),
      ]);
      if (!snapshot.exists) throw new PrintCenterError(409, 'snapshot-missing', 'Uzamčený snapshot kvízu nebyl nalezen.');

      const printEvent = mapSnapshotToPrintEvent(
        eventData,
        record(snapshot.data()),
        rounds.docs.map((document) => ({ id: document.id, data: record(document.data()) })),
        slides.docs.map((document) => ({ id: document.id, data: record(document.data()) })),
      );
      const artifact = await renderPrintArtifact(printEvent, options);
      const questionCount = printEvent.quiz.rounds.reduce((total, round) => total + round.questions.length, 0);
      const metadata: PrintLogMetadata = {
        artifactType: options.artifactType,
        roundCount: printEvent.quiz.rounds.length,
        questionCount,
        teamCount: 'teams' in options ? options.teams.length : 0,
        pageCount: artifact.pageCount,
        generationDurationMs: Date.now() - startedAt,
      };
      logger.info('print_artifact_generated', metadata);

      response.set({
        'Content-Type': 'application/pdf',
        'Cache-Control': 'no-store',
        'Content-Disposition': `${options.disposition}; filename="${artifact.filename}"`,
        'Content-Length': artifact.bytes.byteLength.toString(),
        'Access-Control-Expose-Headers': 'Content-Disposition, Content-Length',
        'X-Content-Type-Options': 'nosniff',
      });
      response.status(200).send(Buffer.from(artifact.bytes));
    } catch (error: unknown) {
      if (error instanceof PrintCenterError) {
        response.status(error.status).json({ code: error.code, message: error.message });
        return;
      }
      logger.error('print_artifact_failed', {
        generationDurationMs: Date.now() - startedAt,
        errorType: error instanceof Error ? error.name : 'unknown',
      });
      response.status(500).json({ code: 'internal', message: 'PDF se nepodařilo vytvořit. Zkuste to znovu.' });
    }
  },
);
