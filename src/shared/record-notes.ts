/** Staff annotations. Verification records an independent review, not a guarantee. */
export const recordNoteKinds = [
  "customer",
  "product",
  "order",
  "invoice",
  "shipment",
] as const;
export type RecordNoteKind = (typeof recordNoteKinds)[number];
export type RecordNoteTarget = { kind: RecordNoteKind; recordId: string };
export type RecordNote = RecordNoteTarget & {
  id: string;
  body: string;
  visibility: "staff";
  authorId: string;
  authorName: string;
  createdAt: string;
  verification: null | {
    verifierId: string;
    verifierName: string;
    verifiedAt: string;
  };
};
export type RecordNotesPage = {
  items: RecordNote[];
  next: string | null;
  canVerify: boolean;
};
export type AddRecordNote = RecordNoteTarget & { body: string };
export type VerifyRecordNote = RecordNoteTarget & { noteId: string };
