/** Resolve temporary debug targets without writing project configuration or running discovery commands. */
import { dirname, extname, join, relative, isAbsolute } from 'node:path';
import ts from 'typescript';
import { readWorkspaceSource } from './navigation.js';

const fail = (message, code = 'DEBUG_TARGET_REQUIRED') => Object.assign(new Error(message), { status: 400, code });
const validPath = path => typeof path === 'string' && path.length > 0 && !isAbsolute(path) && !path.split(/[\\/]/).some(part => part === '..' || part === '.');

/**
 * Resolve an explicitly selected current file into a launch target, bounded to its workspace.
 * @param ctx - Host filesystem service.
 * @param cwd - Validated local workspace path.
 * @param path - Workspace-relative source file selected by the user.
 * @returns A temporary launch configuration; no project files are written.
 */
export async function currentFileTarget(ctx, cwd, path) {
  if (!validPath(path)) throw fail('open a runnable source file first');
  const source = await readWorkspaceSource(ctx, cwd, path);
  const root = ctx.fs.processPath(source.root), file = ctx.fs.processPath(source.file);
  const extension = extname(path).toLowerCase();
  const target = { name: path, request: 'launch', currentFile: path, arguments: { program: file, cwd: root } };
  if (extension === '.py') {
    target.language = 'python';
    const interpreter = join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    const stat = await ctx.fs.stat(await ctx.fs.resolve(interpreter));
    // Keep the venv's executable path: canonicalizing its symlink loses Python's venv discovery.
    if (stat?.type === 'file') target.arguments.python = [interpreter];
  } else if (extension === '.go') {
    target.language = 'go';
    target.arguments.mode = path.endsWith('_test.go') ? 'test' : 'debug';
    target.arguments.program = dirname(file);
  } else if (['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts'].includes(extension)) {
    target.language = ['.ts', '.mts', '.cts'].includes(extension) ? 'typescript' : 'javascript';
    Object.assign(target.arguments, { type: 'pwa-node', runtimeExecutable: process.execPath });
    if (target.language === 'typescript') {
      const outputExtension = extension === '.mts' ? '.mjs' : extension === '.cts' ? '.cjs' : '.js';
      let candidate = path.slice(0, -extension.length) + outputExtension;
      const optionalSource = async name => {
        try { return await readWorkspaceSource(ctx, cwd, name); }
        catch (error) { if (error.code === 'SOURCE_NOT_FILE') return null; throw error; }
      };
      let output = await optionalSource(candidate);
      if (!output) {
        let directory = dirname(path);
        while (true) {
          const config = await optionalSource(join(directory, 'tsconfig.json'));
          if (config) {
            const parsed = ts.parseConfigFileTextToJson('tsconfig.json', config.text);
            if (parsed.error) throw fail(ts.flattenDiagnosticMessageText(parsed.error.messageText, '\n'), 'DEBUG_CONFIG_INVALID');
            const options = parsed.config?.compilerOptions;
            if (!parsed.config?.extends && typeof options?.outDir === 'string' && typeof options?.rootDir === 'string') {
              const part = relative(join(directory, options.rootDir), path);
              if (part !== '..' && !part.startsWith('../') && !isAbsolute(part)) {
                candidate = join(directory, options.outDir, part.slice(0, -extension.length) + outputExtension);
                if (validPath(candidate)) output = await optionalSource(candidate);
              }
            }
            break;
          }
          if (directory === '.') break;
          directory = dirname(directory);
        }
      }
      if (!output || (!output.text.includes('sourceMappingURL=data:') && !await optionalSource(candidate + '.map'))) throw fail('build JavaScript with source maps, or configure its output path in .dsh/debug.json', 'DEBUG_TS_BUILD');
      target.arguments.program = ctx.fs.processPath(output.file);
      target.arguments.sourceMaps = true;
      target.arguments.outFiles = [ctx.fs.processPath(output.file)];
    }
  } else throw fail('this file is not a Python, Go or Node.js entry point');
  return target;
}

/**
 * Resolve the attach prompt's language and numeric port/PID into fixed local adapter arguments.
 * @param input - Browser-provided attach fields; never accepts commands or arbitrary adapter arguments.
 * @returns A temporary local attach configuration.
 */
export function attachTarget(input) {
  if (!input || !['python', 'go', 'javascript', 'typescript'].includes(input.language) || !['port', 'pid'].includes(input.kind) || (input.kind === 'pid' && input.language !== 'go') || !Number.isSafeInteger(input.value) || input.value < 1 || (input.kind === 'port' && input.value > 65535)) throw fail('enter a valid local debugger port or Go process ID', 'DEBUG_ATTACH_INVALID');
  const { language, kind, value } = input;
  const args = language === 'javascript' || language === 'typescript'
    ? { type: 'pwa-node', address: '127.0.0.1', port: value, sourceMaps: true }
    : kind === 'pid' ? { mode: 'local', processId: value }
      : { ...(language === 'go' ? { mode: 'remote' } : {}), connect: { host: '127.0.0.1', port: value } };
  return { name: `${language} · ${kind} ${value}`, language, request: 'attach', arguments: args };
}
