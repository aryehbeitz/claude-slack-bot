/** Detect questions in Claude's response and extract them for interactive buttons */

export interface DetectedQuestion {
  num: number;
  /** Full question text for display */
  fullText: string;
}

/**
 * Parse Claude's response for numbered questions.
 */
export function detectQuestions(text: string): DetectedQuestion[] {
  const questions: DetectedQuestion[] = [];

  const lines = text.split('\n');
  let bulletNum = 0;

  for (const line of lines) {
    // Match numbered: "1. Should I refactor both?"
    // Match numbered: "1. **Scope** — Do you want to..."
    const numMatch = line.match(/^\s*(\d+)\.\s+(.+?\?)\s*$/);
    if (numMatch) {
      questions.push({
        num: parseInt(numMatch[1]),
        fullText: numMatch[2].trim(),
      });
      continue;
    }

    // Match bullet points: "- Consolidate the scattered maps into...?"
    const bulletMatch = line.match(/^\s*[-*]\s+(.+?\?)\s*$/);
    if (bulletMatch) {
      bulletNum++;
      questions.push({
        num: bulletNum,
        fullText: bulletMatch[1].trim(),
      });
    }
  }

  return questions;
}

/**
 * Build Slack blocks: full question text above, numbered buttons below.
 */
export function buildQuestionBlocks(
  questions: DetectedQuestion[],
  threadKey: string
): { blocks: any[]; answerMap: Map<string, string> } {
  const blocks: any[] = [];
  const answerMap = new Map<string, string>();

  // Full question text
  const questionList = questions
    .map(q => `*${q.num}.* ${q.fullText}`)
    .join('\n');

  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: questionList.slice(0, 3000) },
  });

  // "Yes to all" + numbered buttons
  const allYesId = `qa_${threadKey}_all`;
  answerMap.set(allYesId, questions.map(q => `${q.num}. Yes`).join('\n'));

  const buttons: any[] = [
    {
      type: 'button',
      text: { type: 'plain_text', text: 'Yes to all' },
      style: 'primary',
      action_id: allYesId,
      value: 'yes_all',
    },
  ];

  // Numbered buttons: "1", "2", "3", etc.
  for (const q of questions.slice(0, 4)) {
    const actionId = `qa_${threadKey}_${q.num}`;
    answerMap.set(actionId, `${q.num}. Yes`);
    buttons.push({
      type: 'button',
      text: { type: 'plain_text', text: `${q.num}. Yes` },
      action_id: actionId,
      value: `${q.num}_yes`,
    });
  }

  blocks.push({ type: 'actions', elements: buttons });

  // Second row if needed
  if (questions.length > 4) {
    const moreButtons: any[] = [];
    for (const q of questions.slice(4, 9)) {
      const actionId = `qa_${threadKey}_${q.num}`;
      answerMap.set(actionId, `${q.num}. Yes`);
      moreButtons.push({
        type: 'button',
        text: { type: 'plain_text', text: `${q.num}. Yes` },
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
    elements: [{ type: 'mrkdwn', text: '_Or type your own answer in the thread_' }],
  });

  return { blocks, answerMap };
}
