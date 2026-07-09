import { z } from "zod";
import { DOCUMENT_STATUSES, SENSITIVITY_LABELS } from "@/lib/core/types";

const slugSchema = z.string().trim().regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/).max(120);
const tagSchema = z.string().trim().min(1).max(48).regex(/^[a-z0-9][a-z0-9-]*$/);

export const createDocumentSchema = z.object({
  slug: slugSchema.optional(),
  path: z.string().trim().min(1).max(512),
  title: z.string().trim().min(1).max(200),
  sensitivity: z.enum(SENSITIVITY_LABELS),
  status: z.enum(DOCUMENT_STATUSES).default("published"),
  tags: z.array(tagSchema).max(20).default([]),
  summary: z.string().trim().max(1000).optional(),
  body_md: z.string().trim().min(1),
});

export const updateDocumentSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  sensitivity: z.enum(SENSITIVITY_LABELS).optional(),
  status: z.enum(DOCUMENT_STATUSES).optional(),
  tags: z.array(tagSchema).max(20).optional(),
  summary: z.string().trim().max(1000).optional(),
  body_md: z.string().trim().min(1),
});

export const proposeDocumentRevisionSchema = z.object({
  summary: z.string().trim().max(1000).optional(),
  proposed_body_md: z.string().trim().min(1),
});

export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;
export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;
export type ProposeDocumentRevisionInput = z.infer<typeof proposeDocumentRevisionSchema>;
