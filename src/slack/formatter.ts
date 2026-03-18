const MAX_MESSAGE_LENGTH = 39000;

/** Convert basic markdown to Slack mrkdwn */
export function markdownToMrkdwn(text: string): string {
  // First convert tables before other transformations
  text = convertTables(text);

  return (
    text
      // Headers: # → *bold*
      .replace(/^#### (.+)$/gm, '*$1*')
      .replace(/^### (.+)$/gm, '*$1*')
      .replace(/^## (.+)$/gm, '*$1*')
      .replace(/^# (.+)$/gm, '*$1*')
      // Bold: **text** → *text*
      .replace(/\*\*(.+?)\*\*/g, '*$1*')
      // Strikethrough is same: ~~text~~ → ~text~
      .replace(/~~(.+?)~~/g, '~$1~')
      // Links: [text](url) → <url|text>
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>')
      // Horizontal rules
      .replace(/^---+$/gm, '---')
  );
}

/** Convert markdown tables to a readable Slack format */
function convertTables(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    // Detect table: line with | ... | followed by |---|---| separator
    if (
      lines[i]?.includes('|') &&
      i + 1 < lines.length &&
      /^\s*\|?\s*[-:]+[-|\s:]+\s*\|?\s*$/.test(lines[i + 1])
    ) {
      // Parse header
      const headers = parseTableRow(lines[i]);
      i += 2; // skip header + separator

      // Parse rows
      const rows: string[][] = [];
      while (i < lines.length && lines[i]?.includes('|')) {
        const cells = parseTableRow(lines[i]);
        if (cells.length === 0) break;
        rows.push(cells);
        i++;
      }

      // Format as key-value pairs per row
      if (headers.length > 0 && rows.length > 0) {
        for (const row of rows) {
          const parts: string[] = [];
          for (let c = 0; c < headers.length && c < row.length; c++) {
            if (row[c].trim()) {
              parts.push(`*${headers[c].trim()}:* ${row[c].trim()}`);
            }
          }
          result.push(parts.join('  '));
        }
        result.push(''); // blank line after table
      }
    } else {
      result.push(lines[i]);
      i++;
    }
  }

  return result.join('\n');
}

function parseTableRow(line: string): string[] {
  return line
    .split('|')
    .map(cell => cell.trim())
    .filter((cell, idx, arr) => {
      // Remove empty first/last cells from | delimiters
      if (idx === 0 && cell === '') return false;
      if (idx === arr.length - 1 && cell === '') return false;
      return true;
    });
}

/** Chunk text to fit Slack message limits, keeping code fences intact (#8) */
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
      breakIdx = remaining.lastIndexOf(' ', maxLen);
    }
    if (breakIdx < maxLen * 0.3) {
      breakIdx = maxLen;
    }

    const chunk = remaining.slice(0, breakIdx);
    // Count ``` fence markers at start of line — odd count means we're inside a fence
    const fenceCount = (chunk.match(/^```/gm) || []).length;
    if (fenceCount % 2 !== 0) {
      // Close the fence in this chunk and reopen in the next
      chunks.push(chunk + '\n```');
      remaining = '```\n' + remaining.slice(breakIdx);
    } else {
      chunks.push(chunk);
      remaining = remaining.slice(breakIdx);
    }
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
export function formatToolResult(output: string): string {
  if (!output) return '';
  const clean = output.trim();
  if (clean.length < 3) return '';
  return `\`\`\`\n${clean}\n\`\`\``;
}

const toolIcons: Record<string, string> = {
  Bash: ':computer:',
  bash: ':computer:',
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
  WebFetch: ':globe_with_meridians:',
  WebSearch: ':mag:',
};
