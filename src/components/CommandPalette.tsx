import React from 'react';
import { Command } from 'cmdk';
import type { Job, InventoryItem, User } from '@/core/types';
import type { ViewState } from '@/core/types';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobs: Job[];
  inventory: InventoryItem[];
  users: User[];
  onNavigate: (view: ViewState, id?: string) => void;
}

export function CommandPalette({
  open,
  onOpenChange,
  jobs,
  inventory,
  users,
  onNavigate,
}: CommandPaletteProps) {
  const handleSelect = (view: ViewState, id?: string) => {
    onOpenChange(false);
    onNavigate(view, id);
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Global search"
      className="fixed left-1/2 top-[20%] z-[100] w-full max-w-xl -translate-x-1/2 rounded-sm border border-white/10 bg-[#1a1122] shadow-2xl"
    >
      <Command.Input
        placeholder="Search jobs, inventory, people..."
        className="w-full border-b border-white/10 bg-transparent px-4 py-3 text-white placeholder:text-slate-500 focus:outline-none"
      />
      <Command.List className="max-h-72 overflow-y-auto p-2">
        <Command.Empty className="py-6 text-center text-sm text-slate-500">
          No results found.
        </Command.Empty>
        <Command.Group heading="Jobs" className="text-xs font-bold uppercase text-primary">
          {jobs.slice(0, 30).map((job) => (
            <Command.Item
              key={job.id}
              value={`job ${job.jobCode} ${job.name} ${job.po ?? ''}`}
              onSelect={() => handleSelect('job-detail', job.id)}
              className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-2 text-white data-[selected=true]:bg-primary/20"
            >
              <span className="material-symbols-outlined text-base text-primary">assignment</span>
              <span>
                #{job.jobCode} {job.name}
                {job.po ? ` · ${job.po}` : ''}
              </span>
            </Command.Item>
          ))}
        </Command.Group>
        <Command.Group heading="Inventory" className="mt-2 text-xs font-bold uppercase text-primary">
          {inventory.slice(0, 30).map((item) => {
            const sku = (item.barcode || item.id.slice(0, 8)).toUpperCase();
            return (
              <Command.Item
                key={item.id}
                value={`inv ${item.name} ${sku}`}
                onSelect={() => handleSelect('inventory-detail', item.id)}
                className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-2 text-white data-[selected=true]:bg-primary/20"
              >
                <span className="material-symbols-outlined text-base text-primary">
                  inventory_2
                </span>
                <span>
                  {item.name} ({sku})
                </span>
              </Command.Item>
            );
          })}
        </Command.Group>
        <Command.Group heading="People" className="mt-2 text-xs font-bold uppercase text-primary">
          {users.slice(0, 20).map((user) => (
            <Command.Item
              key={user.id}
              value={`user ${user.name} ${user.email ?? ''}`}
              onSelect={() => handleSelect('dashboard')}
              className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-2 text-white data-[selected=true]:bg-primary/20"
            >
              <span className="material-symbols-outlined text-base text-primary">person</span>
              <span>{user.name}</span>
            </Command.Item>
          ))}
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
