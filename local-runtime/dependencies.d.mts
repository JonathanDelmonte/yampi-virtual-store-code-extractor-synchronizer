export interface Reference {via: string; candidates: (string | {alias: string; pages: string[]} | {component: string})[]; label: string}
export interface DependencyReport {blocked: {path: string; dependencies: {path: string; via: string}[]}[]; warnings: {path: string; message: string}[]}
export function kebab(name: string): string;
export function references(path: string, text: string): Reference[];
export function resolvedReferences(path: string, text: string, paths: Iterable<string>): string[];
export function dependencyReport(input: {targets: string[]; texts: Record<string, string>; local: Iterable<string>; remote: Iterable<string>}): DependencyReport;
