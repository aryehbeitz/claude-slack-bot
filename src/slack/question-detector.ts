/** Detect questions in Claude's response and extract them for interactive buttons */

export interface DetectedQuestion {
  /** The question number */
  num: number;
  /** Short label for the question */
  label: string;
  /** Suggested quick-reply options */
  options: string[];
}

/**
 * Parse Claude's response for numbered questions.
 * Returns detected questions that can be turned into Slack buttons.
 */
export function detectQuestions(text: string): DetectedQuestion[] {
  const questions: DetectedQuestion[] = [];

  // Match numbered questions like:
  // "1. Should I refactor both?"
  // "1. **Scope** — Do you want to..."
  // "2. **Deduplication** — Would you like..."
  const lines = text.split('\n');
  for (const line of lines) {
    const match = line.match(/^\s*(\d+)\.\s+(?:\*{1,2}([^*]+)\*{1,2}\s*[-—:]\s*)?(.+?\?)\s*$/);
    if (match) {
      const num = parseInt(match[1]);
      const label = match[2]?.trim() || '';
      const questionText = match[3].trim();

      // Extract short label from the question
      const shortLabel = label || questionText.slice(0, 50);

      questions.push({
        num,
        label: shortLabel,
        options: ['Yes', 'No'],
      });
    }
  }

  return questions;
}

/**
 * Build Slack blocks for interactive question buttons.
 */
export function buildQuestionBlocks(
  questions: DetectedQuestion[],
  threadKey: string
): { blocks: any[]; answerMap: Map<string, string> } {
  const blocks: any[] = [];
  const answerMap = new Map<string, string>();

  // "Yes to all" button
  const allYesId = `qa_${threadKey}_all`;
  const allYesAnswer = questions.map(q => `${q.num}. Yes`).join('\n');
  answerMap.set(allYesId, allYesAnswer);

  const topButtons: any[] = [
    {
      type: 'button',
      text: { type: 'plain_text', text: 'Yes to all' },
      style: 'primary',
      action_id: allYesId,
      value: 'yes_all',
    },
  ];

  // Per-question buttons with the question label
  for (const q of questions.slice(0, 4)) { // Max 4 + "Yes to all" = 5 buttons
    const actionId = `qa_${threadKey}_${q.num}`;
    answerMap.set(actionId, `${q.num}. Yes — ${q.label}`);
    topButtons.push({
      type: 'button',
      text: { type: 'plain_text', text: `${q.num}. ${q.label}`.slice(0, 75) },
      action_id: actionId,
      value: `${q.num}_yes`,
    });
  }

  blocks.push({ type: 'actions', elements: topButtons });

  // If more than 4 questions, add a second row
  if (questions.length > 4) {
    const moreButtons: any[] = [];
    for (const q of questions.slice(4, 9)) {
      const actionId = `qa_${threadKey}_${q.num}`;
      answerMap.set(actionId, `${q.num}. Yes — ${q.label}`);
      moreButtons.push({
        type: 'button',
        text: { type: 'plain_text', text: `${q.num}. ${q.label}`.slice(0, 75) },
        action_id: actionId,
        value: `${q.num}_yes`,
      });
    }
    if (moreButtons.length > 0) {
      blocks.push({ type: 'actions', elements: moreButtons });
    }
  }

  return { blocks, answerMap };
}
