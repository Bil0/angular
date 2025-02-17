/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import * as path from 'path';
import * as ts from 'typescript';

import {createLanguageService} from '../src/language_service';
import {ReflectorHost} from '../src/reflector_host';
import {TypeScriptServiceHost} from '../src/typescript_host';

import {toh} from './test_data';
import {MockTypescriptHost} from './test_utils';

describe('reflector_host_spec', () => {

  // Regression #21811
  it('should be able to find angular under windows', () => {
    const originalJoin = path.join;
    const originalPosixJoin = path.posix.join;
    const mockHost =
        new MockTypescriptHost(['/app/main.ts', '/app/parsing-cases.ts'], toh, 'node_modules', {
          ...path,
          join: (...args: string[]) => originalJoin.apply(path, args),
          posix:
              {...path.posix, join: (...args: string[]) => originalPosixJoin.apply(path, args)}
        });
    const reflectorHost = new ReflectorHost(() => undefined as any, mockHost);

    if (process.platform !== 'win32') {
      // If we call this in Windows it will cause a 'Maximum call stack size exceeded error'
      // Because we are spying on the same function that we are call faking
      spyOn(path, 'join').and.callFake((...args: string[]) => { return path.win32.join(...args); });
    }

    const result = reflectorHost.moduleNameToFileName('@angular/core');
    expect(result).not.toBeNull('could not find @angular/core using path.win32');
  });

  it('should use module resolution cache', () => {
    const mockHost = new MockTypescriptHost(['/app/main.ts'], toh);
    // TypeScript relies on `ModuleResolutionHost.fileExists()` to perform
    // module resolution, and ReflectorHost uses
    // `LanguageServiceHost.getScriptSnapshot()` to implement `fileExists()`,
    // so spy on this method to determine how many times it's called.
    const spy = spyOn(mockHost, 'getScriptSnapshot').and.callThrough();

    const tsLS = ts.createLanguageService(mockHost);

    // First count is due to the instantiation of StaticReflector, which
    // performs resolutions of core Angular symbols, like `NgModule`.
    // TODO: Reduce this count to zero doing lazy instantiation.
    const ngLSHost = new TypeScriptServiceHost(mockHost, tsLS);
    const firstCount = spy.calls.count();
    expect(firstCount).toBeGreaterThan(20);
    expect(firstCount).toBeLessThan(50);
    spy.calls.reset();

    // Second count is due to resolution of the Tour of Heroes (toh) project.
    // This resolves all Angular directives in the project.
    ngLSHost.getAnalyzedModules();
    const secondCount = spy.calls.count();
    expect(secondCount).toBeGreaterThan(500);
    expect(secondCount).toBeLessThan(600);
    spy.calls.reset();

    // Third count is due to recompution after the program changes.
    mockHost.addCode('');  // this will mark project as dirty
    ngLSHost.getAnalyzedModules();
    const thirdCount = spy.calls.count();
    expect(thirdCount).toBeGreaterThan(50);
    expect(thirdCount).toBeLessThan(100);

    // Summary
    // |               | First Count | Second Count | Third Count |
    // |---------------|-------------|--------------|-------------|
    // | Without Cache | 2581        | 6291         | 257         |
    // | With Cache    | 26          | 550          | 84          |
    // | Improvement   | ~100x       | ~10x         | ~3x         |
  });
});
