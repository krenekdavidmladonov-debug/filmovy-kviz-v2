import { FirebaseError } from 'firebase/app';

const messages: Readonly<Record<string, string>> = {
  'auth/invalid-credential': 'E-mail nebo heslo není správné.',
  'auth/invalid-email': 'Zadejte platnou e-mailovou adresu.',
  'auth/missing-password': 'Zadejte heslo.',
  'auth/too-many-requests': 'Příliš mnoho pokusů. Chvíli počkejte a zkuste to znovu.',
  'auth/network-request-failed': 'Přihlášení se nemůže spojit s Authentication Emulatorem.',
  'auth/user-disabled': 'Tento účet je deaktivovaný.',
};

export function getCzechAuthError(error: unknown): string {
  if (error instanceof FirebaseError) {
    return messages[error.code] ?? 'Přihlášení se nezdařilo. Zkontrolujte údaje a zkuste to znovu.';
  }

  return 'Přihlášení se nezdařilo. Zkuste to znovu.';
}
