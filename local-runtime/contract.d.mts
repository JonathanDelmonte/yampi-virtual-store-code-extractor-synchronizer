export type RawValue = null | boolean | number | string | RawValue[] | {[key: string]: RawValue};
export interface RawSection {section_alias?: string; position?: number; order?: number | null; visible?: unknown; params?: Record<string, unknown>; [key: string]: unknown}
export interface RawPage {themeConfig?: Record<string, unknown>; data?: Record<string, unknown>; merchant?: Record<string, unknown>; bodyClasses?: string[]}
export interface Overrides {format: 'yampi-local-overrides'; version: 1; global?: Record<string, unknown>; pages?: Record<string, Record<string, unknown>>}
export const CONTRACT_VERSION: number;
export const PAGE_KINDS: string[];
export const OVERRIDES_FORMAT: string;
export const COMPONENTS_FILE: string;
export function plain(value: unknown): value is Record<string, unknown>;
export function truthy(value: unknown): boolean;
export function sectionCandidates(alias: string, page: string): string[];
export function resolveSectionFile(alias: string, page: string, paths: Iterable<string>, configured?: Record<string, string>): string;
export function mergeSection(base: RawSection | undefined, config: RawSection): RawSection;
export function pageSections(raw: RawPage): {sections: RawSection[]; header?: RawSection; footer?: RawSection; main: RawSection[]; config?: RawSection};
export function expectedSections(raw: RawPage): {alias: string; order: number | null}[];
export function platformContext(raw: RawPage, options?: {kind?: string}): Record<string, unknown>;
export function legacyToRaw(data: unknown, kind: string): RawPage;
export function mergePatch<T = unknown>(target: unknown, patch: T): T;
export function emptyOverrides(): Overrides;
export function isOverrides(value: unknown): value is Overrides;
export function validateOverrides(value: unknown): Overrides;
export function applyOverrides(raw: RawPage, overrides: Overrides | undefined, options?: {kind?: string; id?: string}): RawPage;
export function referencedKeys(files: Record<string, string>): {theme: string[]; section: string[]; merchant: string[]};
export function capturedKeys(pages: RawPage[]): {theme: Set<string>; section: Set<string>; merchant: Set<string>};
export function componentList(source: string): {entries: string[]; components: string[]};
export function themeSheet(url: string, pages?: string[]): {group: 'styles' | 'pageStyles' | 'mobilePageStyles' | 'mobileStyles'; page?: string} | undefined;
export function urlRewriter(map: Record<string, string>): <T>(value: T) => T;
export function underlyingImage(url: string): string;
