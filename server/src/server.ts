/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import {
	IPCMessageReader, IPCMessageWriter,
	createConnection, IConnection, TextDocumentSyncKind,
	TextDocuments, ITextDocument, Diagnostic, DiagnosticSeverity,
	InitializeParams, InitializeResult, TextDocumentIdentifier,
	CompletionItem, CompletionItemKind
} from 'vscode-languageserver';

import * as fs from 'fs';
import * as path from 'path';
import * as child_process from 'child_process';

// Create a connection for the server. The connection uses
// stdin / stdout for message passing
let connection: IConnection = createConnection(new IPCMessageReader(process), new IPCMessageWriter(process));

// Create a simple text document manager. The text document manager
// supports full document sync only
let documents: TextDocuments = new TextDocuments();
// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// After the server has started the client sends an initilize request. The server receives
// in the passed params the rootPath of the workspace plus the client capabilites.
let workspaceRoot: string;
let flake8Binary: string;
connection.onInitialize((params): InitializeResult => {
	workspaceRoot = params.rootPath;
    flake8Binary = findFlake8();
	return {
		capabilities: {
			// Tell the client that the server works in FULL text document sync mode
			textDocumentSync: documents.syncKind,
			// Tell the client that the server support code complete
			completionProvider: {
				resolveProvider: true
			}
		}
	}
});

function findFlake8(): string {
    for (let flake8Path of process.env.PATH.split(path.delimiter)) {
        let foundPath = [flake8Path, 'flake8'].join(path.sep);
        console.log('Checking', foundPath);
        let stat: fs.Stats;
        try {
            stat = fs.statSync(foundPath);
        } catch (error) {
            continue;
        }
        console.log('File exists', foundPath, stat.isFile());
        if (stat.isFile() && stat.mode & fs.X_OK) {
            console.log('Spawning', foundPath);
            let dataBuffer = child_process.execFileSync(foundPath, ['--version']);
            let data = dataBuffer.toString();
            let match = data.match(/^\d+.\d+.\d+/);
            if (match) {
                console.log(`Found flake8 on ${foundPath} version ${match[0]}`);
                return foundPath;
            }
        }
    }
}

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent((change) => {
	validateTextDocument(change.document.uri, change.document.getText());
});

// connection.onDidOpenTextDocument((params) => {
//     validateTextDocument(params.uri);
// });

// The settings interface describe the server relevant settings part
interface Settings {
	flake8: ExampleSettings;
}

// These are the example settings we defined in the client's package.json
// file
interface ExampleSettings {
	maxNumberOfProblems: number;
}

// hold the maxNumberOfProblems setting
let maxNumberOfProblems: number;
// The settings have changed. Is send on server activation
// as well.
connection.onDidChangeConfiguration((change) => {
	let settings = <Settings>change.settings;
	maxNumberOfProblems = settings.flake8.maxNumberOfProblems || 100;
	// Revalidate any open text documents
	documents.all().forEach((textDocument: ITextDocument) => validateTextDocument(textDocument.uri));
});

function validateTextDocument(uri: string, content?: string): void {
	let diagnostics: Diagnostic[] = [];
    let regex = /:(\d+):(\d+): (\w+) (.*)/gm;
	let problems = 0;
    let pythonFile: string;
    if (content) {
        pythonFile = `${uri.replace('file://', '')}.flake8.py`;
        fs.writeFileSync(pythonFile, content);
    } else {
        pythonFile = uri.replace('file://', '');
    }

    console.log(`Testing file ${pythonFile} with ${flake8Binary}`);
    child_process.execFile(flake8Binary, [pythonFile], {cwd: workspaceRoot},
        (error, stdoutBuffer, stderr) => {
            let stdout: string = stdoutBuffer.toString();
            if (regex.test(stdout)) {
                regex.lastIndex = null;
                let match = regex.exec(stdout);
                while (match && problems < maxNumberOfProblems) {
                    let line = parseInt(match[1]);
                    let column = parseInt(match[2]);
                    problems++;
                    diagnostics.push({
                       range: {
                           start: {line: line - 1, character: column - 1},
                           end: {line: line - 1, character: column},
                       },
                       code: match[3],
                       message: `${match[3]}: ${match[4]}`
                    });
                    match = regex.exec(stdout);
                }
            }
            if (content) {
                fs.unlink(pythonFile);
            }
            // Send the computed diagnostics to VSCode.
            connection.sendDiagnostics({ uri, diagnostics });
            return;
    });
}

/*
connection.onDidChangeWatchedFiles((change) => {
	// Monitored files have change in VSCode
	connection.console.log('We recevied an file change event');
});

connection.onDidOpenTextDocument((params) => {
	// A text document got opened in VSCode.
	// params.uri uniquely identifies the document. For documents store on disk this is a file URI.
	// params.text the initial full content of the document.
	connection.console.log(`${params.uri} opened.`);
});

connection.onDidChangeTextDocument((params) => {
	// The content of a text document did change in VSCode.
	// params.uri uniquely identifies the document.
	// params.contentChanges describe the content changes to the document.
	connection.console.log(`${params.uri} changed: ${JSON.stringify(params.contentChanges)}`);
});

connection.onDidCloseTextDocument((params) => {
	// A text document got closed in VSCode.
	// params.uri uniquely identifies the document.
	connection.console.log(`${params.uri} closed.`);
});
*/

// Listen on the connection
connection.listen();
