import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp, type WriteBatch } from 'firebase-admin/firestore';

interface SeedQuestion {
  readonly id: string;
  readonly type: 'text' | 'image' | 'audio';
  readonly prompt: string;
  readonly correctAnswer: string;
  readonly position: number;
}

interface SeedRound {
  readonly id: string;
  readonly title: string;
  readonly type: 'classic' | 'picture' | 'audio';
  readonly position: number;
  readonly questions: readonly SeedQuestion[];
}

interface SeedQuiz {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly status: 'draft' | 'ready' | 'archived';
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly rounds: readonly SeedRound[];
}

const seedActor = 'emulator-seed';

const quizzes: readonly SeedQuiz[] = [
  {
    id: 'filmovy-kviz-1',
    title: 'Filmový kvíz #1',
    description: 'Pestrý úvodní kvíz z českých i světových filmů.',
    status: 'ready',
    createdAt: new Date('2026-01-10T18:00:00.000Z'),
    updatedAt: new Date('2026-08-22T16:30:00.000Z'),
    rounds: [
      {
        id: 'klasika',
        title: 'Filmová klasika',
        type: 'classic',
        position: 1,
        questions: [
          { id: 'taxikar', type: 'text', prompt: 'Kdo režíroval film Taxikář z roku 1976?', correctAnswer: 'Martin Scorsese', position: 1 },
          { id: 'oscar', type: 'text', prompt: 'Který film získal Oscara za nejlepší film za rok 1994?', correctAnswer: 'Forrest Gump', position: 2 },
        ],
      },
      {
        id: 'obrazky',
        title: 'Poznej film podle záběru',
        type: 'picture',
        position: 2,
        questions: [
          { id: 'hotel', type: 'image', prompt: 'Ze kterého filmu pochází tento hotelový záběr?', correctAnswer: 'Osvícení', position: 1 },
          { id: 'vesmir', type: 'image', prompt: 'Poznejte sci-fi film podle záběru z vesmíru.', correctAnswer: 'Interstellar', position: 2 },
        ],
      },
    ],
  },
  {
    id: 'harry-potter-special',
    title: 'Harry Potter speciál',
    description: 'Tematický večer pro znalce kouzelnického světa.',
    status: 'draft',
    createdAt: new Date('2026-04-02T12:00:00.000Z'),
    updatedAt: new Date('2026-08-28T19:45:00.000Z'),
    rounds: [
      {
        id: 'bradavice',
        title: 'Bradavice',
        type: 'classic',
        position: 1,
        questions: [
          { id: 'kolej', type: 'text', prompt: 'Do které koleje patřila Lenka Láskorádová?', correctAnswer: 'Havraspár', position: 1 },
          { id: 'reditel', type: 'text', prompt: 'Jaké je celé jméno ředitele Brumbála?', correctAnswer: 'Albus Percival Wulfric Brian Brumbál', position: 2 },
          { id: 'patron', type: 'text', prompt: 'Jakou podobu má patron Severuse Snapea?', correctAnswer: 'Laň', position: 3 },
        ],
      },
      {
        id: 'hudba',
        title: 'Hudba a zvuky',
        type: 'audio',
        position: 2,
        questions: [
          { id: 'skladatel', type: 'audio', prompt: 'Kdo složil hlavní hudební motiv prvních filmů?', correctAnswer: 'John Williams', position: 1 },
        ],
      },
    ],
  },
  {
    id: 'vanocni-filmovy-kviz',
    title: 'Vánoční filmový kvíz',
    description: 'Sváteční klasiky, pohádky a filmy, které patří k prosinci.',
    status: 'archived',
    createdAt: new Date('2025-10-15T09:00:00.000Z'),
    updatedAt: new Date('2026-01-05T11:20:00.000Z'),
    rounds: [
      {
        id: 'vanoce-ve-filmu',
        title: 'Vánoce ve filmu',
        type: 'classic',
        position: 1,
        questions: [
          { id: 'sam-doma', type: 'text', prompt: 'Do kterého města odletí Kevinova rodina ve filmu Sám doma?', correctAnswer: 'Paříž', position: 1 },
          { id: 'laska-nebeska', type: 'text', prompt: 'Na kterém letišti začíná a končí film Láska nebeská?', correctAnswer: 'Heathrow', position: 2 },
        ],
      },
    ],
  },
];

function assertSafeEmulatorEnvironment(): string {
  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
  const projectId = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT;

  if (emulatorHost !== '127.0.0.1:8080' && emulatorHost !== 'localhost:8080') {
    throw new Error('Refusing to seed: FIRESTORE_EMULATOR_HOST must point to local port 8080.');
  }

  if (!projectId?.startsWith('demo-')) {
    throw new Error('Refusing to seed: the Firebase project ID must start with demo-.');
  }

  return projectId;
}

function writeQuiz(batch: WriteBatch, quiz: SeedQuiz): void {
  const db = getFirestore();
  const quizRef = db.collection('quizzes').doc(quiz.id);
  const questionCount = quiz.rounds.reduce((total, round) => total + round.questions.length, 0);

  batch.set(quizRef, {
    title: quiz.title,
    description: quiz.description,
    status: quiz.status,
    createdAt: Timestamp.fromDate(quiz.createdAt),
    updatedAt: Timestamp.fromDate(quiz.updatedAt),
    createdBy: seedActor,
    updatedBy: seedActor,
    roundCount: quiz.rounds.length,
    questionCount,
  });

  for (const round of quiz.rounds) {
    const roundRef = quizRef.collection('rounds').doc(round.id);
    batch.set(roundRef, {
      title: round.title,
      type: round.type,
      position: round.position,
      questionCount: round.questions.length,
    });

    for (const question of round.questions) {
      batch.set(roundRef.collection('questions').doc(question.id), {
        type: question.type,
        prompt: question.prompt,
        correctAnswer: question.correctAnswer,
        position: question.position,
      });
    }
  }
}

async function seed(): Promise<void> {
  const projectId = assertSafeEmulatorEnvironment();
  const app = initializeApp({ projectId });

  try {
    const batch = getFirestore().batch();
    for (const quiz of quizzes) {
      writeQuiz(batch, quiz);
    }
    await batch.commit();
    console.log(`Seeded ${quizzes.length} emulator-only quizzes into ${projectId}.`);
  } finally {
    await deleteApp(app);
  }
}

void seed().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
