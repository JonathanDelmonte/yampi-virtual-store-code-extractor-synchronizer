import {sameContext, type Assets, type Context, type Files, type Journal, type Plan, type Snapshot} from './model';
import type {Capture} from './workflow';
// What the panel keeps between openings, per store: the reference export, the project loaded
// from the computer, the last reading of the store and the user's choices. Closing the panel,
// switching tabs or restarting the browser never sends the user back to the first step.
export interface Review {reading?: Capture; overrides: string[]; selected?: string[]; discarded?: string[]}
export interface ProjectSource {local: Files; localAssets: Assets; name: string; kind: 'folder' | 'zip' | 'demo'; loadedAt: string}
// journals: the sends that moved the reference forward since the export.
export interface Lineage {exportedAt: string; journals: string[]; advancedAt?: string}
export interface Workspace {
  version: 1; context: Context; updatedAt: string;
  baseline?: Snapshot; lineage?: Lineage;
  project?: ProjectSource; review?: Review;
  // Undoing a send compares the send's record instead of the project.
  restore?: Review & {journalId: string};
}
export function emptyWorkspace(context: Context): Workspace {return {version: 1, context, updatedAt: new Date().toISOString()};}
// The export inside a project folder is the reference, unless this installation has already
// moved that same export forward with sends made since: then the advanced one is used, so files
// sent before do not come back as conflicts.
export function chooseBaseline(workspace: Workspace | undefined, folder: Snapshot): {baseline: Snapshot; lineage: Lineage; advanced: boolean} {
  const stored = workspace?.baseline, lineage = workspace?.lineage;
  if (stored && lineage?.advancedAt && lineage.exportedAt === folder.capturedAt && sameContext(stored.context, folder.context)) return {baseline: stored, lineage, advanced: true};
  return {baseline: folder, lineage: {exportedAt: folder.capturedAt, journals: []}, advanced: false};
}
// After a send, the reference takes what the store now has for every confirmed item. The next
// comparison then shows only what changed since, instead of conflicts with the old export.
export function advanceBaseline(workspace: Workspace, plan: Plan, journal: Journal): boolean {
  const baseline = workspace.baseline;
  if (!baseline || !sameContext(baseline.context, journal.context)) return false;
  const rows = new Map(plan.rows.map(row => [row.path, row]));
  const files: Files = {...baseline.files}, assets: Assets = {...baseline.assets};
  let changed = 0;
  for (const path of journal.verified) {const local = rows.get(path)?.local; if (local !== undefined) {files[path] = local; changed++;}}
  for (const path of journal.uploaded || []) {const bytes = rows.get(path)?.image?.local; if (bytes) {assets[path] = bytes; changed++;}}
  if (!changed) return false;
  const now = new Date().toISOString();
  workspace.baseline = {...baseline, files, ...(Object.keys(assets).length ? {assets} : {})};
  const journals = workspace.lineage?.journals ?? [];
  workspace.lineage = {exportedAt: workspace.lineage?.exportedAt ?? baseline.capturedAt, journals: journals.includes(journal.id) ? journals : [...journals, journal.id], advancedAt: now};
  return true;
}
