"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronRight, Clock3, FileText, Folder, FolderOpen, FolderPlus, Mail, Plus, Star, Trash2 } from "lucide-react";
import { documentCategories, type DocumentCategory, type LibraryFolder, type LibraryResult } from "@/lib/documents";

function TreeConnector() {
  return <svg className="library-tree-line" aria-hidden="true" focusable="false" viewBox="0 0 12 38" preserveAspectRatio="none" fill="none">
    <path className="library-tree-stem" d="M1 0V38" />
    <path className="library-tree-curve" d="M1 0V14Q1 20 7 20H12" />
    <path className="library-tree-active-stem" pathLength="1" d="M1 0V38" />
    <path className="library-tree-active-curve" pathLength="1" d="M1 0V14Q1 20 7 20H12" />
    <circle className="library-tree-tip" cx="10" cy="20" r="1.5" />
  </svg>;
}

function NavSection({ title, children, action, active }: { title: string; children: ReactNode; action?: ReactNode; active?: boolean }) {
  const [expanded, setExpanded] = useState(true);
  const id = useId();
  return <div className="library-nav-section">
    <div className="library-section-heading"><button type="button" className="library-section-toggle" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)} onKeyDown={event => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); setExpanded(event.key === "ArrowRight"); } }}><ChevronRight className={expanded ? "is-expanded" : ""} /><span>{title}</span>{!expanded && active ? <i className="library-section-dot" /> : null}</button>{action}</div>
    <div id={id} className={`library-tree-collapse ${expanded ? "is-expanded" : ""}`} inert={!expanded}><div><ul className="library-tree-branches">{children}</ul></div></div>
  </div>;
}

export function DocumentLibraryNav({ view, folderId, category, folders, stats, canWrite, onNavigate, onCreateFolder }: {
  view: string; folderId: string | null; category: DocumentCategory | ""; folders: LibraryFolder[]; stats?: LibraryResult["stats"]; canWrite: boolean;
  onNavigate: (view: string, folder?: string | null, category?: DocumentCategory | "") => void; onCreateFolder: () => void;
}) {
  const views = [{ id: "all", label: "All files", icon: FolderOpen, count: stats ? stats.files + stats.templates : null }, { id: "recent", label: "Recently updated", icon: Clock3 }, { id: "starred", label: "Starred", icon: Star, count: stats?.starred }, { id: "templates", label: "Text templates", icon: FileText, count: stats?.templates }];
  return <aside className="library-sidebar" aria-label="Library navigation"><nav aria-label="Browse library" className="library-quick-nav">{views.map(item => <button type="button" key={item.id} aria-current={view === item.id && !folderId && !category ? "page" : undefined} className={view === item.id && !folderId && !category ? "is-active" : ""} onClick={() => onNavigate(item.id)}><item.icon /><span>{item.label}</span>{item.count != null ? <small>{item.count}</small> : null}</button>)}</nav>
    <nav aria-label="Categories and folders" className="library-tree-nav">{["Business documents", "Shared resources", "Email templates"].map(group => <NavSection key={group} title={group} active={documentCategories.some(item => item.group === group && item.id === category)}>{documentCategories.filter(item => item.group === group).map(item => <li key={item.id}><TreeConnector /><button type="button" title={item.label} aria-current={category === item.id ? "page" : undefined} className={category === item.id ? "is-active" : ""} onClick={() => onNavigate(group === "Email templates" ? "templates" : "all", null, item.id)}>{group === "Email templates" ? <Mail /> : category === item.id ? <FolderOpen className="library-category-folder" /> : <Folder className="library-category-folder" />}<span>{item.label}</span></button></li>)}</NavSection>)}
      <NavSection title="Folders" active={!!folderId} action={canWrite ? <button type="button" className="library-folder-add" aria-label="Create folder" onClick={onCreateFolder}><Plus /></button> : null}>{folders.map(folder => <li key={folder.id}><TreeConnector /><button type="button" title={folder.name} aria-current={folderId === folder.id ? "page" : undefined} className={folderId === folder.id ? "is-active" : ""} onClick={() => onNavigate("all", folder.id)}>{folderId === folder.id ? <FolderOpen className={`folder-${folder.color}`} /> : <Folder className={`folder-${folder.color}`} />}<span>{folder.name}</span></button></li>)}{!folders.length ? <li><TreeConnector /><button type="button" className="library-create-folder" disabled={!canWrite} onClick={onCreateFolder}><FolderPlus /><span>New folder</span></button></li> : null}</NavSection>
    </nav>
    <nav aria-label="Deleted items" className="library-trash-nav"><button type="button" aria-current={view === "trash" ? "page" : undefined} className={view === "trash" ? "is-active" : ""} onClick={() => onNavigate("trash")}><Trash2 /><span>Trash</span>{stats?.trash ? <small>{stats.trash}</small> : null}</button></nav>
  </aside>;
}
