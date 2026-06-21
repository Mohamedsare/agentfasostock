"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Upload, Trash2, Loader2, FileText, FileImage, FileAudio,
  FileSpreadsheet, FileVideo, File, Plus, CheckCircle2, Circle,
} from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import {
  saveKnowledgeFileMeta,
  deleteKnowledgeFile,
  toggleKnowledgeFile,
  updateKnowledgeFileDescription,
} from "@/lib/actions/knowledge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { KnowledgeFile, KnowledgeFileType } from "@/lib/types";

interface AgentOption {
  id: string;
  name: string;
}

function detectFileType(mimeType: string): KnowledgeFileType {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.includes("word") || mimeType.includes("document")) return "word";
  if (mimeType.includes("excel") || mimeType.includes("spreadsheet") || mimeType.includes("csv")) return "excel";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  return "other";
}

function FileTypeIcon({ type, className }: { type: KnowledgeFileType; className?: string }) {
  const cls = cn("size-5 shrink-0", className);
  if (type === "pdf") return <FileText className={cn(cls, "text-red-500")} />;
  if (type === "image") return <FileImage className={cn(cls, "text-blue-500")} />;
  if (type === "audio") return <FileAudio className={cn(cls, "text-purple-500")} />;
  if (type === "word") return <FileText className={cn(cls, "text-blue-700")} />;
  if (type === "excel") return <FileSpreadsheet className={cn(cls, "text-green-600")} />;
  if (type === "video") return <FileVideo className={cn(cls, "text-orange-500")} />;
  return <File className={cn(cls, "text-muted-foreground")} />;
}

function fileTypeBadgeLabel(type: KnowledgeFileType) {
  const map: Record<KnowledgeFileType, string> = {
    pdf: "PDF", image: "Image", audio: "Audio",
    word: "Word", excel: "Excel", video: "Vidéo", other: "Fichier",
  };
  return map[type];
}

function formatBytes(bytes: number | null) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export function KnowledgeFilesTab({
  files,
  agents,
  activeAgentId,
}: {
  files: KnowledgeFile[];
  agents: AgentOption[];
  activeAgentId: string | null;
}) {
  const router = useRouter();
  const [uploading, setUploading] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [selectedAgentId, setSelectedAgentId] = React.useState<string>(activeAgentId ?? agents[0]?.id ?? "");
  const [pickedFile, setPickedFile] = React.useState<File | null>(null);
  const [description, setDescription] = React.useState("");
  const [dragging, setDragging] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  function openDialog() {
    setPickedFile(null);
    setDescription("");
    setSelectedAgentId(activeAgentId ?? agents[0]?.id ?? "");
    setDialogOpen(true);
  }

  function onFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) setPickedFile(f);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) setPickedFile(f);
  }

  async function uploadFile() {
    if (!pickedFile || !selectedAgentId) return;
    setUploading(true);
    try {
      const supabase = createClient();
      const ext = pickedFile.name.split(".").pop() ?? "bin";
      const path = `${selectedAgentId}/${Date.now()}_${pickedFile.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error: storageError } = await supabase.storage
        .from("knowledge-files")
        .upload(path, pickedFile, { contentType: pickedFile.type, upsert: false });
      if (storageError) { toast.error(`Upload échoué : ${storageError.message}`); return; }

      const { data: urlData } = supabase.storage.from("knowledge-files").getPublicUrl(path);
      const res = await saveKnowledgeFileMeta({
        agentId: selectedAgentId,
        name: pickedFile.name,
        description: description.trim() || undefined,
        fileType: detectFileType(pickedFile.type),
        mimeType: pickedFile.type || `application/${ext}`,
        storagePath: path,
        publicUrl: urlData.publicUrl,
        fileSizeBytes: pickedFile.size,
      });
      if (!res.ok) { toast.error(res.error ?? "Enregistrement échoué."); return; }
      toast.success("Fichier ajouté à la base de connaissance.");
      setDialogOpen(false);
      router.refresh();
    } finally {
      setUploading(false);
    }
  }

  function toggle(file: KnowledgeFile) {
    startTransition(async () => {
      const res = await toggleKnowledgeFile(file.id, !file.is_active);
      if (res.ok) router.refresh();
      else toast.error(res.error ?? "Échec.");
    });
  }

  function remove(file: KnowledgeFile) {
    if (!confirm(`Supprimer « ${file.name} » ?`)) return;
    startTransition(async () => {
      const res = await deleteKnowledgeFile(file.id, file.storage_path);
      if (res.ok) { toast.success("Fichier supprimé."); router.refresh(); }
      else toast.error(res.error ?? "Échec.");
    });
  }

  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? "—";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {files.length} fichier{files.length !== 1 ? "s" : ""} — PDF, images, Word, Excel, audio…
        </p>
        <Button onClick={openDialog} disabled={agents.length === 0}>
          <Plus className="size-4" /> Ajouter un fichier
        </Button>
      </div>

      {files.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-14">
          <Upload className="size-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">Aucun fichier. Importez vos documents.</p>
          <Button variant="outline" onClick={openDialog} disabled={agents.length === 0}>
            <Plus className="size-4" /> Ajouter un fichier
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {files.map((f) => (
            <Card key={f.id} className={cn("flex items-start gap-3 p-4", !f.is_active && "opacity-60")}>
              <div className="mt-0.5">
                <FileTypeIcon type={f.file_type} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge tone="primary">{fileTypeBadgeLabel(f.file_type)}</Badge>
                  <span className="text-xs text-muted-foreground">{agentName(f.agent_id)}</span>
                  {f.file_size_bytes && (
                    <span className="text-xs text-muted-foreground">{formatBytes(f.file_size_bytes)}</span>
                  )}
                </div>
                <p className="mt-1 truncate font-medium text-sm">{f.name}</p>
                {f.description && (
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{f.description}</p>
                )}
                <a
                  href={f.public_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-block text-xs text-primary hover:underline"
                >
                  Ouvrir le fichier ↗
                </a>
              </div>
              <div className="flex flex-col items-end gap-2 shrink-0">
                <Switch checked={f.is_active} onCheckedChange={() => toggle(f)} aria-label="Activer" />
                <Button
                  size="icon" variant="ghost"
                  className="size-7 text-destructive"
                  onClick={() => remove(f)}
                  disabled={pending}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Upload dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) setDialogOpen(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Ajouter un fichier</DialogTitle>
            <DialogDescription>
              Le fichier sera associé à la base de connaissance de l&apos;agent sélectionné.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Agent selector */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Agent concerné</label>
              <Select value={selectedAgentId} onValueChange={setSelectedAgentId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choisir un agent" />
                </SelectTrigger>
                <SelectContent>
                  {agents.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Dropzone */}
            <div
              className={cn(
                "relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition-colors cursor-pointer",
                dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50",
              )}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                className="sr-only"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.jpg,.jpeg,.png,.webp,.gif,.mp3,.wav,.ogg,.mp4,.mov,.txt"
                onChange={onFilePick}
              />
              {pickedFile ? (
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="size-5 text-primary" />
                  <span className="text-sm font-medium truncate max-w-[200px]">{pickedFile.name}</span>
                  <span className="text-xs text-muted-foreground">{formatBytes(pickedFile.size)}</span>
                </div>
              ) : (
                <>
                  <Upload className="mb-2 size-8 text-muted-foreground/60" />
                  <p className="text-sm font-medium">Glissez un fichier ici</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    ou cliquez pour parcourir — PDF, Word, Excel, image, audio…
                  </p>
                </>
              )}
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Description <span className="text-muted-foreground font-normal">(optionnelle)</span>
              </label>
              <Input
                placeholder="Ex. Catalogue produits 2025, liste de prix…"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <Button
              className="w-full"
              disabled={!pickedFile || !selectedAgentId || uploading}
              onClick={uploadFile}
            >
              {uploading ? (
                <><Loader2 className="size-4 animate-spin" /> Upload en cours…</>
              ) : (
                <><Upload className="size-4" /> Importer le fichier</>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
