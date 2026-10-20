"use client";

import { FolderOpen } from "lucide-react";
import { useState } from "react";

import { pickFolder } from "@/lib/api";
import { hasNativeBridge } from "@/lib/runtime";
import { Button, Input, Label } from "./ui";

export function FolderField({
  value,
  onChange,
  label = "Folder to organize",
  id = "folder-path",
  disabled,
  placeholder = "e.g. C:\\Users\\you\\Downloads",
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  id?: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [native] = useState(() => hasNativeBridge());

  async function browse() {
    const selected = await pickFolder();
    if (selected) onChange(selected);
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          spellCheck={false}
          autoComplete="off"
          className="font-mono text-[13px]"
        />
        <Button variant="outline" onClick={browse} disabled={disabled || !native} className="shrink-0">
          <FolderOpen className="h-4 w-4" />
          Browse…
        </Button>
      </div>
      {!native ? (
        <p className="text-xs text-muted-foreground">
          Browser preview: paste an absolute path. In the desktop app, Browse opens a native folder picker.
        </p>
      ) : null}
    </div>
  );
}
