/** Detect questions in Claude's response and extract them for interactive buttons */

export interface DetectedQuestion {
  /** The full question text */
  text: string;
  /** Suggested quick-reply options */
  options: string[];
}

/**
 * Parse Claude's response for numbered questions or yes/no questions.
 * Returns detected questions that can be turned into Slack buttons.
 */
export function detectQuestions(text: string): DetectedQuestion[] {
  const questions: DetectedQuestion[] = [];

  // Detect numbered questions like "1. Should I refactor both?" or "1. **Scope** — ..."
  const numberedPattern = /^\s*(\d+)\.\s+\*{0,2}[^*]*?\*{0,2}\s*[-—:]?\s*(.+?\?)/gm;
  let match;
  while ((match = numberedPattern.exec(text)) !== null) {
    const questionText = match[0].trim();
    // Try to extract inline options like "(a) foo (b) bar" or "option1 or option2"
    const options = extractOptions(questionText);
    questions.push({
      text: questionText,
      options: options.length > 0 ? options : ['Yes', 'No'],
    });
  }

  // If no numbered questions, check for standalone yes/no questions
  if (questions.length === 0) {
    const lines = text.split('\n');
    const lastLines = lines.slice(-5).join('\n');
    if (/\?\s*$/.test(lastLines.trim())) {
      // Check if it's clearly a yes/no question
      const yesNoPattern = /(?:should|would|do you|shall|can|want|is it|are you|could)\s+.+\?/i;
      if (yesNoPattern.test(lastLines)) {
        questions.push({
          text: lastLines.trim(),
          options: ['Yes', 'No'],
        });
      }
    }
  }

  return questions;
}

function extractOptions(text: string): string[] {
  // Match "X or Y" patterns
  const orMatch = text.match(/\b([\w\s]+)\s+or\s+([\w\s]+)\?/i);
  if (orMatch) {
    const opt1 = orMatch[1].trim();
    const opt2 = orMatch[2].trim();
    // Only use if they're short options
    if (opt1.length < 30 && opt2.length < 30) {
      return [opt1, opt2];
    }
  }
  return [];
}

/**
 * Build Slack blocks for interactive question buttons.
 * Returns blocks array and a map of action_id -> answer text.
 */
export function buildQuestionBlocks(
  questions: DetectedQuestion[],
  threadKey: string
): { blocks: any[]; answerMap: Map<string, string> } {
  const blocks: any[] = [];
  const answerMap = new Map<string, string>();

  // Add a header
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: ':speech_balloon: *Quick replies:*',
    },
  });

  if (questions.length === 1 && questions[0].options.length <= 5) {
    // Single question with a few options — show as buttons
    const elements = questions[0].options.map((opt, i) => {
      const actionId = `qa_${threadKey}_${i}`;
      answerMap.set(actionId, opt);
      return {
        type: 'button',
        text: { type: 'plain_text', text: opt.slice(0, 75) },
        action_id: actionId,
        value: opt,
      };
    });
    blocks.push({ type: 'actions', elements });
  } else {
    // Multiple questions — show numbered buttons for "all yes" + per-question
    const allYesId = `qa_${threadKey}_all_yes`;
    answerMap.set(allYesId, questions.map((_, i) => `${i + 1}. Yes`).join('\n'));

    const elements: any[] = [
      {
        type: 'button',
        text: { type: 'plain_text', text: 'Yes to all' },
        style: 'primary',
        action_id: allYesId,
        value: 'yes_all',
      },
    ];

    // Add individual numbered buttons for common answers
    for (let i = 0; i < Math.min(questions.length, 5); i++) {
      const q = questions[i];
      for (const opt of q.options.slice(0, 2)) {
        const actionId = `qa_${threadKey}_${i}_${opt.toLowerCase().replace(/\s+/g, '_')}`;
        answerMap.set(actionId, `${i + 1}. ${opt}`);
        // Only add "Yes" buttons for brevity
        if (opt === 'Yes') {
          elements.push({
            type: 'button',
            text: { type: 'plain_text', text: `${i + 1}. Yes` },
            action_id: actionId,
            value: `${i + 1}_yes`,
          });
        }
      }
    }

    blocks.push({ type: 'actions', elements: elements.slice(0, 5) }); // Slack max 5 buttons per block
  }

  return { blocks, answerMap };
}
