export interface Reference {via: string; candidates: (string | {alias: string; pages: string[]} | {component: string})[]; label: string}
export interface DependencyReport {blocked: {path: string; dependencies: {path: string; via: string}[]}[]; warnings: {path: string; message: string}[]}
export function kebab(name: string): string;
export const RESERVED_COMPONENTS: Set<string>;
export function assetUrlProblem(value: unknown): string | undefined;
export interface YampiInclude {name: string; file: boolean; line: number; excerpt: string}
export function yampiIncludes(text: string): YampiInclude[];
export function includeSpot(text: string, name: string): {line: number; excerpt: string} | undefined;
export function saveIssues(path: string, text: string): string[];
export function productionIssues(path: string, text: string): string[];
export function references(path: string, text: string): Reference[];
export function resolvedReferences(path: string, text: string, paths: Iterable<string>): string[];
export function dependencyReport(input: {targets: string[]; texts: Record<string, string>; local: Iterable<string>; remote: Iterable<string>}): DependencyReport;
