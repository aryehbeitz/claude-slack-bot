const MAX_MESSAGE_LENGTH = 39000;

/** Convert basic markdown to Slack mrkdwn */
export function markdownToMrkdwn(text: string): string {
  return (
    text
      // Headers: # → *bold*
      .replace(/^### (.+)$/gm, '*$1*')
      .replace(/^## (.+)$/gm, '*$1*')
      .replace(/^# (.+)$/gm, '*$1*')
      // Bold: **text** → *text*
      .replace(/\*\*(.+?)\*\*/g, '*$1*')
      // Strikethrough is same: ~~text~~ → ~text~
      .replace(/~~(.+?)~~/g, '~$1~')
      // Links: [text](url) → <url|text>
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>')
  );
}

/** Chunk text to fit Slack message limits */
export function chunkText(text: string, maxLen = MAX_MESSAGE_LENGTH): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    // Try to break at newline
    let breakIdx = remaining.lastIndexOf('\n', maxLen);
    if (breakIdx < maxLen * 0.5) {
      // If no good newline break, break at space
      breakIdx = remaining.lastIndexOf(' ', maxLen);
    }
    if (breakIdx < maxLen * 0.3) {
      breakIdx = maxLen;
    }
    chunks.push(remaining.slice(0, breakIdx));
    remaining = remaining.slice(breakIdx);
  }

  return chunks;
}

/** Format a tool use event for display */
export function formatToolUse(
  toolName: string,
  input: Record<string, unknown>
): string {
  const icon = toolIcons[toolName] || ':gear:';
  let detail: string;

  switch (toolName) {
    case 'Bash':
    case 'bash':
      detail = `\`\`\`\n$ ${input.command || ''}\n\`\`\``;
      break;
    case 'Read':
    case 'read':
      detail = `\`${input.file_path || input.path || ''}\``;
      break;
    case 'Write':
    case 'write':
      detail = `\`${input.file_path || input.path || ''}\``;
      break;
    case 'Edit':
    case 'edit':
      detail = `\`${input.file_path || input.path || ''}\``;
      break;
    case 'Glob':
    case 'glob':
      detail = `Pattern: \`${input.pattern || ''}\``;
      break;
    case 'Grep':
    case 'grep':
      detail = `Pattern: \`${input.pattern || ''}\``;
      break;
    default:
      detail = `\`\`\`\n${JSON.stringify(input, null, 2).slice(0, 500)}\n\`\`\``;
  }

  return `${icon} *${toolName}*\n${detail}`;
}

/** Format tool result output */
export function formatToolResult(output: string, maxLen = 2000): string {
  if (!output) return '_No output_';
  const trimmed = output.length > maxLen ? output.slice(0, maxLen) + '\n...' : output;
  return `\`\`\`\n${trimmed}\n\`\`\``;
}

const toolIcons: Record<string, string> = {
  Bash: ':terminal:',
  bash: ':terminal:',
  Read: ':page_facing_up:',
  read: ':page_facing_up:',
  Write: ':pencil2:',
  write: ':pencil2:',
  Edit: ':pencil:',
  edit: ':pencil:',
  Glob: ':mag:',
  glob: ':mag:',
  Grep: ':mag_right:',
  grep: ':mag_right:',
  Agent: ':robot_face:',
  agent: ':robot_face:',
};
