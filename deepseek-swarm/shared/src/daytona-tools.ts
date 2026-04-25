import { tool } from 'ai';
import { z } from 'zod';
import type { DaytonaToolbox } from './daytona.ts';

/**
 * Wraps a DaytonaToolbox as a dict of AI SDK tools. Names use a `daytona_`
 * prefix so the catalog stays navigable when the LLM inspects available
 * tools. Tool errors are returned as strings (not thrown) so the LLM can
 * read them in the next turn and decide whether to retry, pivot, or hand
 * off — losing a tool call to an exception kills the whole step.
 */
export function makeDaytonaTools(toolbox: DaytonaToolbox) {
  return {
    daytona_read_file: tool({
      description:
        'Read the contents of a file in the shared sandbox workspace. Always read before editing so you know the current state.',
      inputSchema: z.object({
        path: z.string().describe('Absolute path to the file, e.g. /workspace/src/main.py'),
      }),
      execute: async ({ path }) => {
        try {
          return await toolbox.readFile(path);
        } catch (e) {
          return `ERROR reading ${path}: ${(e as Error).message}`;
        }
      },
    }),

    daytona_write_file: tool({
      description:
        'Write text content to a file in the sandbox, creating it or overwriting if it exists. Parent directories are created as needed.',
      inputSchema: z.object({
        path: z.string().describe('Absolute path to the file, e.g. /workspace/src/main.py'),
        content: z
          .string()
          .describe(
            'Full content to write. If editing an existing file, include everything — this is a full overwrite, not a diff.',
          ),
      }),
      execute: async ({ path, content }) => {
        try {
          const { bytesWritten } = await toolbox.writeFile(path, content);
          return `wrote ${bytesWritten} bytes to ${path}`;
        } catch (e) {
          return `ERROR writing ${path}: ${(e as Error).message}`;
        }
      },
    }),

    daytona_list_files: tool({
      description:
        'List files and directories at the given path in the sandbox. Returns JSON describing each entry.',
      inputSchema: z.object({
        path: z
          .string()
          .default('/workspace')
          .describe('Directory path, e.g. /workspace or /workspace/src.'),
      }),
      execute: async ({ path }) => {
        try {
          return await toolbox.listFiles(path);
        } catch (e) {
          return `ERROR listing ${path}: ${(e as Error).message}`;
        }
      },
    }),

    daytona_exec: tool({
      description:
        'Execute a shell command in the sandbox. Good for running tests, installing packages, invoking build tools, or inspecting the filesystem. Returns stdout, stderr, and exit code.',
      inputSchema: z.object({
        command: z
          .string()
          .describe("Command line to run, e.g. 'pytest tests/' or 'npm install && npm test'"),
        cwd: z.string().default('/workspace').describe('Working directory.'),
        timeoutSec: z.number().int().default(60).describe('Timeout in seconds.'),
      }),
      execute: async ({ command, cwd, timeoutSec }) => {
        try {
          const r = await toolbox.exec(command, cwd, timeoutSec);
          return JSON.stringify(r);
        } catch (e) {
          return `ERROR executing '${command}': ${(e as Error).message}`;
        }
      },
    }),
  };
}
