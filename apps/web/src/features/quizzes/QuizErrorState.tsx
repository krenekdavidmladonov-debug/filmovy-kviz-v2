import { HumanError } from '../../ui/HumanError';

interface QuizErrorStateProps {
  readonly message: string;
  readonly onRetry?: () => void;
}

export function QuizErrorState({ message, onRetry }: QuizErrorStateProps) {
  return (
    <HumanError
      error={{ title: 'Obsah nelze zobrazit', message }}
      onRetry={onRetry}
    />
  );
}
