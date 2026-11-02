/** Read-only compiler navigation in a disposable thread; no project plugins are executed. */
import { parentPort, workerData } from 'node:worker_threads';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const { root, file, text, line, character } = workerData;
let service;
try {
  const configPath = ts.findConfigFile(dirname(file), ts.sys.fileExists, 'tsconfig.json')
    ?? ts.findConfigFile(dirname(file), ts.sys.fileExists, 'jsconfig.json');
  let options = { allowJs: true, checkJs: true, target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext };
  let files = [file];
  if (configPath) {
    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configPath));
    // A detached file still has usable navigation even when excluded by the project's include list.
    options = { ...parsed.options, allowJs: true };
    files = [...new Set([...parsed.fileNames, file])];
  }
  const read = name => resolve(name) === file ? text : ts.sys.readFile(name);
  service = ts.createLanguageService({
    ...ts.sys,
    useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
    getCompilationSettings: () => options,
    getCurrentDirectory: () => root,
    getScriptFileNames: () => files,
    getScriptVersion: () => '0',
    getScriptSnapshot: name => { const value = read(name); return value === undefined ? undefined : ts.ScriptSnapshot.fromString(value); },
    getDefaultLibFileName: opts => ts.getDefaultLibFilePath(opts),
  });
  const source = service.getProgram()?.getSourceFile(file);
  if (!source) throw new Error('source is not in the language-service program');
  const position = source.getPositionOfLineAndCharacter(line, character);
  const definitions = service.getDefinitionAtPosition(file, position) ?? [];
  const locations = definitions.map(definition => {
    const target = service.getProgram()?.getSourceFile(definition.fileName);
    if (!target) throw new Error('definition source is unavailable');
    return { uri: pathToFileURL(definition.fileName).href, range: {
      start: target.getLineAndCharacterOfPosition(definition.textSpan.start),
      end: target.getLineAndCharacterOfPosition(definition.textSpan.start + definition.textSpan.length),
    } };
  });
  parentPort.postMessage({ locations });
} catch (error) {
  parentPort.postMessage({ error: error.message });
} finally {
  service?.dispose();
}
