/** Confine filesystem-case emulation to the worker used by the navigation regression test. */
import ts from 'typescript';
import { workerData } from 'node:worker_threads';
ts.sys.useCaseSensitiveFileNames = workerData.testCaseSensitive;
