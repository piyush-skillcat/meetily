"use client";

/**
 * TemplateManagerDialog — create, edit, delete and set-default for note
 * templates (Granola-style: a template is a list of sections, each with a
 * heading and an instruction telling the AI what to put there).
 */

import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, ArrowUp, ArrowDown, Star, Copy, Loader2, Pencil } from 'lucide-react';
import type { TemplateDef, TemplateFull, TemplateSectionDef } from '@/types';

interface TemplateInfo {
  id: string;
  name: string;
  description: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Currently selected template id (to highlight) */
  selectedTemplateId?: string;
  /** Called after any change so the parent can refresh its list */
  onChanged?: () => void;
  /** Called when the user picks "Use" on a template */
  onUseTemplate?: (id: string, name: string) => void;
}

const EMPTY_SECTION: TemplateSectionDef = { title: '', instruction: '', format: 'list' };

function emptyTemplate(): TemplateDef {
  return {
    name: '',
    description: '',
    sections: [
      { title: 'Summary', instruction: 'Two to four bullets on what the meeting was about and what came out of it', format: 'list' },
      { title: 'Action Items', instruction: 'Every commitment or task, with owner and due date when mentioned', format: 'list', item_format: '- [ ] **Owner**: task (due date)' },
    ],
  };
}

export function TemplateManagerDialog({ open, onOpenChange, selectedTemplateId, onChanged, onUseTemplate }: Props) {
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [defaultId, setDefaultId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; isCustom: boolean; def: TemplateDef } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [list, def] = await Promise.all([
        invoke<TemplateInfo[]>('api_list_templates'),
        invoke<string | null>('api_get_default_template').catch(() => null),
      ]);
      setTemplates(list);
      setDefaultId(def);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setEditing(null);
      void refresh();
    }
  }, [open, refresh]);

  const startEdit = async (id: string) => {
    try {
      const full = await invoke<TemplateFull>('api_get_template_full', { templateId: id });
      setEditing({
        id: full.id,
        isCustom: full.is_custom,
        def: { name: full.name, description: full.description, sections: full.sections },
      });
    } catch (e) {
      toast.error('Could not load template', { description: String(e) });
    }
  };

  const startNew = () => setEditing({ id: null, isCustom: true, def: emptyTemplate() });

  const duplicate = async (id: string) => {
    try {
      const full = await invoke<TemplateFull>('api_get_template_full', { templateId: id });
      setEditing({
        id: null,
        isCustom: true,
        def: { name: `${full.name} (copy)`, description: full.description, sections: full.sections },
      });
    } catch (e) {
      toast.error('Could not duplicate template', { description: String(e) });
    }
  };

  const save = async () => {
    if (!editing) return;
    const def = editing.def;
    if (!def.name.trim()) return toast.error('Give the template a name');
    if (!def.description.trim()) return toast.error('Add a one-line description');
    if (def.sections.length === 0) return toast.error('Add at least one section');
    for (const s of def.sections) {
      if (!s.title.trim() || !s.instruction.trim()) return toast.error('Every section needs a heading and an instruction');
    }
    setBusy(true);
    try {
      const cleaned: TemplateDef = {
        ...def,
        sections: def.sections.map((s) => ({
          title: s.title.trim(),
          instruction: s.instruction.trim(),
          format: s.format,
          ...(s.item_format?.trim() ? { item_format: s.item_format.trim() } : {}),
        })),
      };
      const id = await invoke<string>('api_save_template', {
        templateId: editing.isCustom ? editing.id : null,
        template: cleaned,
      });
      toast.success(editing.id ? 'Template saved' : 'Template created');
      setEditing(null);
      await refresh();
      onChanged?.();
      if (!editing.id && onUseTemplate) onUseTemplate(id, cleaned.name);
    } catch (e) {
      toast.error('Could not save template', { description: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this template?')) return;
    try {
      await invoke('api_delete_template', { templateId: id });
      toast.success('Template deleted');
      if (defaultId === id) setDefaultId(null);
      await refresh();
      onChanged?.();
    } catch (e) {
      toast.error('Could not delete', { description: String(e) });
    }
  };

  const makeDefault = async (id: string) => {
    try {
      await invoke('api_set_default_template', { templateId: id });
      setDefaultId(id);
      toast.success('Default template updated');
      onChanged?.();
    } catch (e) {
      toast.error('Could not set default', { description: String(e) });
    }
  };

  const updateSection = (i: number, patch: Partial<TemplateSectionDef>) =>
    setEditing((e) =>
      e && { ...e, def: { ...e.def, sections: e.def.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)) } }
    );
  const moveSection = (i: number, dir: -1 | 1) =>
    setEditing((e) => {
      if (!e) return e;
      const arr = [...e.def.sections];
      const j = i + dir;
      if (j < 0 || j >= arr.length) return e;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return { ...e, def: { ...e.def, sections: arr } };
    });
  const removeSection = (i: number) =>
    setEditing((e) => e && { ...e, def: { ...e.def, sections: e.def.sections.filter((_, j) => j !== i) } });
  const addSection = () =>
    setEditing((e) => e && { ...e, def: { ...e.def, sections: [...e.def.sections, { ...EMPTY_SECTION }] } });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogTitle>{editing ? (editing.id ? 'Edit template' : 'New template') : 'Templates'}</DialogTitle>
        <DialogDescription>
          {editing
            ? 'Each section is a heading plus an instruction telling the AI what to put under it.'
            : 'Templates shape how your notes are structured when they are enhanced.'}
        </DialogDescription>

        {!editing ? (
          <div className="flex-1 overflow-y-auto -mx-1 px-1">
            <div className="flex justify-end mb-3">
              <Button size="sm" onClick={startNew}>
                <Plus size={16} className="mr-1" /> New template
              </Button>
            </div>
            <ul className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
              {templates.map((t) => (
                <li key={t.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900 truncate">{t.name}</span>
                      {defaultId === t.id && (
                        <span className="text-[10px] uppercase tracking-wide bg-amber-100 text-amber-800 rounded px-1.5 py-0.5">default</span>
                      )}
                      {selectedTemplateId === t.id && (
                        <span className="text-[10px] uppercase tracking-wide bg-blue-100 text-blue-800 rounded px-1.5 py-0.5">selected</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 truncate">{t.description}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {onUseTemplate && (
                      <Button variant="outline" size="sm" onClick={() => { onUseTemplate(t.id, t.name); onOpenChange(false); }}>
                        Use
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" title="Set as default" onClick={() => makeDefault(t.id)}>
                      <Star size={16} className={defaultId === t.id ? 'fill-amber-400 text-amber-500' : ''} />
                    </Button>
                    <Button variant="ghost" size="icon" title="Edit" onClick={() => startEdit(t.id)}>
                      <Pencil size={16} />
                    </Button>
                    <Button variant="ghost" size="icon" title="Duplicate" onClick={() => duplicate(t.id)}>
                      <Copy size={16} />
                    </Button>
                    <Button variant="ghost" size="icon" title="Delete" onClick={() => remove(t.id)}>
                      <Trash2 size={16} />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            <p className="text-xs text-gray-400 mt-2">
              Editing a built-in template saves a copy you own. Built-in templates can't be deleted.
            </p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto -mx-1 px-1 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Name</Label>
                <Input
                  value={editing.def.name}
                  onChange={(e) => setEditing({ ...editing, def: { ...editing.def, name: e.target.value } })}
                  placeholder="e.g. Weekly sync"
                />
              </div>
              <div>
                <Label className="text-xs">Description</Label>
                <Input
                  value={editing.def.description}
                  onChange={(e) => setEditing({ ...editing, def: { ...editing.def, description: e.target.value } })}
                  placeholder="When to use this template"
                />
              </div>
            </div>

            <div className="space-y-3">
              {editing.def.sections.map((s, i) => (
                <div key={i} className="border border-gray-200 rounded-lg p-3 bg-gray-50/60">
                  <div className="flex items-center gap-2 mb-2">
                    <Input
                      className="font-medium bg-white"
                      value={s.title}
                      onChange={(e) => updateSection(i, { title: e.target.value })}
                      placeholder="Section heading"
                    />
                    <Select value={s.format} onValueChange={(v) => updateSection(i, { format: v as TemplateSectionDef['format'] })}>
                      <SelectTrigger className="w-[130px] bg-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="list">Bullets</SelectItem>
                        <SelectItem value="paragraph">Paragraph</SelectItem>
                        <SelectItem value="string">Short text</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button variant="ghost" size="icon" onClick={() => moveSection(i, -1)} disabled={i === 0} title="Move up">
                      <ArrowUp size={14} />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => moveSection(i, 1)} disabled={i === editing.def.sections.length - 1} title="Move down">
                      <ArrowDown size={14} />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => removeSection(i)} title="Remove section">
                      <Trash2 size={14} />
                    </Button>
                  </div>
                  <textarea
                    className="w-full text-sm rounded-md border border-gray-200 bg-white px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500 min-h-[56px]"
                    value={s.instruction}
                    onChange={(e) => updateSection(i, { instruction: e.target.value })}
                    placeholder="What should the AI put here? e.g. Every decision made, with the reason"
                  />
                  {s.format === 'list' && (
                    <Input
                      className="mt-2 bg-white text-xs font-mono"
                      value={s.item_format ?? ''}
                      onChange={(e) => updateSection(i, { item_format: e.target.value })}
                      placeholder="Optional item format, e.g. - [ ] **Owner**: task (due date)"
                    />
                  )}
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={addSection}>
                <Plus size={14} className="mr-1" /> Add section
              </Button>
            </div>

            <div className="flex justify-between pt-2 border-t border-gray-100">
              <Button variant="ghost" onClick={() => setEditing(null)} disabled={busy}>
                Back
              </Button>
              <Button onClick={save} disabled={busy}>
                {busy && <Loader2 size={16} className="animate-spin mr-1" />}
                {editing.isCustom && editing.id ? 'Save' : 'Save as my template'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default TemplateManagerDialog;
