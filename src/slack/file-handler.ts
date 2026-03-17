import { WebClient } from '@slack/web-api';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const MAX_TEXT_INLINE = 10000;
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];

interface ProcessedFile {
  type: 'image' | 'text';
  name: string;
  path?: string;    // For images saved to disk
  content?: string;  // For text files inlined
}

export class FileHandler {
  private tmpDir: string;

  constructor(private slackClient: WebClient) {
    this.tmpDir = path.join(os.tmpdir(), 'claude-slack-bot');
    if (!fs.existsSync(this.tmpDir)) {
      fs.mkdirSync(this.tmpDir, { recursive: true });
    }
  }

  async processFiles(
    files: Array<{ id: string; name: string; url_private_download?: string; mimetype?: string }>,
    token: string
  ): Promise<ProcessedFile[]> {
    const results: ProcessedFile[] = [];

    for (const file of files) {
      if (!file.url_private_download) continue;

      try {
        const ext = path.extname(file.name).toLowerCase();
        const isImage = IMAGE_EXTENSIONS.includes(ext) ||
          file.mimetype?.startsWith('image/');

        if (isImage) {
          const filePath = await this.downloadFile(
            file.url_private_download,
            file.name,
            token
          );
          results.push({ type: 'image', name: file.name, path: filePath });
        } else {
          const content = await this.downloadText(
            file.url_private_download,
            token
          );
          results.push({
            type: 'text',
            name: file.name,
            content: content.length > MAX_TEXT_INLINE
              ? content.slice(0, MAX_TEXT_INLINE) + '\n... (truncated)'
              : content,
          });
        }
      } catch (err) {
        console.error(`[file-handler] Failed to process file ${file.name}:`, err);
      }
    }

    return results;
  }

  buildPromptAddition(files: ProcessedFile[]): string {
    if (files.length === 0) return '';

    const parts: string[] = ['\n\n--- Attached Files ---'];

    for (const file of files) {
      if (file.type === 'image') {
        parts.push(`\nImage file saved at: ${file.path}\nPlease use the Read tool to view it.`);
      } else {
        parts.push(`\nFile: ${file.name}\n\`\`\`\n${file.content}\n\`\`\``);
      }
    }

    return parts.join('\n');
  }

  cleanupTempFiles(files: ProcessedFile[]) {
    for (const file of files) {
      if (file.path) {
        try {
          fs.unlinkSync(file.path);
        } catch {}
      }
    }
  }

  private async downloadFile(
    url: string,
    name: string,
    token: string
  ): Promise<string> {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const filePath = path.join(this.tmpDir, `${Date.now()}_${name}`);
    fs.writeFileSync(filePath, buffer);
    return filePath;
  }

  private async downloadText(url: string, token: string): Promise<string> {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`);
    }

    return response.text();
  }
}
