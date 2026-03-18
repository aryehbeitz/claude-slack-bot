/** Detect questions in Claude's response and extract them for interactive buttons */

export interface DetectedQuestion {
  num: number;
  fullText: string;
}

/**
 * Parse Claude's response for numbered or bullet-point questions.
 */
export function detectQuestions(text: string): DetectedQuestion[] {
  const questions: DetectedQuestion[] = [];
  const seen = new Set<string>();

  const lines = text.split('\n');
  let autoNum = 0;

  for (const line of lines) {
    let questionText: string | null = null;

    // Match numbered: "1. Should I refactor both?"
    const numMatch = line.match(/^\s*(\d+)\.\s+(.+?\?)\s*$/);
    if (numMatch) {
      questionText = numMatch[2].trim();
    }

    // Match bullet: "- Consolidate the scattered maps...?"
    if (!questionText) {
      const bulletMatch = line.match(/^\s*[-*]\s+(.+?\?)\s*$/);
      if (bulletMatch) {
        questionText = bulletMatch[1].trim();
      }
    }

    if (questionText && !seen.has(questionText)) {
      seen.add(questionText);
      autoNum++;
      questions.push({ num: autoNum, fullText: questionText });
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

  // "Yes to all" button
  const allYesId = `qa_${threadKey}_all`;
  answerMap.set(allYesId, questions.map(q => `${q.num}. Yes`).join('\n'));

  const allButtons: any[][] = [[]];
  allButtons[0].push({
    type: 'button',
    text: { type: 'plain_text', text: 'Yes to all' },
    style: 'primary',
    action_id: allYesId,
    value: 'yes_all',
  });

  // Numbered buttons, max 5 per row (Slack limit)
  for (const q of questions) {
    const actionId = `qa_${threadKey}_q${q.num}`;
    answerMap.set(actionId, `${q.num}. Yes`);

    const currentRow = allButtons[allButtons.length - 1];
    if (currentRow.length >= 5) {
      allButtons.push([]);
    }
    allButtons[allButtons.length - 1].push({
      type: 'button',
      text: { type: 'plain_text', text: `${q.num}. Yes` },
      action_id: actionId,
      value: `${q.num}_yes`,
    });
  }

  for (const row of allButtons) {
    if (row.length > 0) {
      blocks.push({ type: 'actions', elements: row });
    }
  }

  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: '_Or type your own answer in the thread_' }],
  });

  return { blocks, answerMap };
}
