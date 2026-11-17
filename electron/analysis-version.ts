/**
 * The analysis schema version, in its own module.
 *
 * The analyzer and the worker that runs it both need it; importing it from
 * `analyzer.ts` made Rollup share that module between two entries, emit it under
 * `chunks/`, and break the worker path the analyzer builds from `__dirname`.
 */
export const ANALYSIS_VERSION = 3
