/** Detect questions in Claude's response and extract them for interactive buttons */

export interface DetectedQuestion {
  /** The question number */
  num: number;
  /** Short label for the button */
  label: string;
  /** Full question text */
  fullText: string;
}

/**
 * Parse Claude's response for numbered questions.
 * Returns detected questions that can be turned into Slack buttons.
 */
export function detectQuestions(text: string): DetectedQuestion[] {
  const questions: DetectedQuestion[] = [];

  // Match numbered questions like:
  // "1. Should I refactor both?"
  // "1. **Scope** — Do you want to refactor both implementations?"
  // "2. **Deduplication** — Would you like me to extract shared logic?"
  const lines = text.split('\n');
  for (const line of lines) {
    const match = line.match(/^\s*(\d+)\.\s+(?:\*{1,2}([^*]+)\*{1,2}\s*[-—:]\s*)?(.+?\?)\s*$/);
    if (match) {
      const num = parseInt(match[1]);
      const label = match[2]?.trim() || '';
      const questionText = match[3].trim();
      const shortLabel = label || questionText.slice(0, 50);

      questions.push({
        num,
        label: shortLabel,
        fullText: label ? `*${label}* — ${questionText}` : questionText,
      });
    }
  }

  return questions;
}

/**
 * Build Slack blocks for interactive question buttons.
 * Shows the full question text above the buttons.
 */
export function buildQuestionBlocks(
  questions: DetectedQuestion[],
  threadKey: string
): { blocks: any[]; answerMap: Map<string, string> } {
  const blocks: any[] = [];
  const answerMap = new Map<string, string>();

  // Show full question text above buttons
  const questionList = questions
    .map(q => `${q.num}. ${q.fullText}`)
    .join('\n');

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: questionList.slice(0, 3000),
    },
  });

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

  // Per-question buttons
  for (const q of questions.slice(0, 4)) {
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

  // Second row if more than 4 questions
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

  blocks.push({
    type: 'context',
    elements: [
      { type: 'mrkdwn', text: '_Or type your own answer in the thread_' },
    ],
  });

  return { blocks, answerMap };
}
